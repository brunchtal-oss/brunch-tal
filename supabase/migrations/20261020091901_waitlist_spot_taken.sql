-- Story 5.6 (phone check, user decision 2026-10-20): in her notification
-- center a waitlist_spot whose place was already taken says so
-- ("המקום כבר נתפס"); the notification stays in the list.
--
-- public.get_taken_waitlist_spots(p_ids): of the given notification ids,
-- her waitlist_spot notifications whose place is gone: the session is still
-- published, and either it moved on to a new cycle (filled and freed again)
-- or it has fewer free places than the party size. Not when she booked the
-- session herself. Dedupe key: waitlist_spot:recipient:event:size:cycle
-- (private.notify_waitlist). A read: no idempotency (AD-5).
--
-- Additive: no drop.

create function public.get_taken_waitlist_spots(p_ids uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_customer uuid := (select private.current_customer_id());
  v_ids uuid[];
begin
  if v_user is null or v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_ids is null or cardinality(p_ids) = 0 then
    return '{}';
  end if;
  if cardinality(p_ids) > 200 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(s.id), '{}') into v_ids
  from (
    select n.id,
      split_part(n.dedupe_key, ':', 3) as event_text,
      split_part(n.dedupe_key, ':', 4) as size_text,
      split_part(n.dedupe_key, ':', 5) as cycle_text
    from public.notifications n
    where n.id = any (p_ids)
      and n.recipient_id = v_user
      and n.type = 'waitlist_spot'
  ) s
  join public.events e
    on s.event_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   and e.id = s.event_text::uuid
  where s.size_text ~ '^[12]$'
    and s.cycle_text ~ '^[0-9]{1,9}$'
    and e.status = 'published'
    and (
      e.waitlist_cycle <> s.cycle_text::integer
      or e.capacity_adults - private.occupied_places(e.id) < s.size_text::integer
    )
    and not exists (
      select 1
      from public.bookings b
      where b.event_id = e.id
        and b.customer_id = v_customer
        and private.is_real_booking(b.status)
    );

  return v_ids;
end;
$$;

revoke execute on function public.get_taken_waitlist_spots(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.get_taken_waitlist_spots(uuid[]) to authenticated;
