-- Story 2.10: the customer's profile, babies and photo consent.
-- babies: customer_id is never taken from the input (its default is
-- private.current_customer_id() and the insert grant leaves it out), and a
-- trigger enforces the baby rules on every writer (the profile screen,
-- join_complete, a future import): the birth date not after the local today
-- (AD-8), at most 10 babies per customer, and a customer does not delete her
-- own last baby (user decision 2026-10-06). The count runs after the
-- profile row is locked, the customer's mutex (AD-6), so two writes at once
-- cannot pass the limits. set_photo_consent: the only way the customer
-- changes her photo consent (CAP-40), with its time, the published wording
-- version and an audit row.

-- ---------------------------------------------------------------------------
-- babies: customer_id from the session, never from the input
-- ---------------------------------------------------------------------------

alter table public.babies
  alter column customer_id set default private.current_customer_id();

-- A table-level revoke also removes the column grants (customer_id
-- included); join_complete (definer) still gives customer_id itself.
revoke insert on table public.babies from authenticated;
grant insert (name, birth_date) on table public.babies to authenticated;

-- ---------------------------------------------------------------------------
-- babies guard
-- ---------------------------------------------------------------------------

-- Definer: it locks the profile row and counts every baby of the customer,
-- whoever writes. Errors carry detail.field (birth_date | babies), as in
-- join_complete. The last-baby rule applies only when the customer deletes
-- her own baby: a cascade (profile removed) or an admin is not blocked.
create function private.babies_guard()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if tg_op = 'DELETE' then
    if (select private.current_customer_id()) = old.customer_id then
      perform 1 from public.profiles p where p.id = old.customer_id for update;
      if not exists (
        select 1
        from public.babies b
        where b.customer_id = old.customer_id
          and b.id <> old.id
      ) then
        raise exception 'LAST_BABY' using errcode = 'P0001';
      end if;
    end if;
    return old;
  end if;

  if new.birth_date > v_today then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "birth_date"}';
  end if;

  if tg_op = 'INSERT'
     or new.customer_id is distinct from old.customer_id then
    perform 1 from public.profiles p where p.id = new.customer_id for update;
    if (
      select count(*)
      from public.babies b
      where b.customer_id = new.customer_id
        and (tg_op = 'INSERT' or b.id <> new.id)
    ) >= 10 then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = '{"field": "babies"}';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.babies_guard() from public, anon, authenticated, service_role;

create trigger babies_guard
  before insert or update or delete on public.babies
  for each row execute function private.babies_guard();

-- ---------------------------------------------------------------------------
-- set_photo_consent
-- ---------------------------------------------------------------------------

-- The signed-in active customer sets her photo consent (CAP-40). Exempt from
-- idempotency as a set_* (AD-5): the same value writes nothing and returns
-- the current state. A different value stores the time and the
-- published_version of the join-form page (as join_complete does), and an
-- audit row with the customer as the actor.
create function public.set_photo_consent(p_consent boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_customer uuid := (select private.current_customer_id());
  v_old public.profiles;
  v_new public.profiles;
  v_version integer;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_consent is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "photo_consent"}';
  end if;

  -- Lock order (AD-6): profiles is the customer's mutex.
  select p.* into v_old
  from public.profiles p
  where p.id = v_customer
  for update;

  if v_old.photo_consent = p_consent then
    return jsonb_build_object(
      'photo_consent', v_old.photo_consent,
      'photo_consent_at', v_old.photo_consent_at,
      'photo_consent_text_version', v_old.photo_consent_text_version
    );
  end if;

  select cp.published_version into v_version
  from public.content_pages cp
  where cp.slug = 'join-form';

  if v_version is null then
    raise exception 'set_photo_consent: content page missing' using errcode = 'XX000';
  end if;

  update public.profiles p
  set photo_consent = p_consent,
      photo_consent_at = now(),
      photo_consent_text_version = v_version
  where p.id = v_customer
  returning p.* into v_new;

  perform private.audit(
    v_customer, 'customer', 'set_photo_consent', 'profiles', v_customer,
    v_customer, null, to_jsonb(v_old), to_jsonb(v_new)
  );

  return jsonb_build_object(
    'photo_consent', v_new.photo_consent,
    'photo_consent_at', v_new.photo_consent_at,
    'photo_consent_text_version', v_new.photo_consent_text_version
  );
end;
$$;

revoke execute on function public.set_photo_consent(boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_photo_consent(boolean) to authenticated;
