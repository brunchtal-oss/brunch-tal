-- Story 3.1: concepts and session management (CAP-12, CAP-34, CAP-41).
-- Tables: concepts (the five starting concepts) and events. Triggers: the
-- registration close (computed from business_settings unless Tal set it for
-- the session) and the revision (AD-8, AD-12). Admin RPCs:
-- admin_create_event, admin_duplicate_event, admin_update_event,
-- admin_publish_event. The browser sends local times (date, HH:MM); SQL
-- turns them into instants in Asia/Jerusalem (AD-8). AD-5 grants and
-- idempotency, AD-15 values from the concept and the settings at creation,
-- AD-16 concepts (no title, no image here), AD-19 audit with event_id.
-- No concept RPCs (4.8), no images (5.4), no event_products (deferred).
--
-- The Hebrew seed rows are data (Tal edits them in the admin), not code text.

-- ---------------------------------------------------------------------------
-- concepts
-- ---------------------------------------------------------------------------

-- The title of a session is always "בראנץ׳ {concepts.name}" (no
-- events.title). theme_key / generic_paper_key map to design values only in
-- lib/concepts/themes.ts (AD-16); generic_paper_key is set only for the
-- generic theme. archived_at: not offered for a new session.
create table public.concepts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  description text check (description is null or char_length(description) <= 2000),
  default_kind text not null check (default_kind in ('regular', 'couple')),
  theme_key text not null
    check (theme_key in ('mothers', 'couples', 'grandma', 'grandpa', 'greek', 'generic')),
  generic_paper_key text
    check (
      generic_paper_key is null
      or generic_paper_key in ('olive', 'plum', 'jade', 'mustard', 'slate', 'clay')
    ),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  constraint concepts_generic_paper_check
    check ((theme_key = 'generic') = (generic_paper_key is not null))
);

alter table public.concepts enable row level security;

insert into public.concepts (name, description, default_kind, theme_key, sort_order)
values
  ('אמהות בחל״ד', null, 'regular', 'mothers', 1),
  ('זוגות', null, 'couple', 'couples', 2),
  ('עם סבתוש', null, 'couple', 'grandma', 3),
  ('עם סבוש', null, 'couple', 'grandpa', 4),
  ('יווני', null, 'regular', 'greek', 5);

-- ---------------------------------------------------------------------------
-- events
-- ---------------------------------------------------------------------------

-- A session. kind, description and capacity_adults are filled from the
-- concept and business_settings at creation (AD-15) and edited per session.
-- registration_closes_at is computed by a trigger unless
-- registration_close_overridden (AD-8). revision goes up only in the trigger
-- (AD-12). display_price_agorot: null = the matching product's price
-- (display only). A draft is never returned to a customer or a guest.
create table public.events (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid not null references public.concepts (id) on delete restrict,
  kind text not null check (kind in ('regular', 'couple')),
  description text check (description is null or char_length(description) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity_adults integer not null check (capacity_adults > 0),
  registration_closes_at timestamptz not null,
  registration_close_overridden boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'published', 'cancelled', 'completed')),
  revision integer not null default 1 check (revision > 0),
  waitlist_cycle integer not null default 0 check (waitlist_cycle >= 0),
  display_price_agorot integer check (display_price_agorot is null or display_price_agorot >= 0),
  created_at timestamptz not null default now(),
  constraint events_ends_at_check check (ends_at > starts_at),
  constraint events_registration_closes_at_check check (registration_closes_at <= starts_at)
);

alter table public.events enable row level security;

create index events_concept_id_idx on public.events (concept_id);
create index events_starts_at_idx on public.events (starts_at);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Registration close (AD-8): on insert, when starts_at changes, or when the
-- per-session value is given back to the settings, and only while it is not
-- overridden, it is private.registration_closes_at with the current
-- business_settings. A rule that would close after the start (0 days before,
-- a late time) closes at the start.
create function private.events_registration_close()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_settings public.business_settings;
begin
  if new.registration_close_overridden then
    return new;
  end if;

  if tg_op = 'INSERT'
     or new.starts_at is distinct from old.starts_at
     or old.registration_close_overridden then
    select s.* into v_settings from public.business_settings s;
    new.registration_closes_at := least(
      private.registration_closes_at(
        new.starts_at,
        v_settings.registration_close_days_before,
        v_settings.registration_close_local_time
      ),
      new.starts_at
    );
  end if;

  return new;
end;
$$;

create trigger events_registration_close
  before insert or update on public.events
  for each row execute function private.events_registration_close();

-- revision (AD-12): a new event starts at 1; it goes up by one only when
-- starts_at, ends_at or kind change, or the status becomes cancelled. No
-- other write can set it.
create function private.events_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    return new;
  end if;

  new.revision := old.revision;
  if new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.kind is distinct from old.kind
     or (new.status = 'cancelled' and old.status is distinct from 'cancelled') then
    new.revision := old.revision + 1;
  end if;

  return new;
end;
$$;

create trigger events_revision
  before insert or update on public.events
  for each row execute function private.events_revision();

-- ---------------------------------------------------------------------------
-- Policies and table grants (AD-5): reads only, no writes from the browser
-- ---------------------------------------------------------------------------

create policy concepts_public_select on public.concepts
  for select to anon, authenticated
  using (true);

create policy events_anon_select on public.events
  for select to anon
  using (status <> 'draft');

create policy events_authenticated_select on public.events
  for select to authenticated
  using (status <> 'draft' or (select private.is_admin()));

revoke all on table public.concepts from public, anon, authenticated, service_role;
grant select on table public.concepts to anon, authenticated;

revoke all on table public.events from public, anon, authenticated, service_role;
grant select on table public.events to anon, authenticated;

-- ---------------------------------------------------------------------------
-- private helpers
-- ---------------------------------------------------------------------------

-- A local date and time in Jerusalem as an instant (AD-8). Pure.
create function private.local_instant(p_day date, p_time time)
returns timestamptz
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select (p_day + p_time) at time zone 'Asia/Jerusalem';
$$;

-- Applies a jsonb of changes to an event row and returns the new row.
-- Keys outside p_allowed raise INVALID_INPUT with detail.field (the key).
-- Values: date 'YYYY-MM-DD'; start_time / end_time 'HH:MM' (the same local
-- day); kind regular | couple; description a string (trimmed, empty = null)
-- or null; capacity_adults a whole number > 0; display_price_agorot null or
-- a whole number >= 0; registration_closes_local 'YYYY-MM-DDTHH:MM' (sets
-- the override) or null (back to the settings). When any of date,
-- start_time, end_time is given, starts_at and ends_at are rebuilt from the
-- saved local values and the given ones; a new row (starts_at null) needs
-- all three. ends_at must be after starts_at (field end_time).
create function private.apply_event_changes(
  p_row public.events,
  p_changes jsonb,
  p_allowed text[]
)
returns public.events
language plpgsql
stable
set search_path = ''
as $$
declare
  v_row public.events := p_row;
  v_key text;
  v_value jsonb;
  v_type text;
  v_text text;
  v_num numeric;
  v_day date;
  v_start time;
  v_end time;
  v_when_changed boolean := false;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if p_row.starts_at is not null then
    v_day := (p_row.starts_at at time zone 'Asia/Jerusalem')::date;
    v_start := (p_row.starts_at at time zone 'Asia/Jerusalem')::time;
    v_end := (p_row.ends_at at time zone 'Asia/Jerusalem')::time;
  end if;

  for v_key, v_value in select e.key, e.value from jsonb_each(p_changes) e loop
    v_type := jsonb_typeof(v_value);
    v_text := v_value #>> '{}';

    if not (v_key = any (p_allowed)) then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', v_key)::text;
    end if;

    case v_key
      when 'date' then
        if v_type <> 'string' or v_text !~ '^\d{4}-\d{2}-\d{2}$' then
          raise exception 'INVALID_INPUT' using errcode = 'P0001',
            detail = jsonb_build_object('field', v_key)::text;
        end if;
        begin
          v_day := v_text::date;
        exception when others then
          raise exception 'INVALID_INPUT' using errcode = 'P0001',
            detail = jsonb_build_object('field', v_key)::text;
        end;
        v_when_changed := true;
      when 'start_time', 'end_time' then
        if v_type <> 'string' or v_text !~ '^([01]\d|2[0-3]):[0-5]\d$' then
          raise exception 'INVALID_INPUT' using errcode = 'P0001',
            detail = jsonb_build_object('field', v_key)::text;
        end if;
        if v_key = 'start_time' then
          v_start := v_text::time;
        else
          v_end := v_text::time;
        end if;
        v_when_changed := true;
      when 'kind' then
        if v_type <> 'string' or v_text not in ('regular', 'couple') then
          raise exception 'INVALID_INPUT' using errcode = 'P0001',
            detail = jsonb_build_object('field', v_key)::text;
        end if;
        v_row.kind := v_text;
      when 'description' then
        if v_type not in ('string', 'null')
           or char_length(btrim(coalesce(v_text, ''))) > 2000 then
          raise exception 'INVALID_INPUT' using errcode = 'P0001',
            detail = jsonb_build_object('field', v_key)::text;
        end if;
        v_row.description := nullif(btrim(v_text), '');
      when 'capacity_adults', 'display_price_agorot' then
        if v_type = 'null' and v_key = 'display_price_agorot' then
          v_row.display_price_agorot := null;
        else
          if v_type <> 'number' then
            raise exception 'INVALID_INPUT' using errcode = 'P0001',
              detail = jsonb_build_object('field', v_key)::text;
          end if;
          v_num := v_text::numeric;
          if v_num <> trunc(v_num)
             or v_num > 2147483647
             or (v_key = 'capacity_adults' and v_num < 1)
             or (v_key = 'display_price_agorot' and v_num < 0) then
            raise exception 'INVALID_INPUT' using errcode = 'P0001',
              detail = jsonb_build_object('field', v_key)::text;
          end if;
          if v_key = 'capacity_adults' then
            v_row.capacity_adults := v_num::integer;
          else
            v_row.display_price_agorot := v_num::integer;
          end if;
        end if;
      when 'registration_closes_local' then
        if v_type = 'null' then
          v_row.registration_close_overridden := false;
        else
          if v_type <> 'string'
             or v_text !~ '^\d{4}-\d{2}-\d{2}[T ]([01]\d|2[0-3]):[0-5]\d$' then
            raise exception 'INVALID_INPUT' using errcode = 'P0001',
              detail = jsonb_build_object('field', v_key)::text;
          end if;
          begin
            v_row.registration_closes_at :=
              replace(v_text, 'T', ' ')::timestamp at time zone 'Asia/Jerusalem';
          exception when others then
            raise exception 'INVALID_INPUT' using errcode = 'P0001',
              detail = jsonb_build_object('field', v_key)::text;
          end;
          v_row.registration_close_overridden := true;
        end if;
      else
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
    end case;
  end loop;

  if v_when_changed or p_row.starts_at is null then
    if v_day is null then
      raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "date"}';
    elsif v_start is null then
      raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "start_time"}';
    elsif v_end is null then
      raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "end_time"}';
    end if;
    v_row.starts_at := private.local_instant(v_day, v_start);
    v_row.ends_at := private.local_instant(v_day, v_end);
    if v_row.ends_at <= v_row.starts_at then
      raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "end_time"}';
    end if;
  end if;

  return v_row;
end;
$$;

-- Inserts (p_insert) or updates an event row. A table check or a missing
-- value becomes INVALID_INPUT with detail.field: the close after the start is
-- registration_closes_local, the end before the start end_time, otherwise the
-- column.
create function private.save_event(p_row public.events, p_insert boolean)
returns public.events
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_saved public.events;
  v_constraint text;
  v_column text;
  v_field text;
begin
  begin
    if p_insert then
      insert into public.events (
        concept_id, kind, description, starts_at, ends_at, capacity_adults,
        registration_closes_at, registration_close_overridden, status,
        display_price_agorot
      )
      values (
        p_row.concept_id, p_row.kind, p_row.description, p_row.starts_at,
        p_row.ends_at, p_row.capacity_adults,
        -- Replaced by the trigger unless overridden.
        coalesce(p_row.registration_closes_at, p_row.starts_at),
        coalesce(p_row.registration_close_overridden, false), 'draft',
        p_row.display_price_agorot
      )
      returning * into v_saved;
    else
      update public.events
      set kind = p_row.kind,
          description = p_row.description,
          starts_at = p_row.starts_at,
          ends_at = p_row.ends_at,
          capacity_adults = p_row.capacity_adults,
          registration_closes_at = p_row.registration_closes_at,
          registration_close_overridden = p_row.registration_close_overridden,
          display_price_agorot = p_row.display_price_agorot
      where id = p_row.id
      returning * into v_saved;
    end if;
  exception
    when check_violation or not_null_violation then
      get stacked diagnostics
        v_constraint = constraint_name,
        v_column = column_name;
      v_field := case v_constraint
        when 'events_registration_closes_at_check' then 'registration_closes_local'
        when 'events_ends_at_check' then 'end_time'
        else coalesce(
          nullif(v_column, ''),
          substring(v_constraint from '^events_(.*)_check$')
        )
      end;
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', v_field)::text;
  end;

  return v_saved;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Tal creates a session as a draft (CAP-12). p_event: concept_id (not
-- archived), date, start_time, end_time; optional kind and description
-- (default: the concept's), capacity_adults (default:
-- business_settings.default_capacity_{regular|couple} by the kind) and
-- display_price_agorot. The close is computed by the trigger. Result:
-- {event_id}.
create function public.admin_create_event(p_event jsonb, p_idempotency_key uuid)
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
    p_event - 'concept_id',
    array['date', 'start_time', 'end_time', 'kind', 'description',
          'capacity_adults', 'display_price_agorot']
  );
  if not (p_event ? 'capacity_adults') then
    v_row.capacity_adults := case v_row.kind
      when 'couple' then v_settings.default_capacity_couple
      else v_settings.default_capacity_regular
    end;
  end if;

  v_saved := private.save_event(v_row, true);

  perform private.audit(
    v_actor, 'admin', 'admin_create_event', 'events', v_saved.id,
    null, v_saved.id, null, to_jsonb(v_saved)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_create_event', p_idempotency_key,
    jsonb_build_object('event_id', v_saved.id)
  );
end;
$$;

-- A new draft from an existing session on another date (CAP-12): the same
-- concept, kind, description, capacity and display price; the close is
-- computed again (never copied). The source does not change. Result:
-- {event_id}.
create function public.admin_duplicate_event(
  p_event_id uuid,
  p_date date,
  p_start_time time,
  p_end_time time,
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
  v_source public.events;
  v_row public.events;
  v_saved public.events;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_duplicate_event', p_idempotency_key,
    jsonb_build_object(
      'event_id', p_event_id,
      'date', p_date,
      'start_time', p_start_time,
      'end_time', p_end_time
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  select e.* into v_source
  from public.events e
  where e.id = p_event_id;

  if v_source.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "event_id"}';
  end if;
  if p_date is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "date"}';
  elsif p_start_time is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "start_time"}';
  elsif p_end_time is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "end_time"}';
  end if;

  v_row.concept_id := v_source.concept_id;
  v_row.kind := v_source.kind;
  v_row.description := v_source.description;
  v_row.capacity_adults := v_source.capacity_adults;
  v_row.display_price_agorot := v_source.display_price_agorot;
  v_row.starts_at := private.local_instant(p_date, p_start_time);
  v_row.ends_at := private.local_instant(p_date, p_end_time);
  if v_row.ends_at <= v_row.starts_at then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "end_time"}';
  end if;

  v_saved := private.save_event(v_row, true);

  perform private.audit(
    v_actor, 'admin', 'admin_duplicate_event', 'events', v_saved.id,
    null, v_saved.id, null, to_jsonb(v_saved)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_duplicate_event', p_idempotency_key,
    jsonb_build_object('event_id', v_saved.id)
  );
end;
$$;

-- Tal changes fields of a session (value-change-row). p_changes: a non-empty
-- subset of date, start_time, end_time, kind, description, capacity_adults,
-- registration_closes_local (sets the override; null gives it back to the
-- settings), display_price_agorot. Any other key (concept_id too) ->
-- INVALID_INPUT. A cancelled or completed session is not edited. Locks the
-- row; the audit row (admin_update_event, event_id) holds the old and new
-- values; a change that leaves the row as it was writes nothing. The impact
-- view for a new time when there are bookings comes in 3.8. Result:
-- {event_id}.
create function public.admin_update_event(
  p_event_id uuid,
  p_changes jsonb,
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
  v_old public.events;
  v_row public.events;
  v_saved public.events;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_event', p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'changes', p_changes)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_changes is null
     or jsonb_typeof(p_changes) <> 'object'
     or p_changes = '{}'::jsonb then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select e.* into v_old
  from public.events e
  where e.id = p_event_id
  for update;

  if v_old.id is null or v_old.status in ('cancelled', 'completed') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "event_id"}';
  end if;

  v_row := private.apply_event_changes(
    v_old,
    p_changes,
    array['date', 'start_time', 'end_time', 'kind', 'description',
          'capacity_adults', 'registration_closes_local', 'display_price_agorot']
  );

  if v_row is distinct from v_old then
    v_saved := private.save_event(v_row, false);

    if v_saved is distinct from v_old then
      perform private.audit(
        v_actor, 'admin', 'admin_update_event', 'events', v_saved.id,
        null, v_saved.id, to_jsonb(v_old), to_jsonb(v_saved)
      );
    end if;
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_event', p_idempotency_key,
    jsonb_build_object('event_id', v_old.id)
  );
end;
$$;

-- Tal publishes a draft (draft -> published). A session that is already
-- published succeeds without a change; a cancelled or completed one ->
-- INVALID_INPUT. Result: {event_id, status}.
create function public.admin_publish_event(p_event_id uuid, p_idempotency_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_old public.events;
  v_saved public.events;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_publish_event', p_idempotency_key,
    jsonb_build_object('event_id', p_event_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  select e.* into v_old
  from public.events e
  where e.id = p_event_id
  for update;

  if v_old.id is null or v_old.status not in ('draft', 'published') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "event_id"}';
  end if;

  if v_old.status = 'draft' then
    update public.events
    set status = 'published'
    where id = v_old.id
    returning * into v_saved;

    perform private.audit(
      v_actor, 'admin', 'admin_publish_event', 'events', v_saved.id,
      null, v_saved.id, to_jsonb(v_old), to_jsonb(v_saved)
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_publish_event', p_idempotency_key,
    jsonb_build_object('event_id', v_old.id, 'status', 'published')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5)
-- ---------------------------------------------------------------------------

-- Triggers and internal helpers: no API role executes them.
revoke execute on function private.events_registration_close() from public, anon, authenticated, service_role;
revoke execute on function private.events_revision() from public, anon, authenticated, service_role;
revoke execute on function private.local_instant(date, time) from public, anon, authenticated, service_role;
revoke execute on function private.apply_event_changes(public.events, jsonb, text[]) from public, anon, authenticated, service_role;
revoke execute on function private.save_event(public.events, boolean) from public, anon, authenticated, service_role;

revoke execute on function public.admin_create_event(jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_create_event(jsonb, uuid) to authenticated;

revoke execute on function public.admin_duplicate_event(uuid, date, time, time, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_duplicate_event(uuid, date, time, time, uuid) to authenticated;

revoke execute on function public.admin_update_event(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_event(uuid, jsonb, uuid) to authenticated;

revoke execute on function public.admin_publish_event(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_publish_event(uuid, uuid) to authenticated;
