-- Story 6.5 (deferred 2.14 #5): admin_reschedule_event no longer rewrites
-- expires_on of a voided (status = 'revoked') pinned entitlement. Active
-- and refunded entitlements keep today's behaviour (3.9 keeps a refunded
-- purchase's terms). Nothing is dropped; same signature, so the grants and
-- the generated types stay as they are.
--
-- Copied from the live pg_get_functiondef (md5 of pg_get_functiondef
-- 0906c3007c4e7c0db1449ac945a7a9a9 on 2026-10-29; last defining migration
-- 20261013162639_business_cancel_event.sql). The only change: the pinned
-- loop's where gains `and e.status <> 'revoked'`.

create or replace function public.admin_reschedule_event(
  p_event_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_confirmed boolean,
  p_message text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_message text := btrim(p_message);
  v_customers uuid[];
  v_event public.events;
  v_saved public.events;
  v_plan jsonb;
  v_new_day date;
  v_entitlement public.entitlements;
  v_entitlement_new public.entitlements;
  v_customer uuid;
  v_notified integer := 0;
  v_vars jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_reschedule_event', p_idempotency_key,
    jsonb_build_object(
      'event_id', p_event_id,
      'starts_at', p_starts_at,
      'ends_at', p_ends_at,
      'confirmed', p_confirmed,
      'message', v_message
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if v_message is null or char_length(v_message) not between 1 and 1000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "message"}';
  end if;

  select coalesce(array_agg(distinct b.customer_id), '{}')
  into v_customers
  from public.bookings b
  where b.event_id = p_event_id
    and b.status = 'confirmed'
    and b.customer_id is not null;

  perform 1
  from public.profiles p
  where p.id = any (v_customers)
  order by p.id
  for update;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  perform 1
  from public.bookings b
  where b.event_id = p_event_id
    and b.status = 'confirmed'
  order by b.id
  for update;

  if exists (
    select 1
    from public.bookings b
    where b.event_id = p_event_id
      and b.status = 'confirmed'
      and b.customer_id is not null
      and not (b.customer_id = any (v_customers))
  ) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  perform 1
  from public.entitlements e
  where e.pinned_event_id = p_event_id
     or e.id in (
       select a.entitlement_id
       from public.booking_allocations a
       join public.bookings b on b.id = a.booking_id
       where b.event_id = p_event_id
         and b.status = 'confirmed'
     )
  order by e.id
  for update;

  perform 1
  from public.cancellation_credits c
  where c.id in (
    select a.credit_id
    from public.booking_allocations a
    join public.bookings b on b.id = a.booking_id
    where b.event_id = p_event_id
      and b.status = 'confirmed'
  )
  order by c.id
  for update;

  v_plan := private.plan_admin_reschedule_event(p_event_id, p_starts_at, p_ends_at);
  if not (v_plan ->> 'ok')::boolean then
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001',
      detail = jsonb_build_object('field', v_plan ->> 'field')::text;
  end if;

  if p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  update public.events
  set starts_at = p_starts_at, ends_at = p_ends_at
  where id = v_event.id
  returning * into v_saved;

  perform private.audit(
    v_actor, 'admin', 'admin_reschedule_event', 'events', v_saved.id,
    null, v_saved.id, to_jsonb(v_event), to_jsonb(v_saved)
  );

  -- A pinned product is valid only on its session (AD-8). A voided
  -- (revoked) entitlement keeps its expires_on (6.5).
  v_new_day := (v_saved.starts_at at time zone 'Asia/Jerusalem')::date;
  for v_entitlement in
    select e.*
    from public.entitlements e
    where e.pinned_event_id = v_saved.id
      and e.status <> 'revoked'
      and e.expires_on is distinct from greatest(v_new_day, e.valid_from)
    order by e.id
  loop
    update public.entitlements
    set expires_on = greatest(v_new_day, v_entitlement.valid_from)
    where id = v_entitlement.id
    returning * into v_entitlement_new;

    perform private.audit(
      v_actor, 'admin', 'admin_reschedule_event', 'entitlements', v_entitlement.id,
      v_entitlement.customer_id, v_saved.id, to_jsonb(v_entitlement), to_jsonb(v_entitlement_new)
    );
  end loop;

  perform private.refresh_credits_for_event(v_saved.id);

  v_vars := jsonb_build_object(
    'date',
    private.format_day_month((v_event.starts_at at time zone 'Asia/Jerusalem')::date),
    'new_date', private.format_day_month(v_new_day),
    'new_time', to_char(v_saved.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI')
  );

  -- Last in the transaction (AD-6, AD-12).
  for v_customer in
    select distinct b.customer_id
    from public.bookings b
    where b.event_id = v_saved.id
      and b.status = 'confirmed'
      and b.customer_id is not null
    order by b.customer_id
  loop
    if private.enqueue_notification(
      v_customer,
      'event_changed',
      v_saved.id::text || ':' || v_saved.revision::text,
      v_vars,
      '/me/bookings',
      v_message
    ) is not null then
      v_notified := v_notified + 1;
    end if;
  end loop;

  return private.idempotent_finish(
    v_actor::text, 'admin_reschedule_event', p_idempotency_key,
    jsonb_build_object(
      'event_id', v_saved.id,
      'booking_count', (v_plan ->> 'booking_count')::integer,
      'notified', v_notified,
      'starts_at', v_saved.starts_at,
      'ends_at', v_saved.ends_at
    )
  );
end;
$function$;
