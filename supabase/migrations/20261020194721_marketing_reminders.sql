-- Story 5.11: marketing reminders for Tal (CAP-34, CAP-35, AD-11, AD-12).
-- Additive only: no drop, no constraint change (marketing_reminder is in
-- notification_templates since 2.12, body_mode override, recipient admin).
--
-- The user runs it in the Supabase SQL Editor and the main session
-- registers it (apply_migration through the MCP is declined).
-- admin_update_business_settings is rebuilt from its live definition
-- (20261006194417, still the live one on 2026-10-20) and
-- private.job_intervals from 20261019233918 (live), each with only the
-- additions below; every other branch and row is unchanged.
--
-- 1. public.marketing_reminder_texts (Tal's texts, seeded with 20).
-- 2. private.marketing_reminder_slots (the slots already sent).
-- 3. admin_add_marketing_reminder_text / admin_update_marketing_reminder_text.
-- 4. admin_update_business_settings: the marketing_reminder_schedule branch.
-- 5. private.job_marketing_reminders (every 5 minutes).
-- 6. private.job_intervals: + marketing_reminders.
-- 7. Grants.
-- 8. Schedule.

-- ---------------------------------------------------------------------------
-- 1. The texts
-- ---------------------------------------------------------------------------

-- One row per text. Hebrew stays in this table (data Tal edits, AD-5).
-- last_sent_at drives the rotation: the job sends the active text sent
-- longest ago (never sent first), then sort_order, then id. No delete (user
-- decision 2026-10-20: add, edit, on/off).
create table public.marketing_reminder_texts (
  id uuid primary key default gen_random_uuid(),
  body text not null
    constraint marketing_reminder_texts_body_check
      check (char_length(btrim(body, E' \t\r\n' || chr(160))) between 1 and 500),
  active boolean not null default true,
  sort_order integer not null,
  last_sent_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index marketing_reminder_texts_rotation_idx
  on public.marketing_reminder_texts (last_sent_at nulls first, sort_order, id)
  where active;

alter table public.marketing_reminder_texts enable row level security;

-- Tal only (security-and-rpc-rules: the marketing texts are admin's alone).
create policy marketing_reminder_texts_authenticated_select
  on public.marketing_reminder_texts
  for select to authenticated
  using ((select private.is_admin()));

revoke all on table public.marketing_reminder_texts from public, anon, authenticated, service_role;
grant select on table public.marketing_reminder_texts to authenticated;

-- The seed (user decision 2026-10-20): notification-matrix's 10, with #5
-- replaced and the morning/evening words removed from #1 and #10, plus 10
-- new ones in the same voice.
insert into public.marketing_reminder_texts (body, sort_order)
values
  ('טל, השולחן לא יתמלא מעצמו. פוסט אחד, עכשיו.', 1),
  ('האינסטגרם שלך שולח דרישת שלום. הוא מתגעגע. תעלי משהו.', 2),
  ('יש אמא אחת בחופשת לידה שעוד לא יודעת עלייך. זה התפקיד שלך היום.', 3),
  ('לא, לסדר את המגירה זה לא שיווק. סטורי אחד. קדימה.', 4),
  ('ספרי בפוסט למה התחלת את כל זה. אנשים מתחברים לסיפורים, לא למבצעים.', 5),
  ('תמונה של השקשוקה של השבוע עושה יותר מכל פרסומת. צלמי ותעלי.', 6),
  ('בקשי המלצה מלקוחה מרוצה. היא תשמח, ואת תרוויחי. חמש דקות.', 7),
  ('תזכורת ידידותית ולגמרי לא פסיבית-אגרסיבית: מתי פרסמת בפעם האחרונה?', 8),
  ('שתפי בקבוצת אמהות אחת את המפגש הקרוב. אחת. זה הכול.', 9),
  ('סטורי מאחורי הקלעים של הבראנץ׳ הבא עושה חשק לבוא. את יודעת מה לעשות.', 10),
  ('שלושה סטוריז השבוע. לא ארבעה, לא אפס. שלושה. מתחילות עכשיו.', 11),
  ('הלקוחות שלך מתות לשתף, הן רק מחכות שתבקשי. תבקשי.', 12),
  ('צילום של שולחן ערוך שווה אלף מילים. אין צורך באלף מילים. רק בצילום.', 13),
  ('מישהי בקבוצת אמהות שואלת עכשיו "מה עושים עם התינוק כל היום?". יש לך תשובה.', 14),
  ('חמש דקות של שיווק עכשיו שוות שעה של דאגה אחר כך. טיימר. קדימה.', 15),
  ('עוד לא סיפרת השבוע מה מבשלים בבראנץ׳ הבא. זה סוד? כי זה לא אמור להיות סוד.', 16),
  ('תעני היום לכל תגובה ולכל הודעה שמחכה. כן, גם לזו מלפני שבוע.', 17),
  ('האלגוריתם לא יודע כמה את מוכשרת. צריך להראות לו.', 18),
  ('תגיבי היום לחמישה פוסטים של אמהות. נוכחות זה גם שיווק.', 19),
  ('פוסט לא צריך להיות מושלם. הוא צריך להתפרסם. לחצי על "שיתוף".', 20);

-- ---------------------------------------------------------------------------
-- 2. The slots already sent
-- ---------------------------------------------------------------------------

-- One row per slot the job handled: slot_key = the local "YYYY-MM-DD HH:MM"
-- of the slot (also the notification's discriminator, AD-12). The primary
-- key makes a rerun or a parallel run a no-op. Rows older than 30 days are
-- deleted by the job itself.
create table private.marketing_reminder_slots (
  slot_key text primary key
    check (slot_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$'),
  text_id uuid not null references public.marketing_reminder_texts (id),
  created_at timestamptz not null default now()
);

create index marketing_reminder_slots_created_at_idx
  on private.marketing_reminder_slots (created_at);
create index marketing_reminder_slots_text_id_idx
  on private.marketing_reminder_slots (text_id);

alter table private.marketing_reminder_slots enable row level security;
revoke all on table private.marketing_reminder_slots from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Admin RPCs for the texts
-- ---------------------------------------------------------------------------

-- Adds a text at the end of the list (sort_order = max + 1), active.
-- The body is trimmed like the templates (4.7: spaces, tabs, line breaks
-- and no-break spaces); empty or over 500 characters: INVALID_INPUT
-- (field body). Result: {text_id, body, active, sort_order, version}.
create function public.admin_add_marketing_reminder_text(
  p_body text,
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
  v_body text := btrim(p_body, E' \t\r\n' || chr(160));
  v_text public.marketing_reminder_texts;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_add_marketing_reminder_text', p_idempotency_key,
    jsonb_build_object('body', p_body)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if v_body is null or char_length(v_body) not between 1 and 500 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field":"body"}';
  end if;

  -- Two adds at once never take the same place at the end.
  perform pg_advisory_xact_lock(hashtext('marketing_reminder_texts'));

  insert into public.marketing_reminder_texts (body, sort_order)
  values (
    v_body,
    coalesce((select max(t.sort_order) from public.marketing_reminder_texts t), 0) + 1
  )
  returning * into v_text;

  perform private.audit(
    v_actor, 'admin', 'admin_add_marketing_reminder_text',
    'marketing_reminder_texts', v_text.id, null, null, null, to_jsonb(v_text)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_add_marketing_reminder_text', p_idempotency_key,
    jsonb_build_object(
      'text_id', v_text.id, 'body', v_text.body, 'active', v_text.active,
      'sort_order', v_text.sort_order, 'version', v_text.version
    )
  );
end;
$$;

-- Edits a text's body and turns it on or off, against the version the
-- screen read (STALE_VERSION, checked right after the lock, before the
-- values, like 4.7). Unknown id: NOT_FOUND. The same values change nothing
-- (no new version, no audit). Result: {text_id, body, active, version}.
create function public.admin_update_marketing_reminder_text(
  p_text_id uuid,
  p_body text,
  p_active boolean,
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
  v_body text := btrim(p_body, E' \t\r\n' || chr(160));
  v_old public.marketing_reminder_texts;
  v_new public.marketing_reminder_texts;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_marketing_reminder_text', p_idempotency_key,
    jsonb_build_object(
      'text_id', p_text_id, 'body', p_body, 'active', p_active,
      'expected_version', p_expected_version
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_text_id is null or p_expected_version is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select t.* into v_old
  from public.marketing_reminder_texts t
  where t.id = p_text_id
  for update;

  if v_old.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_old.version <> p_expected_version then
    raise exception 'STALE_VERSION' using errcode = 'P0001';
  end if;

  if v_body is null or char_length(v_body) not between 1 and 500 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field":"body"}';
  end if;

  if p_active is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field":"active"}';
  end if;

  v_new := v_old;
  if v_body is distinct from v_old.body or p_active is distinct from v_old.active then
    update public.marketing_reminder_texts t
    set body = v_body,
        active = p_active,
        version = t.version + 1,
        updated_at = now()
    where t.id = v_old.id
    returning t.* into v_new;

    perform private.audit(
      v_actor, 'admin', 'admin_update_marketing_reminder_text',
      'marketing_reminder_texts', v_new.id, null, null,
      to_jsonb(v_old), to_jsonb(v_new)
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_marketing_reminder_text', p_idempotency_key,
    jsonb_build_object(
      'text_id', v_new.id, 'body', v_new.body, 'active', v_new.active,
      'version', v_new.version
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. admin_update_business_settings: + marketing_reminder_schedule
-- ---------------------------------------------------------------------------

-- As in 20261006194417, plus one branch: marketing_reminder_schedule is an
-- array of 0..7 objects, each with exactly "weekday" (a whole number 0..6,
-- 0 = Sunday, each day once) and "time" ("HH:MM", 00:00..23:59). Stored
-- sorted by weekday; an empty array = no reminders.
create or replace function public.admin_update_business_settings(
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
  v_schedule jsonb;
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

  if v_old.version <> p_expected_version then
    raise exception 'STALE_VERSION' using errcode = 'P0001';
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

    elsif v_key = 'marketing_reminder_schedule' then
      -- Story 5.11: 0..7 slots, one per weekday at most, each exactly
      -- {"weekday": 0..6, "time": "HH:MM"}.
      if (case
           when jsonb_typeof(v_value) <> 'array' then true
           when jsonb_array_length(v_value) > 7 then true
           when exists (
             select 1 from jsonb_array_elements(v_value) e
             where case
               when jsonb_typeof(e) <> 'object' then true
               when (select array_agg(k order by k) from jsonb_object_keys(e) k)
                    is distinct from array['time', 'weekday'] then true
               when jsonb_typeof(e -> 'weekday') <> 'number' then true
               when (e ->> 'weekday')::numeric not in (0, 1, 2, 3, 4, 5, 6) then true
               when jsonb_typeof(e -> 'time') <> 'string' then true
               else (e ->> 'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
             end
           ) then true
           else (select count(distinct (e ->> 'weekday')::numeric)
                 from jsonb_array_elements(v_value) e)
                <> jsonb_array_length(v_value)
         end) then
        raise exception 'INVALID_INPUT' using errcode = 'P0001',
          detail = jsonb_build_object('field', v_key)::text;
      end if;

      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'weekday', (e ->> 'weekday')::numeric::integer,
            'time', e ->> 'time'
          )
          order by (e ->> 'weekday')::numeric
        ),
        '[]'::jsonb
      )
      into v_schedule
      from jsonb_array_elements(v_value) e;
      v_row.marketing_reminder_schedule := v_schedule;

    else
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', v_key)::text;
    end if;
  end loop;

  if v_row.default_session_end_time <= v_row.default_session_start_time then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field":"default_session_end_time"}';
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
        marketing_reminder_schedule = v_row.marketing_reminder_schedule,
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
-- 5. The job (every 5 minutes)
-- ---------------------------------------------------------------------------

-- A slot = a schedule entry's local date + time in Asia/Jerusalem, for the
-- local today and yesterday (AD-8, AD-11: never the cron's time, so DST
-- never shifts it). Only the latest slot with slot <= p_now and
-- slot > p_now - 1 hour is handled; an older missed slot is skipped, never
-- sent late. With no active text nothing is recorded, so a text turned on
-- within the hour still sends. The slot row (on conflict do nothing) makes
-- a rerun or a parallel run a no-op, without rotating. Otherwise the active
-- text sent longest ago (never sent first, then sort_order, then id),
-- locked, gets last_sent_at = p_now and goes to every admin as
-- marketing_reminder (discriminator = the slot key, AD-12). Slot rows older
-- than 30 days are deleted. No exception is swallowed, so a failure shows
-- in "to handle" (job_failed). p_now is for tests and the manual check.
-- Returns the notifications created.
create function private.job_marketing_reminders(p_now timestamptz default now())
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_local_day date := (p_now at time zone 'Asia/Jerusalem')::date;
  v_schedule jsonb;
  v_slot_key text;
  v_text public.marketing_reminder_texts;
begin
  delete from private.marketing_reminder_slots s
  where s.created_at < now() - interval '30 days';

  select s.marketing_reminder_schedule into v_schedule
  from public.business_settings s;

  select to_char(x.local_at, 'YYYY-MM-DD HH24:MI')
  into v_slot_key
  from (
    select d.day + (e ->> 'time')::time as local_at
    from jsonb_array_elements(coalesce(v_schedule, '[]'::jsonb)) e
    cross join (values (v_local_day), (v_local_day - 1)) d(day)
    where extract(dow from d.day) = (e ->> 'weekday')::integer
  ) x
  where (x.local_at at time zone 'Asia/Jerusalem') <= p_now
    and (x.local_at at time zone 'Asia/Jerusalem') > p_now - interval '1 hour'
  order by (x.local_at at time zone 'Asia/Jerusalem') desc
  limit 1;

  if v_slot_key is null then
    return 0;
  end if;

  select t.* into v_text
  from public.marketing_reminder_texts t
  where t.active
  order by t.last_sent_at nulls first, t.sort_order, t.id
  limit 1
  for update;

  if v_text.id is null then
    return 0;
  end if;

  insert into private.marketing_reminder_slots (slot_key, text_id)
  values (v_slot_key, v_text.id)
  on conflict (slot_key) do nothing;

  if not found then
    return 0;
  end if;

  update public.marketing_reminder_texts t
  set last_sent_at = p_now
  where t.id = v_text.id;

  return private.enqueue_admin_notification(
    'marketing_reminder', v_slot_key, null, '/admin', v_text.body
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The scheduled jobs and their frequency (+ marketing_reminders)
-- ---------------------------------------------------------------------------

-- As in 20261019233918, plus marketing_reminders every 5 minutes.
create or replace function private.job_intervals()
returns table (jobname text, every interval)
language sql
stable
set search_path = ''
as $$
  values
    ('reminders'::text, interval '1 minute'),
    ('invoke_push_worker', interval '1 minute'),
    ('complete_events', interval '5 minutes'),
    ('refresh_credit_options', interval '15 minutes'),
    ('marketing_reminders', interval '5 minutes'),
    ('expiry_alerts', interval '1 hour'),
    ('auto_extend', interval '1 hour'),
    ('cleanup', interval '1 day');
$$;

-- ---------------------------------------------------------------------------
-- 7. Function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke execute on function public.admin_add_marketing_reminder_text(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_marketing_reminder_text(text, uuid) to authenticated;

revoke execute on function public.admin_update_marketing_reminder_text(uuid, text, boolean, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_marketing_reminder_text(uuid, text, boolean, integer, uuid) to authenticated;

revoke execute on function public.admin_update_business_settings(jsonb, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_business_settings(jsonb, integer, uuid) to authenticated;

-- The job and the helper get none (pg_cron runs the job as its owner).
revoke execute on function private.job_marketing_reminders(timestamptz) from public, anon, authenticated, service_role;
revoke execute on function private.job_intervals() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Schedule (AD-11): the frequency is only the maximum delay
-- ---------------------------------------------------------------------------

select cron.schedule('marketing_reminders', '*/5 * * * *', 'select private.job_marketing_reminders()');
