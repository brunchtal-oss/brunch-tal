-- Story 5.7: in-app notification centers (AD-12).
-- mark_notifications_read and mark_notifications_unread are the only writers
-- of notifications.read_at. Both act only on the caller's own rows
-- (recipient_id = auth.uid()); an id of someone else, or one already in the
-- requested state, is skipped silently. No idempotency key and no audit row:
-- read state is the recipient's own view, not money, rights or bookings
-- (AD-5 exemption, as decided in 2.12).
-- Also a partial index for the unread count of the bell.
-- notifications and notification_jobs themselves do not change (5.8 builds
-- on them).

create index notifications_recipient_unread_idx
  on public.notifications (recipient_id)
  where read_at is null;

-- Marks the caller's unread notifications as read: the given ids, or all of
-- them when p_ids is null. Returns {"marked": <rows changed>}.
create function public.mark_notifications_read(p_ids uuid[] default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_marked integer;
begin
  if v_user is null
     or ((select private.current_customer_id()) is null
         and not (select private.is_admin())) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_ids is not null and cardinality(p_ids) > 200 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "ids"}';
  end if;

  update public.notifications n
  set read_at = now()
  where n.recipient_id = v_user
    and n.read_at is null
    and (p_ids is null or n.id = any(p_ids));

  get diagnostics v_marked = row_count;

  return jsonb_build_object('marked', v_marked);
end;
$$;

-- Marks the given notifications of the caller as unread again. p_ids is
-- required (null or empty = INVALID_INPUT). Returns {"marked": <rows changed>}.
create function public.mark_notifications_unread(p_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_marked integer;
begin
  if v_user is null
     or ((select private.current_customer_id()) is null
         and not (select private.is_admin())) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_ids is null
     or coalesce(cardinality(p_ids), 0) = 0
     or cardinality(p_ids) > 200 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "ids"}';
  end if;

  update public.notifications n
  set read_at = null
  where n.recipient_id = v_user
    and n.read_at is not null
    and n.id = any(p_ids);

  get diagnostics v_marked = row_count;

  return jsonb_build_object('marked', v_marked);
end;
$$;

revoke execute on function public.mark_notifications_read(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

revoke execute on function public.mark_notifications_unread(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.mark_notifications_unread(uuid[]) to authenticated;
