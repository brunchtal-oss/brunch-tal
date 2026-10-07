-- Story 5.17: the session reminder (AD-13, AD-23). No reminder is scheduled
-- ahead: private.job_reminders runs every minute and derives the due
-- reminders from the state. A confirmed booking with a customer, of a
-- published session that has not started, gets one 'reminder' once now()
-- reaches starts_at - lead, unless it was confirmed after that moment (a late
-- booking). lead = reminder_lead_hours from bookings.policy_snapshot (saved
-- by the booking RPC), never from business_settings, so a settings change
-- applies to new bookings only. Discriminator: booking id || ':' || the
-- session's revision, so a double run creates nothing (dedupe_key) and a
-- time change (a new revision) allows a new reminder; a change that keeps the
-- revision (capacity, description) sends nothing. The push goes through the
-- 5.8 queue; a push failure never touches the booking. No audit (no business
-- change). reminder's allowed_vars gains concept (4.7 contract: the caller
-- passes every allowed field); the template wording does not change.

-- ---------------------------------------------------------------------------
-- private.job_reminders (AD-13)
-- ---------------------------------------------------------------------------

-- Locks each due booking by id (for update of b skip locked): a booking held
-- by another transaction (for example a cancellation in progress) is handled
-- on the next run, and the job never waits (AD-6). {date} DD.MM and {time}
-- HH:MM in Jerusalem, {concept} the concept's name, as in
-- notify_booking_confirmed. Does not depend on the cron's time: it compares
-- with now(). Returns the number of new notifications. Called only by
-- pg_cron (as the owner); no grant.
create function private.job_reminders()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select
      b.id as booking_id,
      b.customer_id,
      e.id as event_id,
      e.revision,
      e.starts_at,
      c.name as concept
    from public.bookings b
    join public.events e on e.id = b.event_id
    join public.concepts c on c.id = e.concept_id
    where b.status = 'confirmed'
      and b.customer_id is not null
      and e.status = 'published'
      and now() < e.starts_at
      and now() >= e.starts_at
        - make_interval(hours => (b.policy_snapshot ->> 'reminder_lead_hours')::integer)
      and b.confirmed_at < e.starts_at
        - make_interval(hours => (b.policy_snapshot ->> 'reminder_lead_hours')::integer)
    order by b.id
    for update of b skip locked
  loop
    if private.enqueue_notification(
      v_row.customer_id,
      'reminder',
      v_row.booking_id::text || ':' || v_row.revision::text,
      jsonb_build_object(
        'date', private.format_day_month((v_row.starts_at at time zone 'Asia/Jerusalem')::date),
        'time', to_char(v_row.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI'),
        'concept', v_row.concept
      ),
      '/me/sessions/' || v_row.event_id::text
    ) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function private.job_reminders() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- reminder's allowed fields (the 4.7 contract)
-- ---------------------------------------------------------------------------

update public.notification_templates
set allowed_vars = array['date', 'time', 'concept']
where type = 'reminder';

-- ---------------------------------------------------------------------------
-- Schedule (AD-13): every minute; the frequency is only the maximum delay
-- ---------------------------------------------------------------------------

select cron.schedule('reminders', '* * * * *', 'select private.job_reminders()');
