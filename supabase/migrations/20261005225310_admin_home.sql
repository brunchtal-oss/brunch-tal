-- Story 4.1: the admin home (CAP-24) and "to handle" (AD-22).
-- 1. public.admin_get_attention_items(): the only source of "to handle". Every
--    item is derived from a stored state and disappears when the state
--    changes; no task table. Kinds (sources that exist today; each later
--    story adds its own kind here):
--    link_conflict, link_stuck, purchase_without_link, paid_without_place,
--    pinned_seat_held, media_stuck.
-- 2. public.admin_get_home(): the upcoming sessions with their occupied
--    places (private.occupied_places), the cards about to expire
--    (entitlement_balances, threshold business_settings.admin_expiring_days
--    read at call time) and the month's approved payments (paid_on in the
--    local month up to today, Asia/Jerusalem). net_agorot = approved_agorot
--    until refunds exist (3.7).
-- Both are reads: stable security definer, admin only, no idempotency key
-- (AD-5). One grant each, to authenticated.

-- "To handle" (story 4.1). Result: a jsonb array ordered by since desc, of
-- {kind, id, customer_label, since, ...details}:
--   link_conflict         id = token; payment_id, conflict_reason,
--                         product_name, amount_agorot, paid_on
--   link_stuck            id = token; payment_id, product_name,
--                         amount_agorot, paid_on
--   purchase_without_link id = payment; product_name, amount_agorot, paid_on
--   paid_without_place    id = entitlement; payment_id, product_name,
--                         amount_agorot, paid_on, event_id, concept_name,
--                         starts_at
--   pinned_seat_held      id = booking; payment_id, event_id, concept_name,
--                         starts_at
--   media_stuck           id = media asset
-- customer_label: the payment's customer's full_name, else the payment's
-- payer_label, else null ("new customer" on screen). since: when the state
-- began (a conflict has no timestamp of its own: the claim's start, else the
-- link's creation).
create function public.admin_get_attention_items()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  with
  join_links as (
    select t.*, private.join_link_status(t) as link_status
    from public.activation_tokens t
    where t.purpose = 'join'
  ),
  pay as (
    select
      p.id,
      p.customer_id,
      p.status,
      p.amount_agorot,
      p.paid_on,
      p.created_at,
      p.product_snapshot ->> 'name' as product_name,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label
    from public.payments p
    left join public.profiles pr on pr.id = p.customer_id
  ),
  items as (
    -- A link stopped in a conflict (any reason, bind_conflict too).
    select
      coalesce(l.claiming_at, l.created_at) as since,
      l.id,
      jsonb_build_object(
        'kind', 'link_conflict',
        'id', l.id,
        'customer_label', p.customer_label,
        'since', coalesce(l.claiming_at, l.created_at),
        'payment_id', p.id,
        'conflict_reason', l.conflict_reason,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      ) as item
    from join_links l
    join pay p on p.id = l.payment_id
    where l.link_status = 'conflict'

    union all

    -- A join stuck in claiming for more than 15 minutes.
    select
      l.claiming_at,
      l.id,
      jsonb_build_object(
        'kind', 'link_stuck',
        'id', l.id,
        'customer_label', p.customer_label,
        'since', l.claiming_at,
        'payment_id', p.id,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      )
    from join_links l
    join pay p on p.id = l.payment_id
    where l.link_status = 'stuck'

    union all

    -- An approved purchase not bound to a customer whose links were all
    -- revoked or expired (or that has none): no live link, no conflict.
    select
      w.since,
      p.id,
      jsonb_build_object(
        'kind', 'purchase_without_link',
        'id', p.id,
        'customer_label', p.customer_label,
        'since', w.since,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      )
    from pay p
    cross join lateral (
      select coalesce(
        max(case when l.link_status = 'revoked' then l.revoked_at else l.expires_at end),
        p.created_at
      ) as since
      from join_links l
      where l.payment_id = p.id
    ) w
    where p.status = 'approved'
      and p.customer_id is null
      and not exists (
        select 1
        from join_links l
        where l.payment_id = p.id
          and l.link_status not in ('revoked', 'expired')
      )

    union all

    -- Paid without a place (3.11 'park'): an active pinned entitlement with
    -- no booking on its payment.
    select
      e.created_at,
      e.id,
      jsonb_build_object(
        'kind', 'paid_without_place',
        'id', e.id,
        'customer_label', p.customer_label,
        'since', e.created_at,
        'payment_id', p.id,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.entitlements e
    join pay p on p.id = e.payment_id
    join public.events ev on ev.id = e.pinned_event_id
    join public.concepts c on c.id = ev.concept_id
    where e.status = 'active'
      and e.pinned_event_id is not null
      and not exists (
        select 1 from public.bookings b where b.payment_id = e.payment_id
      )

    union all

    -- A pinned booking without a customer still holding a place after its
    -- join ended in bind_conflict, while the session has not ended. Released
    -- on the session page (admin_cancel_booking, 3.6).
    select
      s.since,
      b.id,
      jsonb_build_object(
        'kind', 'pinned_seat_held',
        'id', b.id,
        'customer_label', p.customer_label,
        'since', s.since,
        'payment_id', p.id,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.bookings b
    join pay p on p.id = b.payment_id
    join public.events ev on ev.id = b.event_id
    join public.concepts c on c.id = ev.concept_id
    cross join lateral (
      select max(coalesce(l.claiming_at, l.created_at)) as since
      from join_links l
      where l.payment_id = b.payment_id
        and l.link_status = 'conflict'
        and l.conflict_reason = 'bind_conflict'
    ) s
    where b.status = 'confirmed'
      and b.customer_id is null
      and ev.ends_at > now()
      and s.since is not null
      and not exists (
        select 1
        from join_links l
        where l.payment_id = b.payment_id
          and l.link_status in ('pending', 'awaiting_login', 'claiming', 'stuck')
      )

    union all

    -- An image stuck in copying for 15 minutes or more (5.4); publishing the
    -- page again continues from the stored state.
    select
      m.publish_started_at,
      m.id,
      jsonb_build_object(
        'kind', 'media_stuck',
        'id', m.id,
        'customer_label', null,
        'since', m.publish_started_at
      )
    from public.media_assets m
    where m.publish_state = 'copying'
      and m.publish_started_at <= now() - interval '15 minutes'
  )
  select coalesce(
    jsonb_agg(i.item order by i.since desc, i.id),
    '[]'::jsonb
  )
  into v_result
  from items i;

  return v_result;
end;
$$;

-- The admin home (story 4.1). Result:
-- {upcoming_sessions: [{event_id, concept_name, kind, starts_at, ends_at,
--   occupied, capacity}] (published, not ended, by starts_at, at most 4),
--  expiring_cards: [{entitlement_id, customer_label, product_name, available,
--   expires_on, days_left}] (active cards, not expired, with free entries,
--   days_left <= business_settings.admin_expiring_days, by expires_on),
--  totals: {period_start, period_end, approved_count, approved_agorot,
--   net_agorot}} (approved payments whose paid_on is in the local month up
--   to today; net = approved until refunds exist, 3.7).
create function public.admin_get_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date;
  v_start date;
  v_threshold integer;
  v_sessions jsonb;
  v_cards jsonb;
  v_totals jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_today := (now() at time zone 'Asia/Jerusalem')::date;
  v_start := date_trunc('month', v_today)::date;

  select s.admin_expiring_days into v_threshold
  from public.business_settings s;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_id', u.id,
        'concept_name', u.concept_name,
        'kind', u.kind,
        'starts_at', u.starts_at,
        'ends_at', u.ends_at,
        'occupied', private.occupied_places(u.id),
        'capacity', u.capacity_adults
      )
      order by u.starts_at, u.id
    ),
    '[]'::jsonb
  )
  into v_sessions
  from (
    select e.id, c.name as concept_name, e.kind, e.starts_at, e.ends_at,
      e.capacity_adults
    from public.events e
    join public.concepts c on c.id = e.concept_id
    where e.status = 'published'
      and e.ends_at > now()
    order by e.starts_at, e.id
    limit 4
  ) u;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entitlement_id', x.entitlement_id,
        'customer_label', x.customer_label,
        'product_name', x.product_name,
        'available', x.available,
        'expires_on', x.expires_on,
        'days_left', x.days_left
      )
      order by x.expires_on, x.entitlement_id
    ),
    '[]'::jsonb
  )
  into v_cards
  from (
    select
      b.entitlement_id,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label,
      p.product_snapshot ->> 'name' as product_name,
      b.available,
      b.expires_on,
      b.expires_on - v_today as days_left
    from public.entitlement_balances b
    join public.payments p on p.id = b.payment_id
    left join public.profiles pr on pr.id = coalesce(b.customer_id, p.customer_id)
    where b.kind = 'card'
      and b.status = 'active'
      and not b.is_expired
      and b.available > 0
      and b.expires_on - v_today <= v_threshold
  ) x;

  select jsonb_build_object(
    'period_start', v_start,
    'period_end', v_today,
    'approved_count', count(*)::integer,
    'approved_agorot', coalesce(sum(p.amount_agorot), 0)::bigint,
    'net_agorot', coalesce(sum(p.amount_agorot), 0)::bigint
  )
  into v_totals
  from public.payments p
  where p.status = 'approved'
    and p.paid_on between v_start and v_today;

  return jsonb_build_object(
    'upcoming_sessions', v_sessions,
    'expiring_cards', v_cards,
    'totals', v_totals
  );
end;
$$;

revoke execute on function public.admin_get_attention_items() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_attention_items() to authenticated;

revoke execute on function public.admin_get_home() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_home() to authenticated;
