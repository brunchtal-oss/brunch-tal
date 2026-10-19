-- Story 3.16, review fix: admin_change_credit_options refreshes the
-- credit's options (private.refresh_credit_options, without the fill) after
-- locking them and before the plan. Without it an active option whose
-- session filled, closed for registration or was booked by her (not yet
-- refreshed) became replaced ('admin') instead of passed or replaced
-- (full / booked): options_count missed a passed opportunity and the
-- audit's before listed stale options.
--
-- Built from the live definition (identical to 20261019204039); only the
-- refresh call is new. Same signature, revoke and grant.

create or replace function public.admin_change_credit_options(
  p_credit_id uuid,
  p_event_ids uuid[],
  p_reason text,
  p_confirmed boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_reason text := nullif(btrim(p_reason), '');
  v_customer uuid;
  v_credit public.cancellation_credits;
  v_saved public.cancellation_credits;
  v_plan jsonb;
  v_before jsonb;
  v_after jsonb;
  v_counted integer;
  v_event_id uuid;
  v_audit_id uuid;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_change_credit_options', p_idempotency_key,
    jsonb_build_object(
      'credit_id', p_credit_id,
      'event_ids', to_jsonb(p_event_ids),
      'reason', v_reason,
      'confirmed', p_confirmed
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if char_length(v_reason) > 2000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "reason"}';
  end if;

  select c.customer_id into v_customer
  from public.cancellation_credits c
  where c.id = p_credit_id;

  if v_customer is not null then
    perform private.lock_customer(v_customer);
  end if;

  perform 1
  from public.events e
  where e.id = any (coalesce(p_event_ids, '{}'::uuid[]))
    or e.id in (
      select o.event_id
      from public.credit_options o
      where o.credit_id = p_credit_id
        and o.state = 'active'
    )
  order by e.id
  for update;

  select c.* into v_credit
  from public.cancellation_credits c
  where c.id = p_credit_id
  for update;

  if v_credit.id is not null
     and v_credit.customer_id is distinct from v_customer then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  perform 1
  from public.credit_options o
  where o.credit_id = p_credit_id
  order by o.id
  for update;

  -- Bring the options to their true states first (no fill): an active
  -- option whose session filled, closed or that she booked is replaced or
  -- passed by the usual rules, so the plan, the audit and options_count
  -- (used + passed + picked) see them as they are, not as replaced
  -- (admin).
  perform private.refresh_credit_options(p_credit_id, false);

  v_plan := private.plan_admin_change_credit_options(p_credit_id, p_event_ids);
  if not (v_plan ->> 'ok')::boolean then
    if v_plan ? 'field' then
      raise exception '%', v_plan ->> 'code' using errcode = 'P0001',
        detail = jsonb_build_object('field', v_plan ->> 'field')::text;
    end if;
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001';
  end if;

  if p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  v_before := private.credit_options_snapshot(v_credit.id);

  update public.credit_options
  set state = 'replaced', replaced_at = now(), replaced_reason = 'admin'
  where credit_id = v_credit.id
    and state = 'active'
    and not (event_id = any (p_event_ids));

  -- One row per credit and session (credit_options_credit_event_key): a
  -- session that was an alternative before is active again.
  insert into public.credit_options as o (credit_id, event_id, added_by)
  select v_credit.id, x.event_id, 'admin'
  from unnest(p_event_ids) as x(event_id)
  on conflict on constraint credit_options_credit_event_key do update
  set state = 'active',
      added_by = 'admin',
      assigned_at = now(),
      replaced_at = null,
      replaced_reason = null
  where o.state = 'replaced';

  select count(*)::integer into v_counted
  from public.credit_options o
  where o.credit_id = v_credit.id
    and o.state in ('used', 'passed');

  update public.cancellation_credits
  set options_count = v_counted + cardinality(p_event_ids)
  where id = v_credit.id
  returning * into v_saved;

  v_after := private.credit_options_snapshot(v_credit.id);

  select b.event_id into v_event_id
  from public.bookings b
  where b.id = coalesce(
    private.credit_cancelled_booking(v_credit.id),
    v_credit.origin_booking_id
  );

  v_audit_id := private.audit(
    v_actor, 'admin', 'admin_change_credit_options', 'cancellation_credits', v_credit.id,
    v_customer, v_event_id, v_before, v_after, v_reason
  );

  -- Last in the transaction (AD-6, AD-12); an unbound credit has no one to
  -- tell (AD-23).
  if v_customer is not null then
    perform private.enqueue_notification(
      v_customer,
      'credit_options_changed',
      v_audit_id::text,
      jsonb_build_object(
        'date', private.format_day_month(
          (v_credit.origin_starts_at at time zone 'Asia/Jerusalem')::date
        )
      ),
      '/me/bookings'
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_change_credit_options', p_idempotency_key,
    jsonb_build_object(
      'credit_id', v_credit.id,
      'options_count', v_saved.options_count
    )
  );
end;
$$;

revoke execute on function public.admin_change_credit_options(uuid, uuid[], text, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_change_credit_options(uuid, uuid[], text, boolean, uuid) to authenticated;
