-- Story 3.13, local check (user decision 2026-10-19): a card's event kind
-- is never changed to couple (a card never funds a couple session, so the
-- card would fit no session). private.plan_admin_correct_entitlement as in
-- 20261018084612_entitlement_corrections, plus INVALID_INPUT
-- (eligible_event_kind) for couple on a card. Same signature, no drop.

create or replace function private.plan_admin_correct_entitlement(
  p_entitlement_id uuid,
  p_field text,
  p_value jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_entitlement public.entitlements;
  v_new public.entitlements;
  v_payment public.payments;
  v_label text;
  v_available integer;
  v_old jsonb;
  v_new_value jsonb;
  v_text text;
  v_units integer;
  v_days smallint[];
  v_affected jsonb;
begin
  select e.* into v_entitlement
  from public.entitlements e
  where e.id = p_entitlement_id;

  if v_entitlement.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_entitlement.eligibility_snapshot ->> 'validity_mode' <> 'days'
     or v_entitlement.pinned_event_id is not null
     or v_entitlement.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_CARD');
  end if;

  select b.available into v_available
  from public.entitlement_balances b
  where b.entitlement_id = v_entitlement.id;

  v_new := v_entitlement;

  if p_field = 'expires_on' then
    v_text := p_value #>> '{}';
    -- Separate steps: the cast runs only on a valid date.
    if jsonb_typeof(p_value) is distinct from 'string'
       or v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or not pg_input_is_valid(v_text, 'date') then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'field', 'expires_on');
    end if;
    if v_text::date < v_entitlement.valid_from then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'field', 'expires_on');
    end if;
    v_new.expires_on := v_text::date;
    v_old := to_jsonb(v_entitlement.expires_on);
    v_new_value := to_jsonb(v_new.expires_on);
    if v_new.expires_on = v_entitlement.expires_on then
      return jsonb_build_object('ok', false, 'code', 'NO_CHANGE');
    end if;

  elsif p_field = 'units' then
    if jsonb_typeof(p_value) is distinct from 'number'
       or (p_value #>> '{}') !~ '^[0-9]{1,2}$' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'field', 'units');
    end if;
    v_units := (p_value #>> '{}')::integer;
    v_old := to_jsonb(v_available);
    v_new_value := to_jsonb(v_units);
    if v_units = v_available then
      return jsonb_build_object('ok', false, 'code', 'NO_CHANGE');
    end if;

  elsif p_field = 'allowed_weekdays' then
    if p_value is null or jsonb_typeof(p_value) = 'null' then
      v_days := null;
    elsif jsonb_typeof(p_value) <> 'array'
       or jsonb_array_length(p_value) not between 1 and 7
       or exists (
         select 1
         from jsonb_array_elements(p_value) d
         where jsonb_typeof(d.value) <> 'number'
           or (d.value #>> '{}') !~ '^[0-6]$'
       )
       or (
         select count(distinct d.value #>> '{}')
         from jsonb_array_elements(p_value) d
       ) <> jsonb_array_length(p_value) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'field', 'allowed_weekdays');
    else
      select array_agg((d.value #>> '{}')::smallint order by (d.value #>> '{}')::smallint)
      into v_days
      from jsonb_array_elements(p_value) d;
      -- Every day is "all days".
      if cardinality(v_days) = 7 then
        v_days := null;
      end if;
    end if;
    v_new.allowed_weekdays := v_days;
    v_old := coalesce(
      (select to_jsonb(array_agg(d order by d)) from unnest(v_entitlement.allowed_weekdays) d),
      'null'::jsonb
    );
    v_new_value := coalesce(to_jsonb(v_days), 'null'::jsonb);
    if v_old = v_new_value then
      return jsonb_build_object('ok', false, 'code', 'NO_CHANGE');
    end if;

  elsif p_field = 'eligible_event_kind' then
    v_text := p_value #>> '{}';
    -- A card never funds a couple session, so its kind stays regular.
    if jsonb_typeof(p_value) is distinct from 'string'
       or v_text not in ('regular', 'couple')
       or (v_entitlement.kind = 'card' and v_text = 'couple') then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'field', 'eligible_event_kind');
    end if;
    v_new.eligible_event_kind := v_text;
    v_old := to_jsonb(v_entitlement.eligible_event_kind);
    v_new_value := to_jsonb(v_text);
    if v_text = v_entitlement.eligible_event_kind then
      return jsonb_build_object('ok', false, 'code', 'NO_CHANGE');
    end if;

  else
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'field', 'field');
  end if;

  select p.* into v_payment
  from public.payments p
  where p.id = v_entitlement.payment_id;

  select coalesce(nullif(btrim(pr.full_name), ''), v_payment.payer_label)
  into v_label
  from (select 1) one
  left join public.profiles pr
    on pr.id = coalesce(v_entitlement.customer_id, v_payment.customer_id);

  if p_field = 'units' then
    v_affected := '[]'::jsonb;
  else
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'booking_id', x.booking_id,
          'event_id', x.event_id,
          'starts_at', x.starts_at,
          'concept_name', x.concept_name
        )
        order by x.starts_at, x.booking_id
      ),
      '[]'::jsonb
    )
    into v_affected
    from (
      select distinct b.id as booking_id, ev.id as event_id, ev.starts_at, c.name as concept_name
      from public.booking_allocations a
      join public.bookings b on b.id = a.booking_id
      join public.events ev on ev.id = b.event_id
      join public.concepts c on c.id = ev.concept_id
      where a.entitlement_id = v_entitlement.id
        and b.status = 'confirmed'
        and ev.starts_at > now()
        and private.entitlement_fits_event(v_entitlement, ev)
        and not private.entitlement_fits_event(v_new, ev)
    ) x;
  end if;

  return jsonb_build_object(
    'ok', true,
    'entitlement_id', v_entitlement.id,
    'customer_id', coalesce(v_entitlement.customer_id, v_payment.customer_id),
    'customer_label', v_label,
    'field', p_field,
    'old_value', v_old,
    'new_value', v_new_value,
    'available', v_available,
    'affected', v_affected
  );
end;
$$;

revoke execute on function private.plan_admin_correct_entitlement(uuid, text, jsonb) from public, anon, authenticated, service_role;
