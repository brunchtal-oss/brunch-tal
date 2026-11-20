-- Online payments, PR B: the customer and admin screens
-- (spec-online-payments-grow-b.md). create or replace / insert only,
-- nothing dropped.
--
-- 1. public.get_purchase_options(p_event_id, p_auth_uid): the products of
--    the purchase sheet (service_role; p_auth_uid only from verified
--    claims, as begin_checkout). The server ANDs `enabled` with its kill
--    switch and never calls it while the switch is off.
-- 2. public.checkout_return: also returns `booked` (the payment has a
--    booking), so a known customer's parked purchase reaches the
--    "no_place" notice. Redefined from 20261120160100.
-- 3. The legal page `purchase-terms` (unpublished, empty legal_text, edited
--    in the content editor; its wording is Tal's, story 6.4) and its SEO
--    record (seeded published with the H1, like 20261105211006).

-- ---------------------------------------------------------------------------
-- 1. The purchase sheet's products
-- ---------------------------------------------------------------------------

-- With an event: the active, priced products the session accepts (its kind,
-- its weekday, private.event_accepts_product), pinned or card; a pinned one
-- only while self-registration is open. Without an event: the active,
-- priced card products. An intro (or intro_only) product is hidden from a
-- known customer who cannot take it (private.intro_blocked).
-- enabled: the purchase-terms page is published with a body, and the
-- viewer is a customer, or a guest while public_online_purchase is on. A
-- uid that is not an active customer gets nothing.
create or replace function public.get_purchase_options(p_event_id uuid, p_auth_uid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_public boolean;
  v_terms boolean;
  v_event public.events;
  v_weekday smallint;
  v_products jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select s.public_online_purchase into v_public
  from public.business_settings s;
  v_public := coalesce(v_public, false);

  if p_auth_uid is not null then
    -- The rule of private.current_customer_id (activated, not anonymized).
    select p.id into v_customer
    from public.profiles p
    where p.id = p_auth_uid
      and p.activated_at is not null
      and p.anonymized_at is null;

    if v_customer is null then
      return jsonb_build_object(
        'enabled', false,
        'public_purchase', v_public,
        'products', '[]'::jsonb
      );
    end if;
  end if;

  select exists (
    select 1
    from public.content_pages cp
    join public.content_sections cs
      on cs.page_slug = cp.slug
     and cs.key = 'body'
    where cp.slug = 'purchase-terms'
      and cp.published_at is not null
      and not cs.hidden
      and coalesce(btrim(cs.published_content ->> 'body'), '') <> ''
  ) into v_terms;

  if p_event_id is not null then
    select e.* into v_event
    from public.events e
    where e.id = p_event_id
      and e.status = 'published'
      and e.starts_at > now();
  end if;

  if p_event_id is not null and v_event.id is null then
    v_products := '[]'::jsonb;
  else
    if v_event.id is not null then
      v_weekday := extract(dow from (v_event.starts_at at time zone 'Asia/Jerusalem'))::smallint;
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'name', p.name,
          'type', p.type,
          'price_agorot', p.price_agorot,
          'units', p.units,
          'validity_mode', p.validity_mode,
          'validity_days', p.validity_days
        )
        order by (p.validity_mode = 'days'), p.price_agorot, p.name, p.id
      ),
      '[]'::jsonb
    )
    into v_products
    from public.products p
    where p.active
      and p.price_agorot > 0
      and (
        -- No event: card products only.
        (v_event.id is null and p.validity_mode = 'days')
        or (
          v_event.id is not null
          and p.eligible_event_kind = v_event.kind
          and (p.allowed_weekdays is null or v_weekday = any (p.allowed_weekdays))
          and private.event_accepts_product(v_event.id, p.id)
          and (
            p.validity_mode = 'days'
            or clock_timestamp() < v_event.registration_closes_at
          )
        )
      )
      and not (
        (p.type = 'intro' or p.intro_only)
        and v_customer is not null
        and private.intro_blocked(v_customer, null)
      );
  end if;

  return jsonb_build_object(
    'enabled', v_terms and (v_customer is not null or v_public),
    'public_purchase', v_public,
    'products', v_products
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. checkout_return: booked
-- ---------------------------------------------------------------------------

create or replace function public.checkout_return(p_checkout_id uuid, p_browser_secret text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.checkouts;
  v_kind text;
  v_payment public.payments;
  v_live public.activation_tokens;
  v_token jsonb;
  v_result jsonb;
  v_join_issued_at timestamptz;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_row := private.find_checkout(p_checkout_id, p_browser_secret, 'browser');
  if v_row.id is null then
    raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select p.validity_mode into v_kind
  from public.products p
  where p.id = v_row.product_id;

  v_result := jsonb_build_object(
    'state', v_row.state,
    'product_kind', v_kind,
    'event_id', v_row.event_id,
    'customer_known', v_row.customer_id is not null,
    -- PR B: the paid purchase got its booking (a pinned one parked as
    -- paid_without_place has none).
    'booked', v_row.payment_id is not null and exists (
      select 1 from public.bookings b where b.payment_id = v_row.payment_id
    )
  );

  if v_row.state <> 'paid' or v_row.customer_id is not null then
    return v_result;
  end if;

  select pay.* into v_payment
  from public.payments pay
  where pay.id = v_row.payment_id;

  if v_payment.customer_id is not null then
    return v_result || jsonb_build_object('joined', true);
  end if;

  begin
    -- Lock order (AD-6): the payment's join tokens first. Raises LINK_USED
    -- (bound or consumed), PURCHASE_VOIDED, LINK_IN_PROGRESS (claiming).
    v_live := private.lock_join_payment(v_payment.id);
  exception when sqlstate 'P0001' then
    return v_result || jsonb_build_object(
      'joined', sqlerrm = 'LINK_USED',
      'join_blocked', sqlerrm <> 'LINK_USED'
    );
  end;

  -- Review pass 2: one link per checkout, read under the token lock; a
  -- later return is blocked (the browser drops its cookie entry anyway).
  -- Review pass 3: within 10 minutes of the first issue the same browser
  -- secret may get a new link (a lost response); the live one is revoked
  -- first, and the window does not move.
  select c.join_issued_at into v_join_issued_at
  from public.checkouts c
  where c.id = v_row.id
  for update;

  if v_join_issued_at is not null and now() > v_join_issued_at + interval '10 minutes' then
    return v_result || jsonb_build_object('joined', false, 'join_blocked', true);
  end if;

  -- A conflict stays for Tal ("לטיפול"); no new link over it.
  if v_live.id is not null and v_live.state = 'conflict' then
    return v_result || jsonb_build_object('joined', false, 'join_blocked', true);
  end if;

  if v_live.id is not null then
    update public.activation_tokens
    set state = 'revoked', revoked_at = now()
    where id = v_live.id;
  end if;

  v_token := private.issue_token('join', null, v_payment.id);

  update public.checkouts
  set join_issued_at = coalesce(join_issued_at, now())
  where id = v_row.id;

  return v_result || jsonb_build_object(
    'joined', false,
    'join_token', v_token ->> 'token'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The purchase-terms page (rows only; no wording in code)
-- ---------------------------------------------------------------------------

insert into public.content_pages (slug)
values ('purchase-terms')
on conflict (slug) do nothing;

insert into public.content_sections (page_slug, key, kind, sort_order)
values ('purchase-terms', 'body', 'legal_text', 1)
on conflict (page_slug, key) do nothing;

-- Its SEO record, published like the other seeds (the page 'seo' keeps its
-- version: the H1 is the one the page shows without it).
-- published_content_full is the full copy; the trigger
-- content_sections_public_copy derives published_content from it.
insert into public.content_sections (
  page_slug, key, kind, sort_order, draft_content, published_content_full, published_at
)
select 'seo', s.key, s.kind, s.sort_order, s.content, s.content, now()
from (
  values
    ('purchase_terms', 'page_seo', 10, jsonb_build_object('h1', 'תקנון הרכישה'))
) as s (key, kind, sort_order, content)
on conflict (page_slug, key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Grants (AD-5): revoke from every API role, then one grant
-- ---------------------------------------------------------------------------

revoke execute on function public.get_purchase_options(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_purchase_options(uuid, uuid) to service_role;
revoke execute on function public.checkout_return(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.checkout_return(uuid, text) to service_role;
