-- Story 2.10 review fix: set_photo_consent refuses with NOT_AUTHORIZED when
-- the profile is gone between private.current_customer_id() and the lock,
-- instead of auditing a null row. Same function otherwise.

create or replace function public.set_photo_consent(p_consent boolean)
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

  -- The profile was removed between the check and the lock.
  if not found then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

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
