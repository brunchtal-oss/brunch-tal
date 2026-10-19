-- Story 3.13, part 2 of 2: entitlement corrections (CAP-9, AD-7, AD-12).
-- Runs after 20261018084607_entitlement_correction_types (the type check).
--
-- The user runs it in the Supabase SQL Editor and the main session
-- registers it (apply_migration through the MCP is declined). Every
-- redefinition below was built from the live pg_get_functiondef on
-- 2026-10-18 (identical to the latest migration of each).
--
-- 1. public.entitlement_corrections and public.entitlement_correction_bookings
--    (RLS: admin select only; explicit grants).
-- 2. Templates: entitlement_units_changed, entitlement_terms_changed (new),
--    entitlement_changed (new wording).
-- 3. private.entitlement_fits_event (the plan_funding entitlement checks
--    except the balance) and private.entitlement_is_extended.
-- 4. Correcting a card: private.plan_admin_correct_entitlement,
--    preview_admin_correct_entitlement, admin_correct_entitlement.
-- 5. A parked purchase in a cancelled session: private.plan_admin_settle_
--    parked_purchase, preview_admin_settle_parked_purchase,
--    admin_settle_parked_purchase.
-- 6. admin_set_correction_booking_handled.
-- 7. Reads: admin_get_entitlement (new); admin_get_attention_items,
--    admin_list_open_cards and admin_get_customer redefined.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- One row per correction of a card (AD-12: its id is the notification's
-- discriminator). old_value / new_value: the field's value before and after
-- (units: the available count). related_event_id: a balance fix may name
-- the session it concerns. week_start: reserved for the automatic extension
-- (3.14), unique per entitlement.
create table public.entitlement_corrections (
  id uuid primary key default gen_random_uuid(),
  entitlement_id uuid not null references public.entitlements (id) on delete restrict,
  field text not null
    check (field in ('expires_on', 'units', 'allowed_weekdays', 'eligible_event_kind')),
  old_value jsonb not null,
  new_value jsonb not null,
  related_event_id uuid references public.events (id) on delete restrict,
  reason text check (reason is null or char_length(reason) <= 2000),
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('admin', 'system')),
  week_start date,
  created_at timestamptz not null default now(),
  constraint entitlement_corrections_related_event_check
    check (related_event_id is null or field = 'units'),
  constraint entitlement_corrections_week_start_key unique (entitlement_id, week_start)
);

alter table public.entitlement_corrections enable row level security;

create index entitlement_corrections_entitlement_id_idx
  on public.entitlement_corrections (entitlement_id, created_at);
create index entitlement_corrections_related_event_id_idx
  on public.entitlement_corrections (related_event_id);

-- The future bookings a correction warned about (they stay as they are and
-- appear in "לטיפול" until handled). handled_* : Tal tapped "טופל".
create table public.entitlement_correction_bookings (
  correction_id uuid not null references public.entitlement_corrections (id) on delete restrict,
  booking_id uuid not null references public.bookings (id) on delete restrict,
  handled_at timestamptz,
  handled_by uuid,
  primary key (correction_id, booking_id),
  constraint entitlement_correction_bookings_handled_check
    check ((handled_at is null) = (handled_by is null))
);

alter table public.entitlement_correction_bookings enable row level security;

create index entitlement_correction_bookings_booking_id_idx
  on public.entitlement_correction_bookings (booking_id);

create policy entitlement_corrections_admin_select on public.entitlement_corrections
  for select to authenticated
  using ((select private.is_admin()));

create policy entitlement_correction_bookings_admin_select on public.entitlement_correction_bookings
  for select to authenticated
  using ((select private.is_admin()));

revoke all on table public.entitlement_corrections from public, anon, authenticated, service_role;
grant select on table public.entitlement_corrections to authenticated;

revoke all on table public.entitlement_correction_bookings from public, anon, authenticated, service_role;
grant select on table public.entitlement_correction_bookings to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Templates (Hebrew stays in the template table, AD-5)
-- ---------------------------------------------------------------------------

-- One template per case (user decision 2026-10-18). Vars of all three:
-- {expires_on} (DD.MM) and {units} (the available entries after it).
update public.notification_templates
set title = 'תוקף הכרטיסייה עודכן',
    body = 'הכרטיסייה שלך בתוקף עד {expires_on}, ונשארו בה {units} כניסות פנויות. הפרטים באזור האישי',
    allowed_vars = array['expires_on', 'units'],
    version = version + 1,
    updated_at = now(),
    updated_by = null
where type = 'entitlement_changed';

insert into public.notification_templates (
  type, recipient_kind, push, body_mode, title, body, allowed_vars
)
values
  (
    'entitlement_units_changed', 'customer', true, 'template',
    'היתרה בכרטיסייה עודכנה',
    'יש לך עכשיו {units} כניסות פנויות בכרטיסייה, בתוקף עד {expires_on}. הפרטים באזור האישי',
    array['expires_on', 'units']
  ),
  (
    'entitlement_terms_changed', 'customer', true, 'template',
    'עדכון בכרטיסייה שלך',
    'השתנו הימים או סוג המפגשים שאפשר להירשם אליהם עם הכרטיסייה. הפרטים באזור האישי',
    array['expires_on', 'units']
  );

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------

-- Whether the entitlement (as given, possibly with a new value) may fund
-- the session: plan_funding's entitlement checks (20261013161248) except
-- the balance and the pinned rule: active, the session's kind, a weekday it
-- funds (the local day), valid_from <= day <= expires_on, and never a card
-- for a couple session. plan_funding itself is unchanged.
create function private.entitlement_fits_event(
  p_entitlement public.entitlements,
  p_event public.events
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_entitlement.status = 'active'
    and p_entitlement.eligible_event_kind = p_event.kind
    and (
      p_entitlement.allowed_weekdays is null
      or extract(dow from (p_event.starts_at at time zone 'Asia/Jerusalem')::date)::smallint
         = any (p_entitlement.allowed_weekdays)
    )
    and not (p_entitlement.kind = 'card' and p_event.kind = 'couple')
    and p_entitlement.valid_from <= (p_event.starts_at at time zone 'Asia/Jerusalem')::date
    and (p_event.starts_at at time zone 'Asia/Jerusalem')::date <= p_entitlement.expires_on,
    false
  );
$$;

-- "(כולל הארכה)": the current expires_on is later than before the first
-- expiry correction.
create function private.entitlement_is_extended(
  p_entitlement_id uuid,
  p_expires_on date
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    p_expires_on > (
      select (c.old_value #>> '{}')::date
      from public.entitlement_corrections c
      where c.entitlement_id = p_entitlement_id
        and c.field = 'expires_on'
      order by c.created_at, c.id
      limit 1
    ),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Correcting a card (AD-7: one plan for the preview and the action)
-- ---------------------------------------------------------------------------

-- What correcting one field of a card would do. p_value (jsonb):
-- expires_on 'YYYY-MM-DD' (>= valid_from); units: the new available count
-- (an integer 0-99; the delta is computed here, never sent); allowed_weekdays:
-- an array of 1-7 distinct days 0..6, or null for every day (all seven are
-- stored as null); eligible_event_kind 'regular' | 'couple'.
-- Refusals ({ok: false, code[, field]}): NOT_FOUND; NOT_A_CARD (pinned,
-- revoked or refunded); INVALID_INPUT with field (the field name, or
-- 'field' for an unknown one); NO_CHANGE.
-- Result: {ok, entitlement_id, customer_id, customer_label, field,
-- old_value, new_value, available, affected: [{booking_id, event_id,
-- starts_at, concept_name}]}. affected: her confirmed bookings funded by
-- this card whose session has not started, that fit now and would not fit
-- with the new value (always empty for units), by starts_at.
create function private.plan_admin_correct_entitlement(
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
    if jsonb_typeof(p_value) is distinct from 'string'
       or v_text not in ('regular', 'couple') then
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

-- The dialog's impact box (AD-7): the admin check, then the plan.
create function public.preview_admin_correct_entitlement(
  p_entitlement_id uuid,
  p_field text,
  p_value jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  return private.plan_admin_correct_entitlement(p_entitlement_id, p_field, p_value);
end;
$$;

-- Tal corrects one field of a card (source §2, §7; sensitive). Order:
-- is_admin, idempotency, the reason (INVALID_INPUT, detail reason: over
-- 2000 after trimming), the entitlement's customer read without a lock,
-- her profile locked (private.lock_customer, when bound), the sessions of
-- the card's confirmed future bookings by id, the entitlement, the re-check
-- of its customer (CONCURRENT_CHANGE), the plan (its code is raised, with
-- detail field for INVALID_INPUT), p_related_event_id (units only, and one
-- of this card's bookings' sessions; else INVALID_INPUT, related_event),
-- p_confirmed (CONFIRM_REQUIRED). Then: expires_on / allowed_weekdays /
-- eligible_event_kind update the row (audited before/after with the
-- reason); units adds one adjust movement with the delta (audited). The
-- correction row and one child row per affected booking (bookings are never
-- changed), and for a bound customer the case's notification (vars
-- expires_on DD.MM and units, the available entries after it;
-- discriminator the correction id; target /me/purchases/<id>).
-- Result: {correction_id, affected_count}.
create function public.admin_correct_entitlement(
  p_entitlement_id uuid,
  p_field text,
  p_value jsonb,
  p_related_event_id uuid,
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
  v_entitlement public.entitlements;
  v_saved public.entitlements;
  v_plan jsonb;
  v_movement public.entitlement_movements;
  v_correction public.entitlement_corrections;
  v_delta integer;
  v_available integer;
  v_count integer;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_correct_entitlement', p_idempotency_key,
    jsonb_build_object(
      'entitlement_id', p_entitlement_id,
      'field', p_field,
      'value', p_value,
      'related_event_id', p_related_event_id,
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

  select e.customer_id into v_customer
  from public.entitlements e
  where e.id = p_entitlement_id;

  if v_customer is not null then
    perform private.lock_customer(v_customer);
  end if;

  perform 1
  from public.events ev
  where ev.id in (
    select b.event_id
    from public.booking_allocations a
    join public.bookings b on b.id = a.booking_id
    where a.entitlement_id = p_entitlement_id
      and b.status = 'confirmed'
  )
    and ev.starts_at > now()
  order by ev.id
  for update;

  select e.* into v_entitlement
  from public.entitlements e
  where e.id = p_entitlement_id
  for update;

  if v_entitlement.id is not null
     and v_entitlement.customer_id is distinct from v_customer then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  v_plan := private.plan_admin_correct_entitlement(p_entitlement_id, p_field, p_value);
  if not (v_plan ->> 'ok')::boolean then
    if v_plan ? 'field' then
      raise exception '%', v_plan ->> 'code' using errcode = 'P0001',
        detail = jsonb_build_object('field', v_plan ->> 'field')::text;
    end if;
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001';
  end if;

  if p_related_event_id is not null
     and (
       p_field <> 'units'
       or not exists (
         select 1
         from public.booking_allocations a
         join public.bookings b on b.id = a.booking_id
         where a.entitlement_id = v_entitlement.id
           and b.event_id = p_related_event_id
       )
     ) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "related_event"}';
  end if;

  if p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  if p_field = 'units' then
    v_delta := (v_plan ->> 'new_value')::integer - (v_plan ->> 'old_value')::integer;

    insert into public.entitlement_movements (
      entitlement_id, action, units, reason, actor_id
    )
    values (v_entitlement.id, 'adjust', v_delta, v_reason, v_actor)
    returning * into v_movement;

    perform private.audit(
      v_actor, 'admin', 'admin_correct_entitlement', 'entitlement_movements', v_movement.id,
      v_customer, p_related_event_id, null, to_jsonb(v_movement), v_reason
    );
  else
    update public.entitlements
    set expires_on = case when p_field = 'expires_on'
          then (v_plan ->> 'new_value')::date else expires_on end,
        allowed_weekdays = case when p_field = 'allowed_weekdays'
          then (
            select array_agg(d.value::smallint)
            from jsonb_array_elements_text(
              case when jsonb_typeof(v_plan -> 'new_value') = 'array'
                then v_plan -> 'new_value' end
            ) d
          )
          else allowed_weekdays end,
        eligible_event_kind = case when p_field = 'eligible_event_kind'
          then v_plan ->> 'new_value' else eligible_event_kind end
    where id = v_entitlement.id
    returning * into v_saved;

    perform private.audit(
      v_actor, 'admin', 'admin_correct_entitlement', 'entitlements', v_entitlement.id,
      v_customer, null, to_jsonb(v_entitlement), to_jsonb(v_saved), v_reason
    );
  end if;

  insert into public.entitlement_corrections (
    entitlement_id, field, old_value, new_value, related_event_id, reason,
    actor_id, actor_kind
  )
  values (
    v_entitlement.id, p_field, v_plan -> 'old_value', v_plan -> 'new_value',
    p_related_event_id, v_reason, v_actor, 'admin'
  )
  returning * into v_correction;

  insert into public.entitlement_correction_bookings (correction_id, booking_id)
  select v_correction.id, (x.value ->> 'booking_id')::uuid
  from jsonb_array_elements(v_plan -> 'affected') x;

  get diagnostics v_count = row_count;

  -- Last in the transaction (AD-6, AD-12); an unbound card has no one to
  -- tell (AD-23).
  if v_customer is not null then
    select b.available into v_available
    from public.entitlement_balances b
    where b.entitlement_id = v_entitlement.id;

    perform private.enqueue_notification(
      v_customer,
      case p_field
        when 'expires_on' then 'entitlement_changed'
        when 'units' then 'entitlement_units_changed'
        else 'entitlement_terms_changed'
      end,
      v_correction.id::text,
      jsonb_build_object(
        'expires_on', private.format_day_month(coalesce(v_saved.expires_on, v_entitlement.expires_on)),
        'units', v_available
      ),
      '/me/purchases/' || v_entitlement.id::text
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_correct_entitlement', p_idempotency_key,
    jsonb_build_object(
      'correction_id', v_correction.id,
      'affected_count', v_count
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. A parked purchase in a cancelled session (like a business cancel)
-- ---------------------------------------------------------------------------

-- An active pinned entitlement with no booking on its payment, whose session
-- was cancelled (3.8 left it as it was). Anything else: NOT_PARKED.
-- Result: {ok, entitlement_id, customer_id, customer_label, event_id,
-- concept_name, starts_at, amount_agorot}.
create function private.plan_admin_settle_parked_purchase(p_entitlement_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_entitlement public.entitlements;
  v_payment public.payments;
  v_event public.events;
  v_concept text;
  v_label text;
begin
  select e.* into v_entitlement
  from public.entitlements e
  where e.id = p_entitlement_id;

  select ev.* into v_event
  from public.events ev
  where ev.id = v_entitlement.pinned_event_id;

  if v_entitlement.id is null
     or v_entitlement.status <> 'active'
     or v_entitlement.pinned_event_id is null
     or v_event.id is null
     or v_event.status <> 'cancelled'
     or exists (
       select 1 from public.bookings b where b.payment_id = v_entitlement.payment_id
     ) then
    return jsonb_build_object('ok', false, 'code', 'NOT_PARKED');
  end if;

  select p.* into v_payment
  from public.payments p
  where p.id = v_entitlement.payment_id;

  select c.name into v_concept from public.concepts c where c.id = v_event.concept_id;

  select coalesce(nullif(btrim(pr.full_name), ''), v_payment.payer_label)
  into v_label
  from (select 1) one
  left join public.profiles pr
    on pr.id = coalesce(v_entitlement.customer_id, v_payment.customer_id);

  return jsonb_build_object(
    'ok', true,
    'entitlement_id', v_entitlement.id,
    'customer_id', coalesce(v_entitlement.customer_id, v_payment.customer_id),
    'customer_label', v_label,
    'event_id', v_event.id,
    'concept_name', v_concept,
    'starts_at', v_event.starts_at,
    'amount_agorot', v_payment.amount_agorot
  );
end;
$$;

create function public.preview_admin_settle_parked_purchase(p_entitlement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  return private.plan_admin_settle_parked_purchase(p_entitlement_id);
end;
$$;

-- Tal offers the customer a refund or a credit for a purchase paid without
-- a place in a session the business cancelled (user decision 2026-10-18;
-- source §6 table). It writes what a business cancel of the placed booking
-- would have left (cancel_core's pinned branch, 20261013162639): a cancelled
-- booking on the payment (book_core's policy_snapshot), its allocation, a
-- reserve and a use movement, and an active credit with choice_pending, so
-- 3.8's choice, 3.9's refund and bind work unchanged. Order: is_admin,
-- idempotency, the reason (INVALID_INPUT, reason), the customer read
-- without a lock, her profile (when bound), the session, the entitlement
-- and the re-check (CONCURRENT_CHANGE), the payment, the plan (its code),
-- p_confirmed (CONFIRM_REQUIRED). A bound customer gets event_cancelled
-- (the template, no override; discriminator event_id:revision:booking_id,
-- the new cancelled booking, so it never dedupes against the cancel's own
-- event_cancelled to her; to /me/bookings); an unbound one at bind (3.8,
-- whose event_id:revision may dedupe against an earlier one). Result: {entitlement_id,
-- booking_id, credit_id}.
create function public.admin_settle_parked_purchase(
  p_entitlement_id uuid,
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
  v_event_id uuid;
  v_event public.events;
  v_entitlement public.entitlements;
  v_payment public.payments;
  v_settings public.business_settings;
  v_plan jsonb;
  v_booking public.bookings;
  v_credit public.cancellation_credits;
  v_units integer := 1;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_settle_parked_purchase', p_idempotency_key,
    jsonb_build_object(
      'entitlement_id', p_entitlement_id,
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

  select e.customer_id, e.pinned_event_id into v_customer, v_event_id
  from public.entitlements e
  where e.id = p_entitlement_id;

  if v_customer is not null then
    perform private.lock_customer(v_customer);
  end if;

  select ev.* into v_event
  from public.events ev
  where ev.id = v_event_id
  for update;

  select e.* into v_entitlement
  from public.entitlements e
  where e.id = p_entitlement_id
  for update;

  if v_entitlement.id is not null
     and (
       v_entitlement.customer_id is distinct from v_customer
       or v_entitlement.pinned_event_id is distinct from v_event_id
     ) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  select p.* into v_payment
  from public.payments p
  where p.id = v_entitlement.payment_id
  for update;

  v_plan := private.plan_admin_settle_parked_purchase(p_entitlement_id);
  if not (v_plan ->> 'ok')::boolean then
    raise exception '%', v_plan ->> 'code' using errcode = 'P0001';
  end if;

  if p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  select s.* into v_settings from public.business_settings s;

  insert into public.bookings (
    customer_id, payment_id, event_id, party_size, status, booked_by,
    confirmed_at, cancelled_at, policy_snapshot
  )
  values (
    v_customer, v_payment.id, v_event.id,
    coalesce((v_entitlement.eligibility_snapshot ->> 'party_size')::integer, 1),
    'cancelled', 'admin', now(), now(),
    jsonb_build_object(
      'cancel_window_hours', v_settings.cancel_window_hours,
      'reminder_lead_hours', v_settings.reminder_lead_hours
    )
  )
  returning * into v_booking;

  insert into public.booking_allocations (booking_id, entitlement_id, units)
  values (v_booking.id, v_entitlement.id, v_units);

  insert into public.entitlement_movements (
    entitlement_id, booking_id, action, units, actor_id
  )
  values
    (v_entitlement.id, v_booking.id, 'reserve', -v_units, v_actor),
    (v_entitlement.id, v_booking.id, 'use', 0, v_actor);

  insert into public.cancellation_credits (
    customer_id, origin_booking_id, source_entitlement_id, event_kind,
    party_size, options_count, origin_starts_at, original_cancelled_at,
    monetary_basis_agorot, status, choice_pending
  )
  values (
    v_customer, v_booking.id, v_entitlement.id, v_event.kind,
    v_booking.party_size, greatest(v_settings.credit_options_count, 1),
    v_event.starts_at, now(),
    private.monetary_basis(v_booking.id),
    'active', true
  )
  returning * into v_credit;

  perform private.audit(
    v_actor, 'admin', 'admin_settle_parked_purchase', 'bookings', v_booking.id,
    v_customer, v_event.id, null, to_jsonb(v_booking), v_reason
  );

  perform private.audit(
    v_actor, 'admin', 'admin_settle_parked_purchase', 'cancellation_credits', v_credit.id,
    v_customer, v_event.id, null, to_jsonb(v_credit), v_reason
  );

  -- Last in the transaction (AD-6, AD-12); unbound: at bind (3.8).
  if v_customer is not null then
    perform private.enqueue_notification(
      v_customer,
      'event_cancelled',
      v_event.id::text || ':' || v_event.revision::text || ':' || v_booking.id::text,
      jsonb_build_object(
        'date',
        private.format_day_month((v_event.starts_at at time zone 'Asia/Jerusalem')::date)
      ),
      '/me/bookings'
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_settle_parked_purchase', p_idempotency_key,
    jsonb_build_object(
      'entitlement_id', v_entitlement.id,
      'booking_id', v_booking.id,
      'credit_id', v_credit.id
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. "טופל" on a booking a correction warned about (set_*: no key)
-- ---------------------------------------------------------------------------

-- Marks every open child row of the booking handled (audited). The booking
-- itself is not changed. A booking no correction warned about: NOT_FOUND.
-- Result: {booking_id, handled_count} (0 when all were handled already).
create function public.admin_set_correction_booking_handled(p_booking_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_row public.entitlement_correction_bookings;
  v_saved public.entitlement_correction_bookings;
  v_booking public.bookings;
  v_count integer := 0;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.entitlement_correction_bookings cb
    where cb.booking_id = p_booking_id
  ) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id;

  for v_row in
    select cb.*
    from public.entitlement_correction_bookings cb
    where cb.booking_id = p_booking_id
      and cb.handled_at is null
    order by cb.correction_id
    for update
  loop
    update public.entitlement_correction_bookings
    set handled_at = now(), handled_by = v_actor
    where correction_id = v_row.correction_id
      and booking_id = v_row.booking_id
    returning * into v_saved;

    perform private.audit(
      v_actor, 'admin', 'admin_set_correction_booking_handled',
      'entitlement_correction_bookings', v_row.booking_id,
      v_booking.customer_id, v_booking.event_id, to_jsonb(v_row), to_jsonb(v_saved)
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('booking_id', p_booking_id, 'handled_count', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Reads
-- ---------------------------------------------------------------------------

-- The admin entitlement page (customers/[id]/entitlements/[entitlementId]).
-- NOT_FOUND for a missing entitlement. correctable: a card (validity_mode
-- days) that is active. bookings: every booking this entitlement funded,
-- newest session first (the balance fix's session picker). corrections:
-- newest first, with the related session.
create function public.admin_get_entitlement(p_entitlement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entitlement public.entitlements;
  v_balance public.entitlement_balances;
  v_payment public.payments;
  v_label text;
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_entries jsonb;
  v_bookings jsonb;
  v_corrections jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select e.* into v_entitlement
  from public.entitlements e
  where e.id = p_entitlement_id;

  if v_entitlement.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select b.* into v_balance
  from public.entitlement_balances b
  where b.entitlement_id = v_entitlement.id;

  select p.* into v_payment
  from public.payments p
  where p.id = v_entitlement.payment_id;

  select coalesce(nullif(btrim(pr.full_name), ''), v_payment.payer_label)
  into v_label
  from (select 1) one
  left join public.profiles pr
    on pr.id = coalesce(v_entitlement.customer_id, v_payment.customer_id);

  -- As admin_get_customer.entries.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'status', bk.status,
        'starts_at', ev.starts_at,
        'concept_name', c.name,
        'event_id', ev.id
      )
      order by ev.starts_at, bk.id, u.n
    ),
    '[]'::jsonb
  )
  into v_entries
  from public.booking_allocations a
  join public.bookings bk on bk.id = a.booking_id
  join public.events ev on ev.id = bk.event_id
  join public.concepts c on c.id = ev.concept_id
  cross join lateral generate_series(1, a.units) as u(n)
  where a.entitlement_id = v_entitlement.id
    and bk.status <> 'cancelled';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'booking_id', x.booking_id,
        'event_id', x.event_id,
        'concept_name', x.concept_name,
        'starts_at', x.starts_at,
        'status', x.status
      )
      order by x.starts_at desc, x.booking_id
    ),
    '[]'::jsonb
  )
  into v_bookings
  from (
    select distinct bk.id as booking_id, ev.id as event_id, c.name as concept_name,
      ev.starts_at, bk.status
    from public.booking_allocations a
    join public.bookings bk on bk.id = a.booking_id
    join public.events ev on ev.id = bk.event_id
    join public.concepts c on c.id = ev.concept_id
    where a.entitlement_id = v_entitlement.id
  ) x;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'correction_id', co.id,
        'field', co.field,
        'old_value', co.old_value,
        'new_value', co.new_value,
        'reason', co.reason,
        'actor_kind', co.actor_kind,
        'created_at', co.created_at,
        'related_event_id', co.related_event_id,
        'related_concept_name', c.name,
        'related_starts_at', ev.starts_at
      )
      order by co.created_at desc, co.id
    ),
    '[]'::jsonb
  )
  into v_corrections
  from public.entitlement_corrections co
  left join public.events ev on ev.id = co.related_event_id
  left join public.concepts c on c.id = ev.concept_id
  where co.entitlement_id = v_entitlement.id;

  return jsonb_build_object(
    'entitlement_id', v_entitlement.id,
    'customer_id', coalesce(v_entitlement.customer_id, v_payment.customer_id),
    'customer_label', v_label,
    'product_name', v_payment.product_snapshot ->> 'name',
    'kind', v_entitlement.kind,
    'status', v_entitlement.status,
    'validity_mode', v_entitlement.eligibility_snapshot ->> 'validity_mode',
    'correctable', v_entitlement.status = 'active'
      and v_entitlement.pinned_event_id is null
      and v_entitlement.eligibility_snapshot ->> 'validity_mode' = 'days',
    'paid_on', v_payment.paid_on,
    'original_units', v_entitlement.original_units,
    'available', v_balance.available,
    'reserved', v_balance.reserved,
    'used', v_balance.used,
    'valid_from', v_entitlement.valid_from,
    'expires_on', v_entitlement.expires_on,
    'is_expired', v_balance.is_expired,
    'days_left', v_entitlement.expires_on - v_today,
    'allowed_weekdays', to_jsonb(v_entitlement.allowed_weekdays),
    'eligible_event_kind', v_entitlement.eligible_event_kind,
    'is_extended', private.entitlement_is_extended(v_entitlement.id, v_entitlement.expires_on),
    'entries', v_entries,
    'bookings', v_bookings,
    'corrections', v_corrections
  );
end;
$$;

-- As in 20261013203359, plus correction_affected: one item per booking a
-- correction warned about (its latest unhandled child row), while the
-- booking is confirmed, its session has not started and the card still
-- does not fit it.
create or replace function public.admin_get_attention_items()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
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
        'event_status', ev.status,
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

    -- A refund she asked for (3.7), open until Tal completes it (3.9).
    select
      r.requested_at,
      r.id,
      jsonb_build_object(
        'kind', 'refund_requested',
        'id', r.id,
        'customer_label', p.customer_label,
        'since', r.requested_at,
        'customer_id', coalesce(r.customer_id, p.customer_id),
        'amount_agorot', r.amount_agorot,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.refund_requests r
    join pay p on p.id = r.payment_id
    join public.bookings b on b.id = r.booking_id
    join public.events ev on ev.id = b.event_id
    join public.concepts c on c.id = ev.concept_id
    where r.status = 'requested'

    union all

    -- A business cancel she has not chosen for yet (3.8): refund or credit,
    -- no deadline; bound credits only.
    select
      cb.cancelled_at,
      c.id,
      jsonb_build_object(
        'kind', 'choice_pending',
        'id', c.id,
        'customer_label', coalesce(nullif(btrim(pr.full_name), ''), p.customer_label),
        'since', cb.cancelled_at,
        'customer_id', c.customer_id,
        'event_id', ev.id,
        'concept_name', cn.name,
        'starts_at', ev.starts_at,
        'amount_agorot', c.monetary_basis_agorot
      )
    from public.cancellation_credits c
    join public.entitlements se on se.id = c.source_entitlement_id
    join pay p on p.id = se.payment_id
    left join public.profiles pr on pr.id = c.customer_id
    join public.bookings cb on cb.id = private.credit_cancelled_booking(c.id)
    join public.events ev on ev.id = cb.event_id
    join public.concepts cn on cn.id = ev.concept_id
    where c.status = 'active'
      and c.choice_pending
      and c.customer_id is not null

    union all

    -- A booking that no longer fits its card after a correction (3.13): the
    -- latest unhandled warning per booking, while the booking is confirmed,
    -- its session has not started and the card still does not fit it.
    select
      w.since,
      w.booking_id,
      jsonb_build_object(
        'kind', 'correction_affected',
        'id', w.booking_id,
        'customer_id', coalesce(b.customer_id, p.customer_id),
        'customer_label', p.customer_label,
        'since', w.since,
        'entitlement_id', e.id,
        'event_id', ev.id,
        'concept_name', cn.name,
        'starts_at', ev.starts_at,
        'field', w.field
      )
    from (
      select distinct on (cb.booking_id)
        cb.booking_id, co.entitlement_id, co.field, co.created_at as since
      from public.entitlement_correction_bookings cb
      join public.entitlement_corrections co on co.id = cb.correction_id
      where cb.handled_at is null
      order by cb.booking_id, co.created_at desc, co.id desc
    ) w
    join public.bookings b on b.id = w.booking_id
    join public.entitlements e on e.id = w.entitlement_id
    join pay p on p.id = e.payment_id
    join public.events ev on ev.id = b.event_id
    join public.concepts cn on cn.id = ev.concept_id
    where b.status = 'confirmed'
      and ev.starts_at > now()
      and not private.entitlement_fits_event(e, ev)

    union all

    -- An email change stuck between its steps for more than 15 minutes
    -- (2.8, AD-21); saving the same address again on the card resumes it.
    select
      pr.account_op_started_at,
      pr.id,
      jsonb_build_object(
        'kind', 'email_change_stuck',
        'id', pr.id,
        'customer_label', nullif(btrim(pr.full_name), ''),
        'since', pr.account_op_started_at,
        'customer_id', pr.id
      )
    from public.profiles pr
    where pr.account_op_state = 'email_change_pending'
      and pr.account_op_started_at < now() - interval '15 minutes'
      and pr.anonymized_at is null

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

    union all

    -- The accessibility statement was never published (5.5, AD-22). The
    -- column id is uuid in every branch; the item's id is the page slug.
    select
      cp.created_at,
      null::uuid,
      jsonb_build_object(
        'kind', 'accessibility_unpublished',
        'id', cp.slug,
        'customer_label', null,
        'since', cp.created_at
      )
    from public.content_pages cp
    where cp.slug = 'accessibility'
      and cp.published_at is null

    union all

    -- Push notifications that failed in the last 7 days (5.8): one item for
    -- all of them, since the latest failure.
    select
      f.since,
      null::uuid,
      jsonb_build_object(
        'kind', 'push_failed',
        'id', 'push_failed',
        'customer_label', null,
        'since', f.since,
        'count', f.n
      )
    from (
      select max(j.finished_at) as since, count(*)::integer as n
      from public.notification_jobs j
      where j.status = 'failed'
        and j.finished_at >= now() - interval '7 days'
    ) f
    where f.n > 0
  )
  select coalesce(
    jsonb_agg(i.item order by i.since desc, i.id),
    '[]'::jsonb
  )
  into v_result
  from items i;

  return v_result;
end;
$function$;

-- As in 20261013080437, plus is_extended.
create or replace function public.admin_list_open_cards(p_filter text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_threshold integer;
  v_today date;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_filter is null or p_filter not in ('all', 'available', 'expiring') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select s.admin_expiring_days into v_threshold from public.business_settings s;
  v_today := (now() at time zone 'Asia/Jerusalem')::date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entitlement_id', x.entitlement_id,
        'customer_id', x.customer_id,
        'customer_label', x.customer_label,
        'product_name', x.product_name,
        'paid_on', x.paid_on,
        'original_units', x.original_units,
        'available', x.available,
        'reserved', x.reserved,
        'used', x.used,
        'expires_on', x.expires_on,
        'days_left', x.days_left,
        'is_expiring', x.is_expiring,
        'is_extended', x.is_extended,
        'entries', x.entries
      )
      order by x.expires_on, x.customer_label nulls last, x.entitlement_id
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      b.entitlement_id,
      coalesce(b.customer_id, p.customer_id) as customer_id,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label,
      p.product_snapshot ->> 'name' as product_name,
      p.paid_on,
      b.original_units,
      b.available,
      b.reserved,
      b.used,
      b.expires_on,
      b.expires_on - v_today as days_left,
      -- The home's expiring_cards rule (admin_get_home, 20261010141240).
      coalesce(
        b.available > 0 and b.expires_on - v_today <= v_threshold,
        false
      ) as is_expiring,
      private.entitlement_is_extended(b.entitlement_id, b.expires_on) as is_extended,
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'status', bk.status,
              'starts_at', ev.starts_at,
              'concept_name', c.name,
              'event_id', ev.id
            )
            order by ev.starts_at, bk.id, u.n
          ),
          '[]'::jsonb
        )
        from public.booking_allocations a
        join public.bookings bk on bk.id = a.booking_id
        join public.events ev on ev.id = bk.event_id
        join public.concepts c on c.id = ev.concept_id
        cross join lateral generate_series(1, a.units) as u(n)
        where a.entitlement_id = b.entitlement_id
          and bk.status <> 'cancelled'
      ) as entries
    from public.entitlement_balances b
    join public.entitlements e on e.id = b.entitlement_id
    join public.payments p on p.id = b.payment_id
    left join public.profiles pr on pr.id = coalesce(b.customer_id, p.customer_id)
    where b.kind = 'card'
      and b.status = 'active'
      and not b.is_expired
      and e.pinned_event_id is null
      and b.available + b.reserved > 0
  ) x
  where p_filter = 'all'
    or (p_filter = 'available' and x.available > 0)
    or (p_filter = 'expiring' and x.is_expiring);

  return v_result;
end;
$$;

-- As in 20261007183144, plus is_extended on each entitlement.
create or replace function public.admin_get_customer(p_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_threshold integer;
  v_today date;
  v_email text;
  v_babies jsonb;
  v_entitlements jsonb;
  v_bookings jsonb;
  v_payments jsonb;
  v_notes jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.id = p_customer_id
    and p.anonymized_at is null
    and not exists (select 1 from public.admin_roles a where a.user_id = p.id);
  if v_profile.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select u.email into v_email from auth.users u where u.id = v_profile.id;
  select s.admin_expiring_days into v_threshold from public.business_settings s;
  v_today := (now() at time zone 'Asia/Jerusalem')::date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('name', b.name, 'birth_date', b.birth_date)
      order by b.birth_date, b.id
    ),
    '[]'::jsonb
  )
  into v_babies
  from public.babies b
  where b.customer_id = v_profile.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entitlement_id', x.entitlement_id,
        'kind', x.kind,
        'status', x.status,
        'product_name', x.product_name,
        'original_units', x.original_units,
        'available', x.available,
        'reserved', x.reserved,
        'used', x.used,
        'expires_on', x.expires_on,
        'is_expired', x.is_expired,
        'days_left', x.days_left,
        'is_expiring', x.status = 'active'
          and not x.is_expired
          and x.available > 0
          and x.days_left <= coalesce(v_threshold, 0),
        'is_used_up', x.status = 'active'
          and x.available = 0
          and x.reserved = 0
          and not x.is_expired,
        'pinned_event_id', x.pinned_event_id,
        'is_extended', x.is_extended,
        'entries', x.entries
      )
      order by x.expires_on, x.entitlement_id
    ),
    '[]'::jsonb
  )
  into v_entitlements
  from (
    select
      b.entitlement_id,
      b.kind,
      b.status,
      b.original_units,
      b.available,
      b.reserved,
      b.used,
      b.expires_on,
      b.is_expired,
      b.expires_on - v_today as days_left,
      e.pinned_event_id,
      private.entitlement_is_extended(b.entitlement_id, b.expires_on) as is_extended,
      p.product_snapshot ->> 'name' as product_name,
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'status', bk.status,
              'starts_at', ev.starts_at,
              'concept_name', c.name,
              'event_id', ev.id
            )
            order by ev.starts_at, bk.id, u.n
          ),
          '[]'::jsonb
        )
        from public.booking_allocations a
        join public.bookings bk on bk.id = a.booking_id
        join public.events ev on ev.id = bk.event_id
        join public.concepts c on c.id = ev.concept_id
        cross join lateral generate_series(1, a.units) as u(n)
        where a.entitlement_id = b.entitlement_id
          and bk.status <> 'cancelled'
      ) as entries
    from public.entitlement_balances b
    join public.entitlements e on e.id = b.entitlement_id
    join public.payments p on p.id = b.payment_id
    where b.customer_id = v_profile.id
  ) x;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'booking_id', b.id,
        'event_id', b.event_id,
        'concept_name', c.name,
        'starts_at', e.starts_at,
        'status', b.status,
        'party_size', b.party_size,
        'created_at', b.created_at
      )
      order by e.starts_at desc, b.created_at desc, b.id
    ),
    '[]'::jsonb
  )
  into v_bookings
  from public.bookings b
  join public.events e on e.id = b.event_id
  join public.concepts c on c.id = e.concept_id
  where b.customer_id = v_profile.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'payment_id', p.id,
        'product_name', p.product_snapshot ->> 'name',
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on,
        'payment_method_name', p.product_snapshot ->> 'payment_method_name',
        'status', p.status
      )
      order by p.paid_on desc, p.created_at desc, p.id
    ),
    '[]'::jsonb
  )
  into v_payments
  from public.payments p
  where p.customer_id = v_profile.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at)
      order by n.created_at desc, n.id
    ),
    '[]'::jsonb
  )
  into v_notes
  from public.customer_notes n
  where n.customer_id = v_profile.id;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'full_name', v_profile.full_name,
      'phone_e164', v_profile.phone_e164,
      'email', v_email,
      'activated_at', v_profile.activated_at,
      'created_at', v_profile.created_at,
      'dietary_notes', v_profile.dietary_notes,
      'photo_consent', v_profile.photo_consent,
      'photo_consent_at', v_profile.photo_consent_at,
      'personal_photo_consent', v_profile.personal_photo_consent,
      'personal_photo_consent_at', v_profile.personal_photo_consent_at,
      'last_activity_on', private.customer_last_activity_on(v_profile.id)
    ),
    'babies', v_babies,
    'entitlements', v_entitlements,
    'bookings', v_bookings,
    'payments', v_payments,
    'notes', v_notes
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function private.entitlement_fits_event(public.entitlements, public.events) from public, anon, authenticated, service_role;
revoke execute on function private.entitlement_is_extended(uuid, date) from public, anon, authenticated, service_role;
revoke execute on function private.plan_admin_correct_entitlement(uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function private.plan_admin_settle_parked_purchase(uuid) from public, anon, authenticated, service_role;

revoke execute on function public.preview_admin_correct_entitlement(uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_correct_entitlement(uuid, text, jsonb) to authenticated;

revoke execute on function public.admin_correct_entitlement(uuid, text, jsonb, uuid, text, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_correct_entitlement(uuid, text, jsonb, uuid, text, boolean, uuid) to authenticated;

revoke execute on function public.preview_admin_settle_parked_purchase(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_settle_parked_purchase(uuid) to authenticated;

revoke execute on function public.admin_settle_parked_purchase(uuid, text, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_settle_parked_purchase(uuid, text, boolean, uuid) to authenticated;

revoke execute on function public.admin_set_correction_booking_handled(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_correction_booking_handled(uuid) to authenticated;

revoke execute on function public.admin_get_entitlement(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_entitlement(uuid) to authenticated;

revoke execute on function public.admin_get_attention_items() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_attention_items() to authenticated;

revoke execute on function public.admin_list_open_cards(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_open_cards(text) to authenticated;

revoke execute on function public.admin_get_customer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_customer(uuid) to authenticated;
