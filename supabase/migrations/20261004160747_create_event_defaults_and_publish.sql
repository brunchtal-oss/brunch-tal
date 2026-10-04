-- Story 3.1, after the phone check (user decisions 2026-10-04):
-- 1. The default hours of a new session live in business_settings (AD-15),
--    10:30-14:30; Tal edits them in the settings screen (4.7). The create
--    form starts with them; the RPC still needs the times it is sent.
-- 2. One create screen: admin_create_event also takes the registration
--    close (registration_closes_local, sets the override) and publish
--    (true: the session is published in the same transaction, so there is
--    never a saved but unpublished session after "publish").

alter table public.business_settings
  add column default_session_start_time time not null default '10:30',
  add column default_session_end_time time not null default '14:30',
  add constraint business_settings_default_session_times_check
    check (default_session_end_time > default_session_start_time);

-- Tal creates a session (CAP-12). p_event: concept_id (not archived), date,
-- start_time, end_time; optional kind and description (default: the
-- concept's), capacity_adults (default:
-- business_settings.default_capacity_{regular|couple} by the kind),
-- display_price_agorot, registration_closes_local (default: the trigger's
-- rule) and publish (boolean, default false: a draft). One audit row holds
-- the saved session. Result: {event_id, status}.
create or replace function public.admin_create_event(p_event jsonb, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_concept public.concepts;
  v_concept_text text;
  v_publish boolean := false;
  v_settings public.business_settings;
  v_row public.events;
  v_saved public.events;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_create_event', p_idempotency_key, p_event
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_event is null or jsonb_typeof(p_event) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_concept_text := p_event ->> 'concept_id';
  if jsonb_typeof(p_event -> 'concept_id') is distinct from 'string'
     or v_concept_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "concept_id"}';
  end if;

  if p_event ? 'publish' then
    if jsonb_typeof(p_event -> 'publish') <> 'boolean' then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = '{"field": "publish"}';
    end if;
    v_publish := (p_event ->> 'publish')::boolean;
  end if;

  select c.* into v_concept
  from public.concepts c
  where c.id = v_concept_text::uuid
    and c.archived_at is null;

  if v_concept.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "concept_id"}';
  end if;

  select s.* into v_settings from public.business_settings s;

  v_row.concept_id := v_concept.id;
  v_row.kind := v_concept.default_kind;
  v_row.description := v_concept.description;
  v_row := private.apply_event_changes(
    v_row,
    p_event - 'concept_id' - 'publish',
    array['date', 'start_time', 'end_time', 'kind', 'description',
          'capacity_adults', 'display_price_agorot', 'registration_closes_local']
  );
  if not (p_event ? 'capacity_adults') then
    v_row.capacity_adults := case v_row.kind
      when 'couple' then v_settings.default_capacity_couple
      else v_settings.default_capacity_regular
    end;
  end if;

  v_saved := private.save_event(v_row, true);

  if v_publish then
    update public.events
    set status = 'published'
    where id = v_saved.id
    returning * into v_saved;
  end if;

  perform private.audit(
    v_actor, 'admin', 'admin_create_event', 'events', v_saved.id,
    null, v_saved.id, null, to_jsonb(v_saved)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_create_event', p_idempotency_key,
    jsonb_build_object('event_id', v_saved.id, 'status', v_saved.status)
  );
end;
$$;

revoke execute on function public.admin_create_event(jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_create_event(jsonb, uuid) to authenticated;
