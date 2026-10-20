-- Story 4.6 review fixes (on top of 20261020200750, already applied):
-- 1. private.enqueue_notification: nothing is queued for a removed customer
--    (her forfeited cards stay active, so jobs such as auto-extend would
--    still reach her). Based on 20261001184225, the live definition.
-- 2. admin_anonymize_customer (based on 20261020200750): also cleans the
--    unbound payments behind her join links (payer_label, note), masks note
--    in the audit rows of all those payments (written while customer_id
--    was null too), and logs every link it revokes or stops (revoke_link,
--    as admin_issue_link does).

create or replace function private.enqueue_notification(
  p_recipient_id uuid,
  p_type text,
  p_discriminator text,
  p_vars jsonb,
  p_target_path text,
  p_body_override text default null
)
returns uuid
language plpgsql
set search_path = ''
as $function$
declare
  v_template public.notification_templates;
  v_title text;
  v_body text;
  v_id uuid;
  v_anonymized_at timestamptz;
begin
  select * into v_template
  from public.notification_templates t
  where t.type = p_type;

  if v_template.type is null
     or p_discriminator is null
     or btrim(p_discriminator) = ''
     or (p_vars is not null and jsonb_typeof(p_vars) <> 'object') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if p_body_override is not null then
    if v_template.body_mode = 'template'
       or char_length(btrim(p_body_override)) not between 1 and 2000 then
      raise exception 'INVALID_INPUT' using errcode = 'P0001';
    end if;
  elsif v_template.body_mode = 'override' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_title := private.render_notification_text(v_template.title, p_vars);
  if p_body_override is not null then
    v_body := p_body_override;
  else
    v_body := private.render_notification_text(v_template.body, p_vars);
  end if;

  if p_recipient_id is null then
    return null;
  end if;

  if v_template.recipient_kind = 'customer' then
    select p.anonymized_at into v_anonymized_at
    from public.profiles p
    where p.id = p_recipient_id;
    if not found then
      raise exception 'INVALID_INPUT' using errcode = 'P0001';
    end if;
    -- Story 4.6: a removed customer gets nothing.
    if v_anonymized_at is not null then
      return null;
    end if;
  elsif not exists (select 1 from public.admin_roles r where r.user_id = p_recipient_id) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  insert into public.notifications (
    recipient_id, recipient_kind, type, payload, target_path, dedupe_key
  )
  values (
    p_recipient_id,
    v_template.recipient_kind,
    v_template.type,
    jsonb_build_object(
      'title', v_title,
      'body', v_body,
      'template_version', v_template.version
    ),
    p_target_path,
    v_template.type || ':' || p_recipient_id::text || ':' || p_discriminator
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  if v_id is not null and v_template.push then
    insert into public.notification_jobs (notification_id) values (v_id);
  end if;

  return v_id;
end;
$function$;

create or replace function public.admin_anonymize_customer(
  p_customer_id uuid,
  p_confirmed boolean,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz := now();
  v_prev jsonb;
  v_profile public.profiles;
  v_plan jsonb;
  v_blockers jsonb;
  v_token_ids uuid[];
  v_payment_ids uuid[];
  v_old_token public.activation_tokens;
  v_new_token public.activation_tokens;
  v_prefix text := '/admin/customers/' || coalesce(p_customer_id::text, '');
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_anonymize_customer', p_idempotency_key,
    jsonb_build_object('customer_id', p_customer_id, 'confirmed', p_confirmed)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_customer_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if p_confirmed is distinct from true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.admin_roles r where r.user_id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  -- Locks (AD-6): her tokens, her babies (private.babies_guard locks a baby
  -- before its profile), her profile (the mutex), bookings, payments,
  -- waitlist entries, notification jobs.
  perform 1
  from public.activation_tokens t
  where t.customer_id = p_customer_id
     or t.bound_user_id = p_customer_id
     or t.pending_user_id = p_customer_id
  order by t.id
  for update;

  select coalesce(array_agg(t.id order by t.id), '{}'::uuid[])
  into v_token_ids
  from public.activation_tokens t
  where t.customer_id = p_customer_id
     or t.bound_user_id = p_customer_id
     or t.pending_user_id = p_customer_id;

  perform 1
  from public.babies b
  where b.customer_id = p_customer_id
  order by b.id
  for update;

  select p.* into v_profile
  from public.profiles p
  where p.id = p_customer_id
  for update;

  if v_profile.id is null then
    raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  -- A retry: cleaned already; never cleaned again.
  if v_profile.anonymized_at is not null then
    return private.idempotent_finish(
      v_actor::text, 'admin_anonymize_customer', p_idempotency_key,
      jsonb_build_object(
        'result', case
          when v_profile.account_op_state = 'anonymization_pending' then 'pending'
          else 'done'
        end,
        'user_id', v_profile.id
      )
    );
  end if;

  perform 1
  from public.bookings b
  where b.customer_id = p_customer_id
  order by b.id
  for update;

  -- The blockers again, under the locks (the preview may be stale).
  v_plan := private.plan_admin_anonymize_customer(p_customer_id);
  v_blockers := v_plan -> 'blockers';
  if jsonb_array_length(v_blockers -> 'bookings') > 0
     or jsonb_array_length(v_blockers -> 'refund_requests') > 0
     or jsonb_array_length(v_blockers -> 'pending_choices') > 0 then
    raise exception 'ANONYMIZE_BLOCKED' using errcode = 'P0001',
      detail = jsonb_build_object(
        'bookings', jsonb_array_length(v_blockers -> 'bookings'),
        'refund_requests', jsonb_array_length(v_blockers -> 'refund_requests'),
        'pending_choices', jsonb_array_length(v_blockers -> 'pending_choices')
      )::text;
  end if;

  -- Her payments, and the unbound ones behind her join links (a purchase
  -- waiting for her sign-in), by id.
  select coalesce(array_agg(p.id order by p.id), '{}'::uuid[])
  into v_payment_ids
  from public.payments p
  where p.customer_id = p_customer_id
     or p.id in (
       select t.payment_id
       from public.activation_tokens t
       where t.id = any (v_token_ids)
         and t.purpose = 'join'
         and t.payment_id is not null
     );

  perform 1
  from public.payments p
  where p.id = any (v_payment_ids)
  order by p.id
  for update;

  perform 1
  from public.waitlist_entries w
  where w.customer_id = p_customer_id
  order by w.id
  for update;

  perform 1
  from public.notification_jobs j
  join public.notifications n on n.id = j.notification_id
  where n.recipient_id = p_customer_id
     or (n.recipient_kind = 'admin' and left(n.target_path, length(v_prefix)) = v_prefix)
  order by j.id
  for update of j;

  -- Her links: a live link is revoked, except a join waiting for her
  -- sign-in, which can never bind now (a conflict in "to handle"); each
  -- one logged as admin_issue_link logs a revoke. Then no input hash stays.
  for v_old_token in
    select t.*
    from public.activation_tokens t
    where t.id = any (v_token_ids)
      and t.state in ('pending', 'awaiting_login', 'claiming')
    order by t.id
  loop
    update public.activation_tokens t
    set input_hash = null,
        state = case
          when t.purpose = 'join' and t.state = 'awaiting_login' then 'conflict'
          else 'revoked'
        end,
        conflict_reason = case
          when t.purpose = 'join' and t.state = 'awaiting_login' then 'bind_conflict'
          else t.conflict_reason
        end,
        revoked_at = case
          when t.purpose = 'join' and t.state = 'awaiting_login' then t.revoked_at
          else v_now
        end
    where t.id = v_old_token.id
    returning * into v_new_token;

    perform private.audit(
      v_actor, 'admin', 'revoke_link', 'activation_tokens', v_old_token.id,
      p_customer_id, null, to_jsonb(v_old_token), to_jsonb(v_new_token)
    );
  end loop;

  update public.activation_tokens t
  set input_hash = null
  where t.id = any (v_token_ids)
    and t.input_hash is not null;

  -- The profile: full_name is NOT NULL, so it becomes the removed wording;
  -- the privacy consent (when and which version) stays.
  update public.profiles
  set full_name = 'לקוחה שפרטיה הוסרו',
      phone_e164 = null,
      pending_email = null,
      dietary_notes = null,
      photo_consent = false,
      photo_consent_at = null,
      photo_consent_text_version = null,
      personal_photo_consent = false,
      personal_photo_consent_at = null,
      personal_photo_consent_text_version = null,
      anonymized_at = v_now,
      account_op_state = 'anonymization_pending',
      account_op_started_at = v_now,
      account_op_target_hash = null
  where id = p_customer_id;

  -- Admin deletes skip babies_guard's profile lock and LAST_BABY (the
  -- caller is not the customer).
  delete from public.babies where customer_id = p_customer_id;
  delete from public.customer_notes where customer_id = p_customer_id;
  delete from public.waitlist_entries where customer_id = p_customer_id;
  -- notification_deliveries go with them (on delete cascade).
  delete from public.push_subscriptions where user_id = p_customer_id;
  -- Their notification_jobs (and deliveries) go with them.
  delete from public.notifications n
  where n.recipient_id = p_customer_id
     or (n.recipient_kind = 'admin' and left(n.target_path, length(v_prefix)) = v_prefix);

  update public.payments
  set payer_label = null,
      note = null
  where id = any (v_payment_ids)
    and (payer_label is not null or note is not null);

  update public.bookings
  set guest_details = null
  where customer_id = p_customer_id
    and guest_details is not null;

  -- Stored results: hers, her links', and Tal's that name her. This call's
  -- own row has no result yet, so it stays.
  delete from private.idempotency_results r
  where r.actor_scope = p_customer_id::text
     or r.actor_scope = any (
       select 'token:' || x::text from unnest(v_token_ids) as x
     )
     or (
       r.actor_scope in (select a.user_id::text from public.admin_roles a)
       and r.result::text like '%' || p_customer_id::text || '%'
     );

  -- Her audit rows, and those of the payments above (written while
  -- customer_id was null too): note is the one free-text key audit_diff
  -- does not mask.
  update public.audit_log a
  set before = case
        when a.before ? 'note' then jsonb_set(a.before, '{note}', '"<removed>"'::jsonb)
        else a.before
      end,
      after = case
        when a.after ? 'note' then jsonb_set(a.after, '{note}', '"<removed>"'::jsonb)
        else a.after
      end
  where (
      a.customer_id = p_customer_id
      or (a.entity_type = 'payments' and a.entity_id = any (v_payment_ids))
    )
    and (a.before ? 'note' or a.after ? 'note');

  perform private.audit(
    v_actor, 'admin', 'admin_anonymize_customer', 'profiles', p_customer_id,
    p_customer_id, null,
    jsonb_build_object('anonymized_at', null),
    jsonb_build_object('anonymized_at', v_now)
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_anonymize_customer', p_idempotency_key,
    jsonb_build_object('result', 'pending', 'user_id', p_customer_id)
  );
end;
$$;

revoke execute on function private.enqueue_notification(uuid, text, text, jsonb, text, text) from public, anon, authenticated, service_role;

revoke execute on function public.admin_anonymize_customer(uuid, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_anonymize_customer(uuid, boolean, uuid) to authenticated;
