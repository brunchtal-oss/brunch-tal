-- Story 4.7: Tal edits the business settings and the notification
-- templates (CAP-34).
-- 1. notification_templates.allowed_vars: the {fields} each type's callers
--    pass. A caller of a type passes every one of them; a story that adds a
--    field updates allowed_vars in the same migration, so a template that
--    passed the check always renders.
-- 2. The admin reads the templates (policy + explicit grant, like
--    business_settings).
-- 3. private.template_sample_vars(text[]): a sample value for each allowed
--    field, to render a template before saving it.
-- 4. admin_update_business_settings: a closed list of keys, each checked for
--    type and range (a technical sanity range, not a business value),
--    optimistic version check, audit of the changed values only.
-- 5. admin_update_notification_template: title and body only; a template
--    that does not render with its allowed fields is refused with
--    TEMPLATE_INVALID. render_notification_text is not changed.
-- Neither RPC changes an existing booking, entitlement, credit or session:
-- they read the settings when they are created (AD-15).

-- ---------------------------------------------------------------------------
-- 1. allowed_vars
-- ---------------------------------------------------------------------------

alter table public.notification_templates
  add column allowed_vars text[] not null default '{}'
    check (array_position(allowed_vars, null) is null);

update public.notification_templates t
set allowed_vars = v.vars
from (values
  ('booking_confirmed', array['date', 'time', 'concept']),
  ('purchase_repeat', array['product', 'expires_on', 'card_tip']),
  ('purchase_new_card', array[]::text[]),
  ('booking_cancelled', array['date']),
  -- expires_on is empty while the returned entry awaits sessions (3.6).
  ('booking_cancelled_pinned', array['date']),
  ('reminder', array['date', 'time']),
  ('waitlist_spot', array['date']),
  ('event_cancelled', array['date']),
  ('event_changed', array['date', 'new_date', 'new_time']),
  ('entitlement_changed', array['expires_on', 'units']),
  ('card_expiring', array['units', 'expires_on']),
  ('admin_card_expiring', array['customer', 'units', 'expires_on']),
  ('broadcast', array[]::text[]),
  ('marketing_reminder', array[]::text[])
) as v(type, vars)
where t.type = v.type;

-- ---------------------------------------------------------------------------
-- 2. The admin reads the templates
-- ---------------------------------------------------------------------------

create policy notification_templates_admin_select on public.notification_templates
  for select to authenticated
  using ((select private.is_admin()));

revoke all on table public.notification_templates from public, anon, authenticated, service_role;
grant select on table public.notification_templates to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Sample values for the template check
-- ---------------------------------------------------------------------------

-- Every allowed field gets a non-empty string, so a template renders with
-- them exactly when it uses only allowed fields and its braces balance.
create function private.template_sample_vars(p_vars text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(v, 'x'), '{}'::jsonb)
  from unnest(coalesce(p_vars, '{}'::text[])) as v;
$$;

-- ---------------------------------------------------------------------------
-- 4. admin_update_business_settings
-- ---------------------------------------------------------------------------

-- Tal changes default values (CAP-34). p_changes: a non-empty object with
-- any of default_validity_days, registration_close_days_before,
-- registration_close_local_time, default_capacity_regular,
-- default_capacity_couple, cancel_window_hours, credit_options_count,
-- reminder_lead_hours, admin_expiring_days, customer_expiring_days,
-- last_places_threshold, default_prep_days, inactivity_months,
-- duplicate_payment_window_days, default_session_start_time,
-- default_session_end_time. Integers are JSON numbers, times "HH:MM",
-- default_prep_days an array of distinct offsets -6..0 (saved sorted). An
-- unknown key or a value out of range: INVALID_INPUT with detail.field.
-- p_expected_version is the version the screen read; another one:
-- STALE_VERSION. A change that leaves the row as it was writes nothing.
-- Result: the row after the call.
create function public.admin_update_business_settings(
  p_changes jsonb,
  p_expected_version integer,
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
  v_key text;
  v_value jsonb;
  v_int integer;
  v_old public.business_settings;
  v_row public.business_settings;
  v_prep smallint[];
  v_strip text[] := array['version', 'updated_at'];
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_business_settings', p_idempotency_key,
    jsonb_build_object('changes', p_changes, 'expected_version', p_expected_version)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_changes is null
     or jsonb_typeof(p_changes) <> 'object'
     or p_changes = '{}'::jsonb
     or p_expected_version is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select s.* into v_old
  from public.business_settings s
  for update;

  if v_old.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_row := v_old;

  for v_key, v_value in select e.key, e.value from jsonb_each(p_changes) e
  loop
    if v_key in (
      'default_validity_days', 'registration_close_days_before',
      'default_capacity_regular', 'default_capacity_couple',
      'cancel_window_hours', 'credit_options_count', 'reminder_lead_hours',
      'admin_expiring_days', 'customer_expiring_days',
      'last_places_threshold', 'inactivity_months',
      'duplicate_payment_window_days'
    ) then
      -- case keeps the casts behind the type check (no evaluation order in
      -- a boolean "or"); the parentheses let plpgsql find
      -- the THEN of the IF.
      if (case
           when jsonb_typeof(v_value) <> 'number' then true
           else (v_value #>> '{}')::numeric <> trunc((v_value #>> '{}')::numeric)
             or abs((v_value #>> '{}')::numeric) > 100000
         end) then
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
      end if;
      v_int := (v_value #>> '{}')::numeric::integer;

      if not (case v_key
        when 'default_validity_days' then v_int between 1 and 730
        when 'registration_close_days_before' then v_int between 0 and 7
        when 'default_capacity_regular' then v_int between 1 and 100
        when 'default_capacity_couple' then v_int between 1 and 100
        when 'cancel_window_hours' then v_int between 0 and 336
        when 'credit_options_count' then v_int between 1 and 10
        when 'reminder_lead_hours' then v_int between 1 and 168
        when 'admin_expiring_days' then v_int between 0 and 90
        when 'customer_expiring_days' then v_int between 0 and 90
        when 'last_places_threshold' then v_int between 0 and 50
        when 'inactivity_months' then v_int between 1 and 24
        when 'duplicate_payment_window_days' then v_int between 0 and 60
      end) then
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
      end if;

      case v_key
        when 'default_validity_days' then v_row.default_validity_days := v_int;
        when 'registration_close_days_before' then v_row.registration_close_days_before := v_int;
        when 'default_capacity_regular' then v_row.default_capacity_regular := v_int;
        when 'default_capacity_couple' then v_row.default_capacity_couple := v_int;
        when 'cancel_window_hours' then v_row.cancel_window_hours := v_int;
        when 'credit_options_count' then v_row.credit_options_count := v_int;
        when 'reminder_lead_hours' then v_row.reminder_lead_hours := v_int;
        when 'admin_expiring_days' then v_row.admin_expiring_days := v_int;
        when 'customer_expiring_days' then v_row.customer_expiring_days := v_int;
        when 'last_places_threshold' then v_row.last_places_threshold := v_int;
        when 'inactivity_months' then v_row.inactivity_months := v_int;
        when 'duplicate_payment_window_days' then v_row.duplicate_payment_window_days := v_int;
      end case;

    elsif v_key in (
      'registration_close_local_time', 'default_session_start_time',
      'default_session_end_time'
    ) then
      if (case
           when jsonb_typeof(v_value) <> 'string' then true
           when (v_value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then true
           else v_key = 'registration_close_local_time'
             and (v_value #>> '{}')::time < time '03:00'
         end) then
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
      end if;

      case v_key
        when 'registration_close_local_time' then
          v_row.registration_close_local_time := (v_value #>> '{}')::time;
        when 'default_session_start_time' then
          v_row.default_session_start_time := (v_value #>> '{}')::time;
        when 'default_session_end_time' then
          v_row.default_session_end_time := (v_value #>> '{}')::time;
      end case;

    elsif v_key = 'default_prep_days' then
      if (case
           when jsonb_typeof(v_value) <> 'array' then true
           when jsonb_array_length(v_value) not between 1 and 7 then true
           when exists (
             select 1 from jsonb_array_elements(v_value) e
             where case
               when jsonb_typeof(e) <> 'number' then true
               else (e #>> '{}')::numeric not in (-6, -5, -4, -3, -2, -1, 0)
             end
           ) then true
           else (select count(distinct (e #>> '{}')::numeric)
                 from jsonb_array_elements(v_value) e)
                <> jsonb_array_length(v_value)
         end) then
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
      end if;

      select array_agg((e #>> '{}')::numeric::smallint order by (e #>> '{}')::numeric)
      into v_prep
      from jsonb_array_elements(v_value) e;
      v_row.default_prep_days := v_prep;

    else
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', v_key)::text;
    end if;
  end loop;

  if v_row.default_session_end_time <= v_row.default_session_start_time then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field":"default_session_end_time"}';
  end if;

  if v_old.version <> p_expected_version then
    raise exception 'STALE_VERSION' using errcode = 'P0001';
  end if;

  if v_row is distinct from v_old then
    update public.business_settings s
    set default_validity_days = v_row.default_validity_days,
        registration_close_days_before = v_row.registration_close_days_before,
        registration_close_local_time = v_row.registration_close_local_time,
        default_capacity_regular = v_row.default_capacity_regular,
        default_capacity_couple = v_row.default_capacity_couple,
        cancel_window_hours = v_row.cancel_window_hours,
        credit_options_count = v_row.credit_options_count,
        reminder_lead_hours = v_row.reminder_lead_hours,
        admin_expiring_days = v_row.admin_expiring_days,
        customer_expiring_days = v_row.customer_expiring_days,
        last_places_threshold = v_row.last_places_threshold,
        default_prep_days = v_row.default_prep_days,
        inactivity_months = v_row.inactivity_months,
        duplicate_payment_window_days = v_row.duplicate_payment_window_days,
        default_session_start_time = v_row.default_session_start_time,
        default_session_end_time = v_row.default_session_end_time,
        version = s.version + 1,
        updated_at = now()
    where s.id = v_old.id
    returning s.* into v_row;

    -- Only the changed values (the version is in the row itself).
    perform private.audit(
      v_actor, 'admin', 'admin_update_business_settings', 'business_settings',
      null, null, null, to_jsonb(v_old) - v_strip, to_jsonb(v_row) - v_strip,
      null
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_business_settings', p_idempotency_key,
    to_jsonb(v_row) - 'id'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. admin_update_notification_template
-- ---------------------------------------------------------------------------

-- Tal changes the title and body of one type's template. push, body_mode,
-- recipient_kind and allowed_vars are fixed. body_mode override: the body is
-- written at each send, so p_body must be null; otherwise it is required.
-- Both are trimmed; title 1-200, body 1-1000. Each must render with the
-- type's allowed fields (private.template_sample_vars): otherwise
-- TEMPLATE_INVALID with detail.field title | body. A new version applies to
-- new notifications only (existing ones keep their rendered payload).
-- Result: {type, title, body, version}.
create function public.admin_update_notification_template(
  p_type text,
  p_title text,
  p_body text,
  p_expected_version integer,
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
  v_old public.notification_templates;
  v_new public.notification_templates;
  v_title text := btrim(p_title);
  v_body text := btrim(p_body);
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_notification_template', p_idempotency_key,
    jsonb_build_object(
      'type', p_type, 'title', p_title, 'body', p_body,
      'expected_version', p_expected_version
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_expected_version is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select t.* into v_old
  from public.notification_templates t
  where t.type = p_type
  for update;

  if v_old.type is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field":"type"}';
  end if;

  if v_title is null or char_length(v_title) not between 1 and 200 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field":"title"}';
  end if;

  if v_old.body_mode = 'override' then
    if p_body is not null then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = '{"field":"body"}';
    end if;
  elsif v_body is null or char_length(v_body) not between 1 and 1000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field":"body"}';
  end if;

  begin
    perform private.render_notification_text(
      v_title, private.template_sample_vars(v_old.allowed_vars)
    );
  exception when sqlstate 'P0001' then
    raise exception 'TEMPLATE_INVALID' using errcode = 'P0001',
      detail = '{"field":"title"}';
  end;

  if v_body is not null then
    begin
      perform private.render_notification_text(
        v_body, private.template_sample_vars(v_old.allowed_vars)
      );
    exception when sqlstate 'P0001' then
      raise exception 'TEMPLATE_INVALID' using errcode = 'P0001',
        detail = '{"field":"body"}';
    end;
  end if;

  if v_old.version <> p_expected_version then
    raise exception 'STALE_VERSION' using errcode = 'P0001';
  end if;

  v_new := v_old;
  if v_title is distinct from v_old.title or v_body is distinct from v_old.body then
    update public.notification_templates t
    set title = v_title,
        body = v_body,
        version = t.version + 1,
        updated_at = now(),
        updated_by = v_actor
    where t.type = v_old.type
    returning t.* into v_new;

    -- The type is kept in "after" (audit_diff keeps changed columns only).
    perform private.audit(
      v_actor, 'admin', 'admin_update_notification_template',
      'notification_templates', null, null, null,
      to_jsonb(v_old) - 'type', to_jsonb(v_new), null
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_notification_template', p_idempotency_key,
    jsonb_build_object(
      'type', v_new.type, 'title', v_new.title, 'body', v_new.body,
      'version', v_new.version
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function private.template_sample_vars(text[]) from public, anon, authenticated, service_role;

revoke execute on function public.admin_update_business_settings(jsonb, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_business_settings(jsonb, integer, uuid) to authenticated;

revoke execute on function public.admin_update_notification_template(text, text, text, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_notification_template(text, text, text, integer, uuid) to authenticated;
