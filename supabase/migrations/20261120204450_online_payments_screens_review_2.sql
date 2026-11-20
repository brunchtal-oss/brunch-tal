-- Online payments, PR B: review pass 2 ("Decisions after review", Pass 2
-- fixes, spec-online-payments-grow-b.md). create or replace only, nothing
-- dropped. Redefinitions start from 20261120194744.
--
-- 1. get_purchase_options: her own open hold on the session (covering the
--    product's places) is no "full" for her re-buy.
-- 2. checkout_return: also has_payment (a payment, or a morning document
--    recorded on an issue) and pending_over (more than 30 minutes after
--    pay_until + the hold grace).
-- 3. checkout_banner_state: not shown once join_issued_at is older than 10
--    minutes.

-- ---------------------------------------------------------------------------
-- 1. The purchase sheet's products
-- ---------------------------------------------------------------------------

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
  v_enabled boolean;
  v_event public.events;
  v_weekday smallint;
  v_products jsonb := '[]'::jsonb;
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

  v_enabled := v_terms and (v_customer is not null or v_public);

  -- Review pass 1: nothing is listed while buying is not enabled.
  if not v_enabled then
    return jsonb_build_object(
      'enabled', false,
      'public_purchase', v_public,
      'products', '[]'::jsonb
    );
  end if;

  if p_event_id is not null then
    select e.* into v_event
    from public.events e
    where e.id = p_event_id
      and e.status = 'published'
      and e.starts_at > now();

    -- A session that is gone, or whose registration closed: no buy entry.
    if v_event.id is null or clock_timestamp() >= v_event.registration_closes_at then
      return jsonb_build_object(
        'enabled', true,
        'public_purchase', v_public,
        'products', '[]'::jsonb
      );
    end if;

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
        -- A pinned product: the self-booking placement rules (fits, not
        -- full, not already booked, intro). A case, so the planner never
        -- calls it for a card (it raises INVALID_INPUT there).
        -- Review pass 2: her own open hold on this session that covers the
        -- product's places is no "full" for her (re-buying the same seat).
        and case
          when p.validity_mode = 'session' then (
            select coalesce((x.plan ->> 'ok')::boolean, false)
              or (
                x.plan ->> 'code' = 'EVENT_FULL'
                and v_customer is not null
                and exists (
                  select 1
                  from public.checkouts c
                  where c.customer_id = v_customer
                    and c.event_id = v_event.id
                    and c.state = 'open'
                    and c.hold_until > now()
                    and c.party_size >= p.party_size
                )
              )
            from (
              select private.plan_pinned_placement(v_customer, p.id, v_event.id, null) as plan
            ) x
          )
          else true
        end
      )
    )
    and not (
      (p.type = 'intro' or p.intro_only)
      and v_customer is not null
      and private.intro_blocked(v_customer, null)
    );

  return jsonb_build_object(
    'enabled', true,
    'public_purchase', v_public,
    'products', v_products
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. checkout_return: booked ignores cancelled bookings
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
  v_grace integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_row := private.find_checkout(p_checkout_id, p_browser_secret, 'browser');
  if v_row.id is null then
    raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select s.online_hold_grace_minutes into v_grace
  from public.business_settings s;

  select p.validity_mode into v_kind
  from public.products p
  where p.id = v_row.product_id;

  v_result := jsonb_build_object(
    'state', v_row.state,
    'product_kind', v_kind,
    'event_id', v_row.event_id,
    'customer_known', v_row.customer_id is not null,
    -- PR B: the paid purchase holds a booking (a pinned one parked as
    -- paid_without_place has none; a cancelled booking does not count).
    'booked', v_row.payment_id is not null and exists (
      select 1
      from public.bookings b
      where b.payment_id = v_row.payment_id
        and b.status <> 'cancelled'
    ),
    -- Review pass 2: money was received (a payment, or a morning document
    -- recorded on an issue); an issue without it (e.g. closed by Tal, or
    -- not verified) gets neutral wording.
    'has_payment', v_row.payment_id is not null or exists (
      select 1
      from public.online_payment_issues i
      where i.checkout_id = v_row.id
        and i.provider_transaction_id is not null
    ),
    -- Review pass 2: the browser return stops waiting for a document more
    -- than 30 minutes after the pay window and the hold grace ended.
    'pending_over', now() > coalesce(
      v_row.hold_until,
      v_row.pay_until + make_interval(mins => coalesce(v_grace, 0))
    ) + interval '30 minutes'
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
-- 3. The "continue joining" banner
-- ---------------------------------------------------------------------------

-- Read only: {show} for the browser's checkout (its browser secret). show:
-- paid, the payment approved and not bound to a customer, the checkout
-- created within the last 24 hours. A wrong secret or a missing checkout
-- is {show: false} (nothing to tell apart).
create or replace function public.checkout_banner_state(p_checkout_id uuid, p_browser_secret text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.checkouts;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_row := private.find_checkout(p_checkout_id, p_browser_secret, 'browser');

  return jsonb_build_object(
    'show',
    v_row.id is not null
      and v_row.state = 'paid'
      and v_row.created_at > now() - interval '24 hours'
      -- Review pass 2: after the 10-minute re-issue window "להמשך" would be
      -- a dead end (join_blocked).
      and (
        v_row.join_issued_at is null
        or v_row.join_issued_at > now() - interval '10 minutes'
      )
      and exists (
        select 1
        from public.payments pay
        where pay.id = v_row.payment_id
          and pay.status = 'approved'
          and pay.customer_id is null
      )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants (AD-5): revoke from every API role, then one grant
-- ---------------------------------------------------------------------------

revoke execute on function public.get_purchase_options(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_purchase_options(uuid, uuid) to service_role;
revoke execute on function public.checkout_return(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.checkout_return(uuid, text) to service_role;
revoke execute on function public.checkout_banner_state(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.checkout_banner_state(uuid, text) to service_role;
