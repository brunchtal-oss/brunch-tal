-- Story 3.12 review fixes: private.job_complete_events handles each session
-- in its own subtransaction, so a session that raises is skipped (with a
-- warning in the cron log) and the other ended sessions still complete. As
-- in 20261006111121 otherwise (create or replace, same signature).

-- Every published session with ends_at <= now(), by id. Lock order (AD-6):
-- the session (for update skip locked: a session held by another
-- transaction is handled on the next run), then its confirmed bookings by
-- id, then the entitlements of their allocations by id; then the updates,
-- the use movements and one audit row per session. Each session runs in its
-- own block: an error rolls back only that session (raise warning with the
-- event id, sqlstate and message) and the run goes on; the session is tried
-- again on the next run. An allocation from a credit (credit_id) is skipped
-- (no credits until 3.7). No notification and no push. Does not depend on
-- the cron's time: it compares with now(). Returns the number of sessions
-- completed. Called only by pg_cron (as the owner); no grant.
create or replace function private.job_complete_events()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_event_new public.events;
  v_count integer := 0;
begin
  for v_event in
    select e.*
    from public.events e
    where e.status = 'published'
      and e.ends_at <= now()
    order by e.id
    for update skip locked
  loop
    begin
      perform 1
      from public.bookings b
      where b.event_id = v_event.id
        and b.status = 'confirmed'
      order by b.id
      for update;

      perform 1
      from public.entitlements en
      where en.id in (
        select a.entitlement_id
        from public.booking_allocations a
        join public.bookings b on b.id = a.booking_id
        where b.event_id = v_event.id
          and b.status = 'confirmed'
          and a.entitlement_id is not null
      )
      order by en.id
      for update;

      insert into public.entitlement_movements (entitlement_id, booking_id, action, units)
      select distinct a.entitlement_id, b.id, 'use', 0
      from public.bookings b
      join public.booking_allocations a on a.booking_id = b.id
      where b.event_id = v_event.id
        and b.status = 'confirmed'
        and a.entitlement_id is not null
        and not exists (
          select 1
          from public.entitlement_movements m
          where m.booking_id = b.id
            and m.entitlement_id = a.entitlement_id
            and m.action = 'use'
        );

      update public.bookings
      set status = 'completed'
      where event_id = v_event.id
        and status = 'confirmed';

      update public.events
      set status = 'completed'
      where id = v_event.id
      returning * into v_event_new;

      perform private.audit(
        null, 'system', 'complete_event', 'events', v_event.id,
        null, v_event.id, to_jsonb(v_event), to_jsonb(v_event_new)
      );

      v_count := v_count + 1;
    exception when others then
      raise warning 'job_complete_events: event % failed: % %',
        v_event.id, sqlstate, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

revoke execute on function private.job_complete_events() from public, anon, authenticated, service_role;
