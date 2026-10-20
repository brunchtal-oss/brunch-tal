-- Story 5.11 review fix: at most one marketing reminder per local day.
-- 20261020194721 is already applied, so the job is replaced here with the
-- same signature and one change: once a slot of the local day was recorded,
-- the job returns 0 before locking any text. So moving a day's time after
-- its slot fired (09:00 sent, Sunday moved to 09:20) never sends a second
-- reminder that day, and a rerun never locks a text row.
--
-- The user runs it in the Supabase SQL Editor and the main session
-- registers it (apply_migration through the MCP is declined).

create or replace function private.job_marketing_reminders(p_now timestamptz default now())
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

  -- At most one reminder per local day (the slot's date, "YYYY-MM-DD").
  if exists (
    select 1
    from private.marketing_reminder_slots s
    where left(s.slot_key, 10) = left(v_slot_key, 10)
  ) then
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

-- The job gets no grant (pg_cron runs it as its owner).
revoke execute on function private.job_marketing_reminders(timestamptz) from public, anon, authenticated, service_role;
