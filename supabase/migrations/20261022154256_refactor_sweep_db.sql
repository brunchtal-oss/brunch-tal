-- Story 5.20 (B): the refactor sweep's database part, in one file. Run in
-- the SQL Editor (it drops and re-adds a check constraint). Every function
-- below is redefined from its live pg_get_functiondef (the defining
-- migration is named above each one), never from an old file.
--
--  1. pgcrypto is declared (digest/gen_random_bytes are used since E2; a
--     fresh project replaying the migrations needs it declared).
--  2. Fix 6: the writers whose audit rows are never listed stop writing
--     them (only `perform private.audit(...)` goes; idempotency stays).
--  3. admin_duplicate_event: an archived concept -> CONCEPT_ARCHIVED.
--  4. admin_update_event: reopening registration notifies the waitlist
--     (one notify_waitlist call at most, merged with a capacity raise).
--  5. admin_update_product: changing the event kind of a product marked
--     eligible on a session still ahead -> PRODUCT_IN_USE.
--  6. Baby birth date from 2 years back to 9 months ahead of the local
--     today (babies_guard on insert or a date change, join_complete).
--  7. credit_session_matches, plan_admin_cancel_event: only sessions that
--     accept the credit's / card's product.
--  8. bind_purchase: a completed pinned booking conflicts too (no raw 23505).
--  9. Remove personal details: parked purchases and awaiting_login places
--     block; an email change in progress -> CONCURRENT_CHANGE; the Auth
--     users of revoked claiming links are returned (orphan_user_ids).
-- 10. admin_list_audit: a marketing reminder text's subject is its body.
-- 11. admin_update_business_settings: credit_expiring_days (1..30).
-- 12. admin_get_customer: bookings carry moved_to_starts_at.
-- 13. admin_list_session_occupancy: returns the capacity, then
--     events.capacity_adults is no longer readable by anon/authenticated.
-- 14. waitlist_entries: no service_role grant, one SELECT policy.
-- 15. register_push_subscription: known push services only.
-- 16. The broadcast template and type are removed (CAP-32 has no screen).

create extension if not exists pgcrypto with schema extensions;

-- ==========================================================================
-- New pure helpers (story 5.20).
-- ==========================================================================

-- A baby's birth date is allowed from 2 years before to 9 months after the
-- local today (user decision 2026-10-22). Pure (AD-8): the caller passes
-- the local today.
create or replace function private.birth_date_allowed(p_birth date, p_today date)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    p_birth >= (p_today - interval '2 years')::date
    and p_birth <= (p_today + interval '9 months')::date,
    false
  );
$function$;

-- A push endpoint of a known push service only (user decision 2026-10-22):
-- https, a lowercase host that is exactly fcm.googleapis.com or
-- updates.push.services.mozilla.com, or ends with .push.apple.com or
-- .notify.windows.com; no userinfo ('@' anywhere), port absent or 443.
-- lib/push-endpoint.ts holds the same rule for the push worker.
create or replace function private.push_endpoint_allowed(p_endpoint text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(
    char_length(p_endpoint) <= 1000
    and strpos(p_endpoint, '@') = 0
    and p_endpoint ~ '^https://[a-z0-9.-]+(:443)?(/[^[:space:]]*)?$'
    and (
      substring(p_endpoint from '^https://([a-z0-9.-]+)')
        in ('fcm.googleapis.com', 'updates.push.services.mozilla.com')
      or substring(p_endpoint from '^https://([a-z0-9.-]+)')
        ~ '^([a-z0-9-]+[.])+(push[.]apple[.]com|notify[.]windows[.]com)$'
    ),
    false
  );
$function$;

revoke execute on function private.birth_date_allowed(date, date) from public, anon, authenticated, service_role;
revoke execute on function private.push_endpoint_allowed(text) from public, anon, authenticated, service_role;


-- ==========================================================================
-- Fix 6: audit rows nobody sees are no longer written (only the private.audit call goes; idempotency stays).
-- ==========================================================================

-- Based on 20261005203814_media_publish_review_fixes (live definition).
CREATE OR REPLACE FUNCTION private.hide_unused_media(p_actor uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_used uuid[] := private.used_media_ids();
  v_old public.media_assets;
  v_new public.media_assets;
begin
  for v_old in
    select m.*
    from public.media_assets m
    where m.publish_state in ('published', 'copying')
      and not (m.id = any (v_used))
    order by m.id
    for update
  loop
    update public.media_assets
    set publish_state = 'hidden',
        updated_at = now()
    where id = v_old.id
    returning * into v_new;
  end loop;

  return coalesce(
    (
      select array_agg(m.public_path order by m.public_path)
      from public.media_assets m
      where m.publish_state = 'hidden'
        and exists (
          select 1
          from storage.objects o
          where o.bucket_id = 'media-public'
            and o.name = m.public_path
        )
    ),
    '{}'::text[]
  );
end;
$function$;

-- Based on 20261021064354_notes_without_topics (live definition).
CREATE OR REPLACE FUNCTION public.admin_add_note(p_body text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_body text;
  v_note public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_add_note', p_idempotency_key,
    jsonb_build_object('body', p_body)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  perform private.lock_notes_board();
  v_body := private.note_text(p_body, 'body', 2000);

  insert into public.notes (body, sort_order)
  values (
    v_body,
    coalesce((select min(n.sort_order) from public.notes n), 1) - 1
  )
  returning * into v_note;

  return private.idempotent_finish(
    v_actor::text, 'admin_add_note', p_idempotency_key,
    jsonb_build_object('note_id', v_note.id)
  );
end;
$function$;

-- Based on 20261006184223_work_sheet (live definition).
CREATE OR REPLACE FUNCTION public.admin_add_prep_day(p_event_id uuid, p_day_offset integer, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_sheet public.work_sheets;
  v_new public.work_sheets;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_add_prep_day', p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'day_offset', p_day_offset)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.ensure_work_sheet(p_event_id);
  v_sheet := private.lock_work_sheet(v_sheet.id);

  if p_day_offset is null or p_day_offset not between -6 and 0 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "day_offset"}';
  end if;

  if p_day_offset = any (v_sheet.prep_days::integer[]) then
    return private.idempotent_finish(
      v_actor::text, 'admin_add_prep_day', p_idempotency_key,
      jsonb_build_object('prep_days', to_jsonb(v_sheet.prep_days))
    );
  end if;

  update public.work_sheets s
  set prep_days = array(
        select d from unnest(s.prep_days || p_day_offset::smallint) as d order by d
      ),
      updated_at = now()
  where s.id = v_sheet.id
  returning * into v_new;

  return private.idempotent_finish(
    v_actor::text, 'admin_add_prep_day', p_idempotency_key,
    jsonb_build_object('prep_days', to_jsonb(v_new.prep_days))
  );
end;
$function$;

-- Based on 20261007154028_work_sheet_phone_check (live definition).
CREATE OR REPLACE FUNCTION public.admin_add_shopping_items(p_event_id uuid, p_bodies text[], p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_sheet public.work_sheets;
  v_bodies text[] := '{}';
  v_body text;
  v_next integer;
  v_item public.shopping_items;
  v_ids uuid[] := '{}';
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_add_shopping_items', p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'bodies', to_jsonb(p_bodies))
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.ensure_work_sheet(p_event_id);
  v_sheet := private.lock_work_sheet(v_sheet.id);

  if p_bodies is null or coalesce(array_length(p_bodies, 1), 0) not between 1 and 100
     or array_ndims(p_bodies) <> 1 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "bodies"}';
  end if;

  -- Every line is checked before anything is added.
  foreach v_body in array p_bodies loop
    v_bodies := v_bodies || private.work_text(v_body, 'bodies');
  end loop;

  select coalesce(max(i.sort_order), 0)
  into v_next
  from public.shopping_items i
  where i.sheet_id = v_sheet.id;

  foreach v_body in array v_bodies loop
    v_next := v_next + 1;
    insert into public.shopping_items (sheet_id, body, quantity, sort_order)
    values (v_sheet.id, v_body, null, v_next)
    returning * into v_item;

    v_ids := v_ids || v_item.id;
  end loop;

  return private.idempotent_finish(
    v_actor::text, 'admin_add_shopping_items', p_idempotency_key,
    jsonb_build_object('item_ids', to_jsonb(v_ids))
  );
end;
$function$;

-- Based on 20261006184223_work_sheet (live definition).
CREATE OR REPLACE FUNCTION public.admin_add_work_dish(p_event_id uuid, p_name text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_sheet public.work_sheets;
  v_name text;
  v_dish public.work_dishes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_add_work_dish', p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'name', p_name)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.ensure_work_sheet(p_event_id);
  v_sheet := private.lock_work_sheet(v_sheet.id);
  v_name := private.work_text(p_name, 'name');

  insert into public.work_dishes (sheet_id, name, sort_order)
  values (
    v_sheet.id,
    v_name,
    coalesce(
      (select max(d.sort_order) from public.work_dishes d where d.sheet_id = v_sheet.id),
      0
    ) + 1
  )
  returning * into v_dish;

  return private.idempotent_finish(
    v_actor::text, 'admin_add_work_dish', p_idempotency_key,
    jsonb_build_object('dish_id', v_dish.id)
  );
end;
$function$;

-- Based on 20261006184223_work_sheet (live definition).
CREATE OR REPLACE FUNCTION public.admin_add_work_task(p_dish_id uuid, p_day_offset integer, p_body text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_sheet public.work_sheets;
  v_body text;
  v_task public.work_tasks;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_add_work_task', p_idempotency_key,
    jsonb_build_object('dish_id', p_dish_id, 'day_offset', p_day_offset, 'body', p_body)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.lock_sheet_of_dish(p_dish_id);
  v_body := private.work_text(p_body, 'body');
  if p_day_offset is null or not (p_day_offset = any (v_sheet.prep_days::integer[])) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "day_offset"}';
  end if;

  insert into public.work_tasks (dish_id, day_offset, body, sort_order)
  values (
    p_dish_id,
    p_day_offset,
    v_body,
    coalesce(
      (select max(t.sort_order) from public.work_tasks t
       where t.dish_id = p_dish_id and t.day_offset = p_day_offset),
      0
    ) + 1
  )
  returning * into v_task;

  return private.idempotent_finish(
    v_actor::text, 'admin_add_work_task', p_idempotency_key,
    jsonb_build_object('task_id', v_task.id)
  );
end;
$function$;

-- Based on 20261013182941_pinned_single_notification (live definition).
CREATE OR REPLACE FUNCTION public.admin_approve_payment(p_customer_id uuid, p_payer_label text, p_product_id uuid, p_event_id uuid, p_amount_agorot integer, p_amount_override_reason text, p_paid_on date, p_payment_method_id uuid, p_reference text, p_note text, p_confirmed boolean, p_duplicate_confirmed boolean, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_label text := nullif(btrim(p_payer_label), '');
  v_payment public.payments;
  v_payment_new public.payments;
  v_profile_id uuid;
  v_plan jsonb;
  v_payment_id uuid;
  v_entitlement public.entitlements;
  v_booking_id uuid;
  v_pinned jsonb := '{}'::jsonb;
  v_card_tip text := '';
  v_token jsonb;
  v_token_row public.activation_tokens;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text,
    'admin_approve_payment',
    p_idempotency_key,
    jsonb_build_object(
      'customer_id', p_customer_id,
      'payer_label', v_label,
      'product_id', p_product_id,
      'event_id', p_event_id,
      'amount_agorot', p_amount_agorot,
      'amount_override_reason', p_amount_override_reason,
      'paid_on', p_paid_on,
      'payment_method_id', p_payment_method_id,
      'reference', p_reference,
      'note', p_note,
      'confirmed', p_confirmed,
      'duplicate_confirmed', p_duplicate_confirmed
    )
  );
  if v_prev is not null then
    return v_prev;
  end if;

  -- The label only names a new customer, up to 40 characters.
  if v_label is not null
     and (p_customer_id is not null or char_length(v_label) > 40) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- A new customer's payer name is required (user decision 2026-10-05).
  if p_customer_id is null and v_label is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "payer_label"}';
  end if;

  -- Serializes approvals that may duplicate each other (released at commit).
  perform pg_advisory_xact_lock(hashtext(
    'payments:similar:' || coalesce(p_product_id::text, '') || ':'
    || coalesce(p_amount_agorot::text, '') || ':'
    || coalesce(p_payment_method_id::text, '')
  ));

  -- Lock order (AD-6): profiles before the session, the product and the
  -- payment.
  if p_customer_id is not null then
    select p.id into v_profile_id
    from public.profiles p
    where p.id = p_customer_id
      and p.anonymized_at is null
    for update;

    if v_profile_id is null then
      raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
    end if;
  end if;

  if p_event_id is not null then
    perform 1
    from public.events e
    where e.id = p_event_id
    for update;
  end if;

  -- The price cannot change between this plan and the core's plan.
  perform 1
  from public.products p
  where p.id = p_product_id
  for share;

  v_plan := private.plan_approve_payment(p_product_id, p_event_id, p_amount_agorot, p_paid_on);

  if (v_plan ->> 'price_changed')::boolean and p_confirmed is not true then
    raise exception 'CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  if p_duplicate_confirmed is not true
     and jsonb_array_length(private.similar_payments_for(
       p_customer_id, v_label, p_product_id, p_amount_agorot, p_payment_method_id, p_paid_on,
       p_event_id
     )) > 0 then
    raise exception 'DUPLICATE_CONFIRM_REQUIRED' using errcode = 'P0001';
  end if;

  v_payment_id := private.approve_payment_core(
    'manual', v_actor, 'admin', p_customer_id, p_product_id, p_event_id,
    p_amount_agorot, p_amount_override_reason, p_paid_on, p_payment_method_id,
    p_reference, p_note, null, null, 'raise'
  );

  select e.* into v_entitlement
  from public.entitlements e
  where e.payment_id = v_payment_id;

  select b.id into v_booking_id
  from public.bookings b
  where b.payment_id = v_payment_id
    and b.status = 'confirmed';

  if v_entitlement.pinned_event_id is not null then
    v_pinned := jsonb_build_object(
      'event_id', v_entitlement.pinned_event_id,
      'booking_id', v_booking_id
    );
  end if;

  if p_customer_id is not null then
    -- The tip only for a card that can still be booked (not expired at
    -- approval, e.g. a back-dated purchase).
    if v_entitlement.kind = 'card'
       and private.local_day_end(v_entitlement.expires_on) > now() then
      select '. ' || t.body into v_card_tip
      from public.notification_templates t
      where t.type = 'purchase_new_card';
    end if;

    -- Last in the transaction (AD-6, AD-12). A pinned product already got
    -- its booking notification in the core (3.5, user decision 2026-10-13):
    -- one notification, no purchase_repeat.
    if v_entitlement.pinned_event_id is null then
      perform private.enqueue_notification(
        p_customer_id,
        'purchase_repeat',
        v_payment_id::text,
        jsonb_build_object(
          'product', v_plan ->> 'product_name',
          'expires_on', private.format_day_month(v_entitlement.expires_on),
          'card_tip', coalesce(v_card_tip, '')
        ),
        '/me'
      );
    end if;

    return private.idempotent_finish(
      v_actor::text,
      'admin_approve_payment',
      p_idempotency_key,
      jsonb_build_object(
        'payment_id', v_payment_id,
        'entitlement_id', v_entitlement.id,
        'customer_id', p_customer_id,
        'expires_on', v_entitlement.expires_on,
        'product_name', v_plan ->> 'product_name',
        'units', (v_plan ->> 'units')::integer
      ) || v_pinned
    );
  end if;

  -- The core does not know the label: set it here.
  if v_label is not null then
    select pay.* into v_payment
    from public.payments pay
    where pay.id = v_payment_id
    for update;

    update public.payments
    set payer_label = v_label
    where id = v_payment_id
    returning * into v_payment_new;
  end if;

  v_token := private.issue_token('join', null, v_payment_id);

  select t.* into v_token_row
  from public.activation_tokens t
  where t.id = (v_token ->> 'token_id')::uuid;

  v_result := private.idempotent_finish(
    v_actor::text,
    'admin_approve_payment',
    p_idempotency_key,
    jsonb_build_object(
      'payment_id', v_payment_id,
      'entitlement_id', v_entitlement.id,
      'customer_id', null,
      'token_id', v_token_row.id,
      'link_expires_at', v_token_row.expires_at,
      'expires_on', v_entitlement.expires_on,
      'reissue_required', true
    ) || v_pinned
  );

  return v_result || jsonb_build_object('token', v_token ->> 'token', 'reissue_required', false);
end;
$function$;

-- Based on 20261013203359_account_admin_and_rate_limit (live definition).
CREATE OR REPLACE FUNCTION public.admin_begin_email_change(p_customer_id uuid, p_email text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_email text := lower(btrim(p_email));
  v_hash text := private.email_hash(p_email);
  v_prev jsonb;
  v_old public.profiles;
  v_new public.profiles;
  v_current text;
  v_match jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  -- The request is hashed; the address itself never reaches the row.
  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_begin_email_change', p_idempotency_key,
    jsonb_build_object('customer_id', p_customer_id, 'email_hash', v_hash)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_customer_id is null
     or v_email is null
     or char_length(v_email) not between 3 and 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "email"}';
  end if;

  select p.* into v_old
  from public.profiles p
  where p.id = p_customer_id
  for update;

  if v_old.id is null
     or v_old.anonymized_at is not null
     or v_old.activated_at is null
     or v_old.account_op_state = 'anonymization_pending'
     or exists (select 1 from public.admin_roles r where r.user_id = v_old.id) then
    raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  -- The same change again (a crash between the steps): resume from Auth.
  if v_old.account_op_state = 'email_change_pending'
     and v_old.account_op_target_hash = v_hash then
    return private.idempotent_finish(
      v_actor::text, 'admin_begin_email_change', p_idempotency_key,
      jsonb_build_object('result', 'pending', 'user_id', v_old.id)
    );
  end if;

  select u.email into v_current from auth.users u where u.id = v_old.id;
  if lower(btrim(v_current)) = v_email then
    raise exception 'EMAIL_UNCHANGED' using errcode = 'P0001';
  end if;

  v_match := private.find_identity(v_email, null);
  if v_match ->> 'match' <> 'none'
     and (v_match ->> 'customer_id') is distinct from v_old.id::text then
    -- Blocked: nothing changes; the answer carries no address (source §10).
    return private.idempotent_finish(
      v_actor::text, 'admin_begin_email_change', p_idempotency_key,
      jsonb_build_object('result', 'taken')
    );
  end if;

  update public.profiles
  set account_op_state = 'email_change_pending',
      account_op_started_at = now(),
      account_op_target_hash = v_hash
  where id = v_old.id
  returning * into v_new;

  return private.idempotent_finish(
    v_actor::text, 'admin_begin_email_change', p_idempotency_key,
    jsonb_build_object('result', 'pending', 'user_id', v_old.id)
  );
end;
$function$;

-- Based on 20261005194206_media_upload_and_publish (live definition).
CREATE OR REPLACE FUNCTION public.admin_begin_media_publish(p_media_id uuid, p_alt_text text, p_focus_x integer, p_focus_y integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_old public.media_assets;
  v_new public.media_assets;
  v_alt text := nullif(btrim(p_alt_text), '');
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if v_alt is not null and char_length(v_alt) > 300 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "alt_text"}';
  elsif p_focus_x is null or p_focus_x not between 0 and 100 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "focus_x"}';
  elsif p_focus_y is null or p_focus_y not between 0 and 100 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "focus_y"}';
  end if;

  select m.* into v_old
  from public.media_assets m
  where m.id = p_media_id
  for update;

  if v_old.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'media-drafts'
      and o.name = v_old.storage_path
  ) then
    raise exception 'MEDIA_NOT_UPLOADED' using errcode = 'P0001';
  end if;

  update public.media_assets
  set alt_text = v_alt,
      focus_x = p_focus_x,
      focus_y = p_focus_y,
      publish_state = case when v_old.publish_state = 'published'
        then 'published' else 'copying' end,
      publish_started_at = case
        when v_old.publish_state = 'copying' then v_old.publish_started_at
        when v_old.publish_state = 'published' then v_old.publish_started_at
        else now() end,
      updated_at = now()
  where id = v_old.id
  returning * into v_new;

  return jsonb_build_object(
    'media_id', v_new.id,
    'publish_state', v_new.publish_state,
    'storage_path', v_new.storage_path,
    'public_path', v_new.public_path
  );
end;
$function$;

-- Based on 20261005194206_media_upload_and_publish (live definition).
CREATE OR REPLACE FUNCTION public.admin_create_media(p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_id uuid := gen_random_uuid();
  v_new public.media_assets;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_create_media', p_idempotency_key, '{}'::jsonb
  );
  if v_prev is not null then
    return v_prev;
  end if;

  insert into public.media_assets (id, storage_path, public_path, created_by)
  values (v_id, v_id::text, v_id::text || '.jpg', v_actor)
  returning * into v_new;

  return private.idempotent_finish(
    v_actor::text, 'admin_create_media', p_idempotency_key,
    jsonb_build_object('media_id', v_new.id, 'storage_path', v_new.storage_path)
  );
end;
$function$;

-- Based on 20261021064354_notes_without_topics (live definition).
CREATE OR REPLACE FUNCTION public.admin_delete_note(p_note_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_old public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_delete_note', p_idempotency_key,
    jsonb_build_object('note_id', p_note_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_old := private.lock_note(p_note_id);

  delete from public.notes where id = v_old.id;

  return private.idempotent_finish(
    v_actor::text, 'admin_delete_note', p_idempotency_key,
    jsonb_build_object('note_id', v_old.id)
  );
end;
$function$;

-- Based on 20261006215720_work_sheet_shopping (live definition).
CREATE OR REPLACE FUNCTION public.admin_delete_shopping_item(p_item_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_sheet public.work_sheets;
  v_old public.shopping_items;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_delete_shopping_item', p_idempotency_key,
    jsonb_build_object('item_id', p_item_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.lock_sheet_of_shopping_item(p_item_id);

  delete from public.shopping_items where id = p_item_id
  returning * into v_old;

  return private.idempotent_finish(
    v_actor::text, 'admin_delete_shopping_item', p_idempotency_key,
    jsonb_build_object('item_id', v_old.id)
  );
end;
$function$;

-- Based on 20261006191118_work_sheet_review_fixes (live definition).
CREATE OR REPLACE FUNCTION public.admin_delete_work_dish(p_dish_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_sheet public.work_sheets;
  v_old public.work_dishes;
  v_tasks jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_delete_work_dish', p_idempotency_key,
    jsonb_build_object('dish_id', p_dish_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.lock_sheet_of_dish(p_dish_id);

  select d.* into v_old from public.work_dishes d where d.id = p_dish_id;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id, 'day_offset', t.day_offset, 'body', t.body, 'done', t.done
      )
      order by t.day_offset, t.sort_order, t.id
    ),
    '[]'::jsonb
  )
  into v_tasks
  from public.work_tasks t
  where t.dish_id = p_dish_id;

  delete from public.work_dishes where id = p_dish_id;

  return private.idempotent_finish(
    v_actor::text, 'admin_delete_work_dish', p_idempotency_key,
    jsonb_build_object('dish_id', v_old.id)
  );
end;
$function$;

-- Based on 20261006184223_work_sheet (live definition).
CREATE OR REPLACE FUNCTION public.admin_delete_work_task(p_task_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_sheet public.work_sheets;
  v_old public.work_tasks;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_delete_work_task', p_idempotency_key,
    jsonb_build_object('task_id', p_task_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.lock_sheet_of_task(p_task_id);

  delete from public.work_tasks where id = p_task_id
  returning * into v_old;

  return private.idempotent_finish(
    v_actor::text, 'admin_delete_work_task', p_idempotency_key,
    jsonb_build_object('task_id', v_old.id)
  );
end;
$function$;

-- Based on 20261020200750_remove_personal_details (live definition).
CREATE OR REPLACE FUNCTION public.admin_finish_anonymize_customer(p_customer_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_old public.profiles;
  v_new public.profiles;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_finish_anonymize_customer', p_idempotency_key,
    jsonb_build_object('customer_id', p_customer_id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_customer_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select p.* into v_old
  from public.profiles p
  where p.id = p_customer_id
  for update;

  if v_old.id is null
     or v_old.account_op_state is distinct from 'anonymization_pending' then
    return private.idempotent_finish(
      v_actor::text, 'admin_finish_anonymize_customer', p_idempotency_key,
      jsonb_build_object('result', 'not_pending')
    );
  end if;

  if exists (select 1 from auth.users u where u.id = v_old.id) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  update public.profiles
  set account_op_state = null,
      account_op_started_at = null
  where id = v_old.id
  returning * into v_new;

  return private.idempotent_finish(
    v_actor::text, 'admin_finish_anonymize_customer', p_idempotency_key,
    jsonb_build_object('result', 'done')
  );
end;
$function$;

-- Based on 20261005194206_media_upload_and_publish (live definition).
CREATE OR REPLACE FUNCTION public.admin_finish_media_publish(p_media_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_old public.media_assets;
  v_new public.media_assets;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select m.* into v_old
  from public.media_assets m
  where m.id = p_media_id
  for update;

  if v_old.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_old.publish_state = 'published' then
    return jsonb_build_object(
      'media_id', v_old.id,
      'publish_state', v_old.publish_state,
      'public_path', v_old.public_path
    );
  end if;

  if v_old.publish_state <> 'copying' or not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'media-public'
      and o.name = v_old.public_path
  ) then
    raise exception 'MEDIA_NOT_COPIED' using errcode = 'P0001';
  end if;

  update public.media_assets
  set publish_state = 'published',
      published_at = now(),
      updated_at = now()
  where id = v_old.id
  returning * into v_new;

  return jsonb_build_object(
    'media_id', v_new.id,
    'publish_state', v_new.publish_state,
    'public_path', v_new.public_path
  );
end;
$function$;

-- Based on 20261007154028_work_sheet_phone_check (live definition).
CREATE OR REPLACE FUNCTION public.admin_move_prep_day(p_event_id uuid, p_from integer, p_to integer, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_sheet public.work_sheets;
  v_new public.work_sheets;
  v_tasks jsonb;
  v_moved integer;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_move_prep_day', p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'from', p_from, 'to', p_to)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.ensure_work_sheet(p_event_id);
  v_sheet := private.lock_work_sheet(v_sheet.id);

  if p_from is null or p_from not between -6 and 0
     or not (p_from = any (v_sheet.prep_days::integer[]))
     or p_from = any (v_sheet.base_days::integer[]) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "from"}';
  end if;

  if p_to is null or p_to not between -6 and 0 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "to"}';
  end if;

  if p_to = p_from then
    return private.idempotent_finish(
      v_actor::text, 'admin_move_prep_day', p_idempotency_key,
      jsonb_build_object('prep_days', to_jsonb(v_sheet.prep_days), 'moved_tasks', 0)
    );
  end if;

  if p_to = any (v_sheet.prep_days::integer[]) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "to"}';
  end if;

  with moved as (
    update public.work_tasks t
    set day_offset = p_to::smallint, updated_at = now()
    from public.work_dishes d
    where d.id = t.dish_id
      and d.sheet_id = v_sheet.id
      and t.day_offset = p_from
    returning t.id, t.dish_id, t.body, t.done
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', x.id, 'dish_id', x.dish_id, 'day_offset', p_from,
          'body', x.body, 'done', x.done
        )
        order by x.dish_id, x.id
      ),
      '[]'::jsonb
    ),
    count(*)::integer
  into v_tasks, v_moved
  from moved x;

  update public.work_sheets s
  set prep_days = array(
        select d
        from unnest(array_remove(s.prep_days, p_from::smallint) || p_to::smallint) as d
        order by d
      ),
      updated_at = now()
  where s.id = v_sheet.id
  returning * into v_new;

  return private.idempotent_finish(
    v_actor::text, 'admin_move_prep_day', p_idempotency_key,
    jsonb_build_object('prep_days', to_jsonb(v_new.prep_days), 'moved_tasks', v_moved)
  );
end;
$function$;

-- Based on 20261007154028_work_sheet_phone_check (live definition).
CREATE OR REPLACE FUNCTION public.admin_remove_prep_day(p_event_id uuid, p_day_offset integer, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_sheet public.work_sheets;
  v_new public.work_sheets;
  v_tasks jsonb;
  v_deleted integer;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_remove_prep_day', p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'day_offset', p_day_offset)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.ensure_work_sheet(p_event_id);
  v_sheet := private.lock_work_sheet(v_sheet.id);

  if p_day_offset is null or p_day_offset not between -6 and 0 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "day_offset"}';
  end if;

  if not (p_day_offset = any (v_sheet.prep_days::integer[])) then
    return private.idempotent_finish(
      v_actor::text, 'admin_remove_prep_day', p_idempotency_key,
      jsonb_build_object('prep_days', to_jsonb(v_sheet.prep_days), 'deleted_tasks', 0)
    );
  end if;

  if p_day_offset = any (v_sheet.base_days::integer[])
     or cardinality(v_sheet.prep_days) = 1 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "day_offset"}';
  end if;

  with deleted as (
    delete from public.work_tasks t
    using public.work_dishes d
    where d.id = t.dish_id
      and d.sheet_id = v_sheet.id
      and t.day_offset = p_day_offset
    returning t.id, t.dish_id, t.day_offset, t.body, t.done
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', x.id, 'dish_id', x.dish_id, 'day_offset', x.day_offset,
          'body', x.body, 'done', x.done
        )
        order by x.dish_id, x.id
      ),
      '[]'::jsonb
    ),
    count(*)::integer
  into v_tasks, v_deleted
  from deleted x;

  update public.work_sheets s
  set prep_days = array_remove(s.prep_days, p_day_offset::smallint),
      updated_at = now()
  where s.id = v_sheet.id
  returning * into v_new;

  return private.idempotent_finish(
    v_actor::text, 'admin_remove_prep_day', p_idempotency_key,
    jsonb_build_object('prep_days', to_jsonb(v_new.prep_days), 'deleted_tasks', v_deleted)
  );
end;
$function$;

-- Based on 20261010115547_concepts_admin (live definition).
CREATE OR REPLACE FUNCTION public.admin_set_concept_image(p_concept_id uuid, p_media_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_old public.concepts;
  v_new public.concepts;
  v_paths text[];
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select c.* into v_old
  from public.concepts c
  where c.id = p_concept_id
  for update;

  if v_old.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_media_id is not null and not exists (
    select 1
    from public.media_assets m
    where m.id = p_media_id
      and m.publish_state = 'published'
  ) then
    raise exception 'MEDIA_NOT_PUBLISHED' using errcode = 'P0001';
  end if;

  if v_old.default_image_id is distinct from p_media_id then
    update public.concepts
    set default_image_id = p_media_id
    where id = v_old.id
    returning * into v_new;
  end if;

  v_paths := private.hide_unused_media(v_actor);

  return jsonb_build_object(
    'concept_id', v_old.id,
    'image_id', p_media_id,
    'hidden_paths', to_jsonb(v_paths)
  );
end;
$function$;

-- Based on 20261004122904_content_publish (live definition).
CREATE OR REPLACE FUNCTION public.admin_set_content_draft(p_slug text, p_key text, p_content jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_old public.content_sections;
  v_new public.content_sections;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "content"}';
  end if;

  select s.* into v_old
  from public.content_sections s
  where s.page_slug = p_slug
    and s.key = p_key
  for update;

  if v_old.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  update public.content_sections
  set draft_content = p_content,
      updated_by = v_actor,
      updated_at = now()
  where id = v_old.id
  returning * into v_new;

  return jsonb_build_object('key', v_new.key, 'updated_at', v_new.updated_at);
end;
$function$;

-- Based on 20261005194206_media_upload_and_publish (live definition).
CREATE OR REPLACE FUNCTION public.admin_set_event_image(p_event_id uuid, p_media_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_old public.events;
  v_new public.events;
  v_paths text[];
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select e.* into v_old
  from public.events e
  where e.id = p_event_id
  for update;

  if v_old.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_media_id is not null and not exists (
    select 1
    from public.media_assets m
    where m.id = p_media_id
      and m.publish_state = 'published'
  ) then
    raise exception 'MEDIA_NOT_PUBLISHED' using errcode = 'P0001';
  end if;

  if v_old.image_id is distinct from p_media_id then
    update public.events
    set image_id = p_media_id
    where id = v_old.id
    returning * into v_new;
  end if;

  v_paths := private.hide_unused_media(v_actor);

  return jsonb_build_object(
    'event_id', v_old.id,
    'image_id', p_media_id,
    'hidden_paths', to_jsonb(v_paths)
  );
end;
$function$;

-- Based on 20261021064354_notes_without_topics (live definition).
CREATE OR REPLACE FUNCTION public.admin_set_note_archived(p_note_id uuid, p_archived boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_old public.notes;
  v_new public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_archived is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_old := private.lock_note(p_note_id);
  if (v_old.archived_at is not null) = p_archived then
    return jsonb_build_object('note_id', v_old.id, 'archived', p_archived);
  end if;

  update public.notes
  set archived_at = case when p_archived then now() else null end,
      updated_at = now()
  where id = v_old.id
  returning * into v_new;

  return jsonb_build_object('note_id', v_new.id, 'archived', p_archived);
end;
$function$;

-- Based on 20261021064354_notes_without_topics (live definition).
CREATE OR REPLACE FUNCTION public.admin_set_note_done(p_note_id uuid, p_done boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_old public.notes;
  v_new public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_done is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_old := private.lock_note(p_note_id);
  if v_old.done = p_done then
    return jsonb_build_object('note_id', v_old.id, 'done', v_old.done);
  end if;

  update public.notes
  set done = p_done, updated_at = now()
  where id = v_old.id
  returning * into v_new;

  return jsonb_build_object('note_id', v_new.id, 'done', v_new.done);
end;
$function$;

-- Based on 20261021064354_notes_without_topics (live definition).
CREATE OR REPLACE FUNCTION public.admin_set_note_order(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_old uuid[];
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_ids is null or cardinality(p_ids) = 0
     or array_position(p_ids, null) is not null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  perform private.lock_notes_board();
  perform 1 from public.notes n order by n.id for update;

  select coalesce(array_agg(n.id order by n.pinned desc, n.sort_order, n.id), '{}'::uuid[])
  into v_old
  from public.notes n;

  if cardinality(v_old) <> cardinality(p_ids)
     or (select count(distinct x) from unnest(p_ids) as x) <> cardinality(p_ids)
     or not (p_ids <@ v_old) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  if v_old = p_ids then
    return jsonb_build_object('note_ids', to_jsonb(p_ids));
  end if;

  update public.notes n
  set sort_order = o.n, updated_at = now()
  from unnest(p_ids) with ordinality as o(id, n)
  where n.id = o.id and n.sort_order is distinct from o.n::integer;

  return jsonb_build_object('note_ids', to_jsonb(p_ids));
end;
$function$;

-- Based on 20261021064354_notes_without_topics (live definition).
CREATE OR REPLACE FUNCTION public.admin_set_note_pinned(p_note_id uuid, p_pinned boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_old public.notes;
  v_new public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_pinned is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_old := private.lock_note(p_note_id);
  if v_old.pinned = p_pinned then
    return jsonb_build_object('note_id', v_old.id, 'pinned', v_old.pinned);
  end if;

  update public.notes
  set pinned = p_pinned, updated_at = now()
  where id = v_old.id
  returning * into v_new;

  return jsonb_build_object('note_id', v_new.id, 'pinned', v_new.pinned);
end;
$function$;

-- Based on 20261006215720_work_sheet_shopping (live definition).
CREATE OR REPLACE FUNCTION public.admin_set_shopping_item_bought(p_item_id uuid, p_bought boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_sheet public.work_sheets;
  v_old public.shopping_items;
  v_new public.shopping_items;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_bought is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_sheet := private.lock_sheet_of_shopping_item(p_item_id);

  select i.* into v_old from public.shopping_items i where i.id = p_item_id;
  if v_old.bought = p_bought then
    return jsonb_build_object('item_id', v_old.id, 'bought', v_old.bought);
  end if;

  update public.shopping_items
  set bought = p_bought, updated_at = now()
  where id = p_item_id
  returning * into v_new;

  return jsonb_build_object('item_id', v_new.id, 'bought', v_new.bought);
end;
$function$;

-- Based on 20261006215720_work_sheet_shopping (live definition).
CREATE OR REPLACE FUNCTION public.admin_set_shopping_item_order(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_sheet public.work_sheets;
  v_old uuid[];
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_ids is null or cardinality(p_ids) = 0
     or array_position(p_ids, null) is not null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  begin
    v_sheet := private.lock_sheet_of_shopping_item(p_ids[1]);
  exception when sqlstate 'P0001' then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end;

  select coalesce(array_agg(i.id order by i.sort_order, i.id), '{}'::uuid[])
  into v_old
  from public.shopping_items i
  where i.sheet_id = v_sheet.id;

  if cardinality(v_old) <> cardinality(p_ids)
     or (select count(distinct x) from unnest(p_ids) as x) <> cardinality(p_ids)
     or not (p_ids <@ v_old) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  if v_old = p_ids then
    return jsonb_build_object('item_ids', to_jsonb(p_ids));
  end if;

  update public.shopping_items i
  set sort_order = o.n, updated_at = now()
  from unnest(p_ids) with ordinality as o(id, n)
  where i.id = o.id and i.sort_order is distinct from o.n::integer;

  return jsonb_build_object('item_ids', to_jsonb(p_ids));
end;
$function$;

-- Based on 20261006191118_work_sheet_review_fixes (live definition).
CREATE OR REPLACE FUNCTION public.admin_set_work_dish_order(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_sheet public.work_sheets;
  v_old uuid[];
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_ids is null or cardinality(p_ids) = 0
     or array_position(p_ids, null) is not null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  begin
    v_sheet := private.lock_sheet_of_dish(p_ids[1]);
  exception when sqlstate 'P0001' then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end;

  select coalesce(array_agg(d.id order by d.sort_order, d.id), '{}'::uuid[])
  into v_old
  from public.work_dishes d
  where d.sheet_id = v_sheet.id;

  if cardinality(v_old) <> cardinality(p_ids)
     or (select count(distinct x) from unnest(p_ids) as x) <> cardinality(p_ids)
     or not (p_ids <@ v_old) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  if v_old = p_ids then
    return jsonb_build_object('dish_ids', to_jsonb(p_ids));
  end if;

  update public.work_dishes d
  set sort_order = o.n, updated_at = now()
  from unnest(p_ids) with ordinality as o(id, n)
  where d.id = o.id and d.sort_order is distinct from o.n::integer;

  return jsonb_build_object('dish_ids', to_jsonb(p_ids));
end;
$function$;

-- Based on 20261006184223_work_sheet (live definition).
CREATE OR REPLACE FUNCTION public.admin_set_work_task_done(p_task_id uuid, p_done boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_sheet public.work_sheets;
  v_old public.work_tasks;
  v_new public.work_tasks;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_done is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_sheet := private.lock_sheet_of_task(p_task_id);

  select t.* into v_old from public.work_tasks t where t.id = p_task_id;
  if v_old.done = p_done then
    return jsonb_build_object('task_id', v_old.id, 'done', v_old.done);
  end if;

  update public.work_tasks
  set done = p_done, updated_at = now()
  where id = p_task_id
  returning * into v_new;

  return jsonb_build_object('task_id', v_new.id, 'done', v_new.done);
end;
$function$;

-- Based on 20261006191118_work_sheet_review_fixes (live definition).
CREATE OR REPLACE FUNCTION public.admin_set_work_task_order(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_sheet public.work_sheets;
  v_first public.work_tasks;
  v_old uuid[];
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_ids is null or cardinality(p_ids) = 0
     or array_position(p_ids, null) is not null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  begin
    v_sheet := private.lock_sheet_of_task(p_ids[1]);
  exception when sqlstate 'P0001' then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end;

  select t.* into v_first from public.work_tasks t where t.id = p_ids[1];

  select coalesce(array_agg(t.id order by t.sort_order, t.id), '{}'::uuid[])
  into v_old
  from public.work_tasks t
  where t.dish_id = v_first.dish_id and t.day_offset = v_first.day_offset;

  if cardinality(v_old) <> cardinality(p_ids)
     or (select count(distinct x) from unnest(p_ids) as x) <> cardinality(p_ids)
     or not (p_ids <@ v_old) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  if v_old = p_ids then
    return jsonb_build_object('task_ids', to_jsonb(p_ids));
  end if;

  update public.work_tasks t
  set sort_order = o.n, updated_at = now()
  from unnest(p_ids) with ordinality as o(id, n)
  where t.id = o.id and t.sort_order is distinct from o.n::integer;

  return jsonb_build_object('task_ids', to_jsonb(p_ids));
end;
$function$;

-- Based on 20261021064354_notes_without_topics (live definition).
CREATE OR REPLACE FUNCTION public.admin_update_note(p_note_id uuid, p_body text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_body text;
  v_old public.notes;
  v_new public.notes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_note', p_idempotency_key,
    jsonb_build_object('note_id', p_note_id, 'body', p_body)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_old := private.lock_note(p_note_id);
  v_body := private.note_text(p_body, 'body', 2000);

  if v_old.body = v_body then
    return private.idempotent_finish(
      v_actor::text, 'admin_update_note', p_idempotency_key,
      jsonb_build_object('note_id', v_old.id)
    );
  end if;

  update public.notes
  set body = v_body, updated_at = now()
  where id = v_old.id
  returning * into v_new;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_note', p_idempotency_key,
    jsonb_build_object('note_id', v_new.id)
  );
end;
$function$;

-- Based on 20261006215720_work_sheet_shopping (live definition).
CREATE OR REPLACE FUNCTION public.admin_update_shopping_item(p_item_id uuid, p_body text, p_quantity text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_sheet public.work_sheets;
  v_body text;
  v_quantity text;
  v_old public.shopping_items;
  v_new public.shopping_items;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_shopping_item', p_idempotency_key,
    jsonb_build_object('item_id', p_item_id, 'body', p_body, 'quantity', p_quantity)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.lock_sheet_of_shopping_item(p_item_id);
  v_body := private.work_text(p_body, 'body');
  v_quantity := private.shopping_quantity(p_quantity);

  select i.* into v_old from public.shopping_items i where i.id = p_item_id;

  if v_old.body = v_body and v_old.quantity is not distinct from v_quantity then
    return private.idempotent_finish(
      v_actor::text, 'admin_update_shopping_item', p_idempotency_key,
      jsonb_build_object('item_id', v_old.id)
    );
  end if;

  update public.shopping_items
  set body = v_body, quantity = v_quantity, updated_at = now()
  where id = p_item_id
  returning * into v_new;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_shopping_item', p_idempotency_key,
    jsonb_build_object('item_id', v_new.id)
  );
end;
$function$;

-- Based on 20261006191118_work_sheet_review_fixes (live definition).
CREATE OR REPLACE FUNCTION public.admin_update_work_dish(p_dish_id uuid, p_name text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_sheet public.work_sheets;
  v_name text;
  v_old public.work_dishes;
  v_new public.work_dishes;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_work_dish', p_idempotency_key,
    jsonb_build_object('dish_id', p_dish_id, 'name', p_name)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.lock_sheet_of_dish(p_dish_id);
  v_name := private.work_text(p_name, 'name');

  select d.* into v_old from public.work_dishes d where d.id = p_dish_id;

  if v_old.name = v_name then
    return private.idempotent_finish(
      v_actor::text, 'admin_update_work_dish', p_idempotency_key,
      jsonb_build_object('dish_id', v_old.id)
    );
  end if;

  update public.work_dishes
  set name = v_name, updated_at = now()
  where id = p_dish_id
  returning * into v_new;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_work_dish', p_idempotency_key,
    jsonb_build_object('dish_id', v_new.id)
  );
end;
$function$;

-- Based on 20261006191118_work_sheet_review_fixes (live definition).
CREATE OR REPLACE FUNCTION public.admin_update_work_task(p_task_id uuid, p_body text, p_day_offset integer, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_sheet public.work_sheets;
  v_body text;
  v_old public.work_tasks;
  v_new public.work_tasks;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_work_task', p_idempotency_key,
    jsonb_build_object('task_id', p_task_id, 'body', p_body, 'day_offset', p_day_offset)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_sheet := private.lock_sheet_of_task(p_task_id);
  v_body := private.work_text(p_body, 'body');
  if p_day_offset is null or not (p_day_offset = any (v_sheet.prep_days::integer[])) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "day_offset"}';
  end if;

  select t.* into v_old from public.work_tasks t where t.id = p_task_id;

  if v_old.body = v_body and v_old.day_offset = p_day_offset then
    return private.idempotent_finish(
      v_actor::text, 'admin_update_work_task', p_idempotency_key,
      jsonb_build_object('task_id', v_old.id)
    );
  end if;

  update public.work_tasks t
  set body = v_body,
      day_offset = p_day_offset,
      sort_order = case
        when t.day_offset = p_day_offset then t.sort_order
        else coalesce(
          (select max(o.sort_order) from public.work_tasks o
           where o.dish_id = t.dish_id and o.day_offset = p_day_offset),
          0
        ) + 1
      end,
      updated_at = now()
  where t.id = p_task_id
  returning * into v_new;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_work_task', p_idempotency_key,
    jsonb_build_object('task_id', v_new.id)
  );
end;
$function$;

-- Based on 20261002182800_existing_account_and_conflicts (live definition).
CREATE OR REPLACE FUNCTION public.claim_join(p_token text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_customer uuid := private.current_customer_id();
  v_token public.activation_tokens;
  v_new public.activation_tokens;
  v_scope text;
  v_prev jsonb;
  v_conflict boolean := false;
  v_result jsonb;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_idempotency_key is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_token := private.find_token(p_token, false);

  if v_token.id is null or v_token.purpose <> 'join' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_scope := v_customer::text;
  v_prev := private.idempotent_begin(
    v_scope, 'claim_join', p_idempotency_key,
    jsonb_build_object('token_id', v_token.id)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  -- Lock order (AD-6): activation_tokens first, then bind_purchase.
  select t.* into v_token
  from public.activation_tokens t
  where t.id = v_token.id
  for update;

  if v_token.state <> 'awaiting_login'
     or v_token.bound_user_id is distinct from v_customer
     or now() > v_token.expires_at then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  begin
    perform private.bind_purchase(v_token.payment_id, v_customer);
  exception
    when unique_violation then
      v_conflict := true;
    when raise_exception then
      if sqlerrm <> 'BIND_CONFLICT' then
        raise;
      end if;
      v_conflict := true;
  end;

  if v_conflict then
    update public.activation_tokens
    set state = 'conflict', conflict_reason = 'bind_conflict'
    where id = v_token.id
    returning * into v_new;

    v_result := jsonb_build_object('outcome', 'conflict');
  else
    update public.activation_tokens
    set state = 'consumed', consumed_at = now(), customer_id = v_customer
    where id = v_token.id
    returning * into v_new;

    v_result := jsonb_build_object('outcome', 'claimed', 'payment_id', v_token.payment_id);
  end if;

  return private.idempotent_finish(v_scope, 'claim_join', p_idempotency_key, v_result);
end;
$function$;

-- Based on 20261003192417_join_begin_discard_before_lock (live definition).
CREATE OR REPLACE FUNCTION public.join_begin(p_token text, p_email text, p_phone text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_token public.activation_tokens;
  v_orig public.activation_tokens;
  v_new public.activation_tokens;
  v_scope text;
  v_prev jsonb;
  v_identity jsonb;
  v_match jsonb;
  v_hash text;
  v_result jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_idempotency_key is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- Unlocked read: builds the scope and answers the closed states. The raw
  -- token never reaches the stored request hash.
  v_token := private.find_token(p_token, false);

  if v_token.id is null or v_token.purpose <> 'join' then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  v_scope := 'token:' || v_token.id::text;

  if v_token.state = 'consumed' then
    -- Completed by this key, only the response was lost: no Auth change.
    select r.result into v_prev
    from private.idempotency_results r
    where r.actor_scope = v_scope
      and r.rpc = 'join_complete'
      and r.key = p_idempotency_key
      and r.result is not null;
    if v_prev is not null then
      return v_prev;
    end if;
    raise exception 'LINK_USED' using errcode = 'P0001';
  end if;

  if v_token.state = 'revoked'
     or (v_token.state in ('pending', 'awaiting_login') and now() > v_token.expires_at) then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  if v_token.state = 'conflict' then
    return jsonb_build_object(
      'outcome', 'conflict', 'token_id', v_token.id, 'reason', v_token.conflict_reason
    );
  end if;

  v_identity := private.join_identity(p_email, p_phone);
  v_hash := v_identity ->> 'input_hash';

  v_prev := private.idempotent_begin(
    v_scope, 'join_begin', p_idempotency_key,
    jsonb_build_object('input_hash', v_hash)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  -- Lock order (AD-6): activation_tokens first; re-check after the lock.
  select t.* into v_token
  from public.activation_tokens t
  where t.id = v_token.id
  for update;

  v_orig := v_token;

  if v_token.state = 'consumed' then
    raise exception 'LINK_USED' using errcode = 'P0001';
  end if;

  if v_token.state = 'revoked'
     or (v_token.state in ('pending', 'awaiting_login') and now() > v_token.expires_at) then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  if v_token.state = 'conflict' then
    v_result := jsonb_build_object(
      'outcome', 'conflict', 'token_id', v_token.id, 'reason', v_token.conflict_reason
    );
  elsif v_token.state = 'claiming' and v_token.input_hash = v_hash then
    v_result := jsonb_build_object(
      'outcome', 'claiming',
      'token_id', v_token.id,
      'pending_user_id', v_token.pending_user_id
    );
  elsif v_token.state = 'awaiting_login' and v_token.input_hash = v_hash then
    v_result := jsonb_build_object('outcome', 'existing_account', 'token_id', v_token.id);
  elsif v_token.state in ('claiming', 'awaiting_login') then
    -- A correction of the input (user decision 2026-10-03).
    if now() > v_token.expires_at then
      raise exception 'LINK_EXPIRED' using errcode = 'P0001';
    end if;

    -- The Auth user of the previous input goes first (also before the
    -- lock below, so no orphan stays behind a locked link).
    if v_token.state = 'claiming'
       and exists (select 1 from auth.users u where u.id = v_token.pending_user_id) then
      -- Nothing changes here.
      v_result := jsonb_build_object(
        'outcome', 'discard_pending_user',
        'token_id', v_token.id,
        'pending_user_id', v_token.pending_user_id
      );
    elsif v_token.identity_attempts >= 2 then
      update public.activation_tokens
      set state = 'conflict',
          conflict_reason = 'too_many_attempts',
          bound_user_id = null
      where id = v_token.id
      returning * into v_new;

      v_result := jsonb_build_object(
        'outcome', 'conflict', 'token_id', v_new.id, 'reason', v_new.conflict_reason
      );
    else
      update public.activation_tokens
      set state = 'pending',
          pending_user_id = null,
          input_hash = null,
          claiming_at = null,
          bound_user_id = null,
          identity_attempts = identity_attempts + 1
      where id = v_token.id
      returning * into v_token;
    end if;
  elsif v_token.state <> 'pending' then
    raise exception 'LINK_IN_USE' using errcode = 'P0001';
  end if;

  -- A pending link (also one reset just above): classify the input.
  if v_result is null then
    v_match := private.find_identity(v_identity ->> 'email', v_identity ->> 'phone');

    if v_match ->> 'match' = 'none' then
      update public.activation_tokens
      set state = 'claiming',
          pending_user_id = gen_random_uuid(),
          input_hash = v_hash,
          claiming_at = now()
      where id = v_token.id
      returning * into v_new;

      v_result := jsonb_build_object(
        'outcome', 'claiming',
        'token_id', v_new.id,
        'pending_user_id', v_new.pending_user_id
      );
    elsif v_match ->> 'match' = 'account' then
      update public.activation_tokens
      set state = 'awaiting_login',
          bound_user_id = (v_match ->> 'customer_id')::uuid,
          input_hash = v_hash
      where id = v_token.id
      returning * into v_new;

      v_result := jsonb_build_object('outcome', 'existing_account', 'token_id', v_new.id);
    elsif v_match ->> 'reason' = 'two_accounts' and v_token.identity_attempts < 2 then
      -- Attempts 1 and 2: the link stays pending and the customer may check
      -- her details (user decision 2026-10-02).
      update public.activation_tokens
      set identity_attempts = identity_attempts + 1
      where id = v_token.id
      returning * into v_new;

      v_result := jsonb_build_object('outcome', 'identity_retry', 'token_id', v_new.id);
    else
      -- The third two_accounts attempt locks the link; any other reason
      -- stops at once.
      update public.activation_tokens
      set state = 'conflict',
          conflict_reason = v_match ->> 'reason',
          identity_attempts = case
            when v_match ->> 'reason' = 'two_accounts' then identity_attempts + 1
            else identity_attempts
          end
      where id = v_token.id
      returning * into v_new;

      v_result := jsonb_build_object(
        'outcome', 'conflict', 'token_id', v_new.id, 'reason', v_new.conflict_reason
      );
    end if;
  end if;

  return private.idempotent_finish(v_scope, 'join_begin', p_idempotency_key, v_result);
end;
$function$;

-- Based on 20261013161248_couple_and_intro (live definition).
CREATE OR REPLACE FUNCTION public.set_booking_guest_details(p_booking_id uuid, p_guest_details text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_customer uuid := (select private.current_customer_id());
  v_prev jsonb;
  v_text text;
  v_booking public.bookings;
  v_locked public.bookings;
  v_new public.bookings;
  v_closes_at timestamptz;
begin
  if v_customer is null then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'set_booking_guest_details', p_idempotency_key,
    jsonb_build_object('booking_id', p_booking_id, 'guest_details', p_guest_details)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  v_text := nullif(btrim(coalesce(p_guest_details, '')), '');
  if char_length(v_text) > 1000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "guest_details"}';
  end if;

  perform 1
  from public.profiles p
  where p.id = v_customer
  for update;

  select b.* into v_booking
  from public.bookings b
  where b.id = p_booking_id
    and b.customer_id = v_customer;

  if v_booking.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select e.registration_closes_at into v_closes_at
  from public.events e
  where e.id = v_booking.event_id
  for update;

  select b.* into v_locked
  from public.bookings b
  where b.id = v_booking.id
  for update;

  if v_locked is distinct from v_booking then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  if v_booking.status <> 'confirmed' or v_booking.party_size <> 2 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "booking"}';
  end if;

  if now() >= v_closes_at then
    raise exception 'REGISTRATION_CLOSED' using errcode = 'P0001';
  end if;

  if v_booking.guest_details is distinct from v_text then
    update public.bookings
    set guest_details = v_text
    where id = v_booking.id
    returning * into v_new;
  end if;

  return private.idempotent_finish(
    v_actor::text, 'set_booking_guest_details', p_idempotency_key,
    jsonb_build_object('booking_id', v_booking.id, 'guest_details', v_text)
  );
end;
$function$;


-- ==========================================================================
-- Sessions and products (user decisions 2026-10-22).
-- ==========================================================================

-- Based on 20261020200233_eligible_products (live definition).
CREATE OR REPLACE FUNCTION public.admin_duplicate_event(p_event_id uuid, p_date date, p_start_time time without time zone, p_end_time time without time zone, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_source public.events;
  v_row public.events;
  v_saved public.events;
  -- Story 3.18.
  v_products jsonb;
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

  -- Story 5.20 (user decision 2026-10-22): an archived concept is not
  -- duplicated; Tal restores it first. The concept row is share-locked
  -- first, so it cannot be archived while this copy is made.
  perform 1
  from public.concepts c
  where c.id = v_source.concept_id
  for share;

  if exists (
    select 1
    from public.concepts c
    where c.id = v_source.concept_id
      and c.archived_at is not null
  ) then
    raise exception 'CONCEPT_ARCHIVED' using errcode = 'P0001';
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

  if v_source.image_id is not null then
    update public.events
    set image_id = v_source.image_id
    where id = v_saved.id
    returning * into v_saved;
  end if;

  perform private.audit(
    v_actor, 'admin', 'admin_duplicate_event', 'events', v_saved.id,
    null, v_saved.id, null, to_jsonb(v_saved)
  );

  -- Story 3.18: the source's product set, with its own audit row. Story
  -- 5.20: only products whose kind still fits the session (a product marked
  -- on a past session may have changed kind since; PRODUCT_IN_USE guards
  -- only sessions ahead).
  select coalesce(jsonb_agg(ep.product_id order by ep.product_id), '[]'::jsonb)
  into v_products
  from public.event_products ep
  join public.products p on p.id = ep.product_id
  where ep.event_id = v_source.id
    and p.eligible_event_kind = v_saved.kind;

  perform private.save_event_products(
    v_saved, v_products, v_actor, 'admin_duplicate_event'
  );

  return private.idempotent_finish(
    v_actor::text, 'admin_duplicate_event', p_idempotency_key,
    jsonb_build_object('event_id', v_saved.id)
  );
end;
$function$;

-- Based on 20261020200233_eligible_products (live definition).
CREATE OR REPLACE FUNCTION public.admin_update_event(p_event_id uuid, p_changes jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_old public.events;
  v_row public.events;
  v_saved public.events;
  -- Story 5.6.
  v_free_before integer;
  -- Story 5.20.
  v_reopened boolean;
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
    p_changes - 'product_ids',
    array['date', 'start_time', 'end_time', 'description',
          'capacity_adults', 'registration_closes_local', 'display_price_agorot']
  );

  if (
       v_row.starts_at is distinct from v_old.starts_at
       or v_row.ends_at is distinct from v_old.ends_at
       or v_row.kind is distinct from v_old.kind
     )
     and exists (
       select 1
       from public.bookings b
       where b.event_id = v_old.id
         and b.status = 'confirmed'
     ) then
    raise exception 'EVENT_HAS_BOOKINGS' using errcode = 'P0001';
  end if;

  -- Never below the places already taken: no silent overbooking (CAP-14).
  if v_row.capacity_adults is distinct from v_old.capacity_adults
     and v_row.capacity_adults < private.occupied_places(v_old.id) then
    raise exception 'CAPACITY_BELOW_BOOKED' using errcode = 'P0001';
  end if;

  -- Story 5.6: the free places before the save (AD-14).
  v_free_before := v_old.capacity_adults - private.occupied_places(v_old.id);

  if v_row is distinct from v_old then
    v_saved := private.save_event(v_row, false);

    if v_saved is distinct from v_old then
      perform private.audit(
        v_actor, 'admin', 'admin_update_event', 'events', v_saved.id,
        null, v_saved.id, to_jsonb(v_old), to_jsonb(v_saved)
      );
    end if;

    if v_saved.capacity_adults is distinct from v_old.capacity_adults then
      perform private.refresh_credits_for_event(v_old.id);
    end if;

    -- Story 5.20 (user decision 2026-10-22): registration closed before
    -- this save and open after it (published, not started) reopens it for
    -- the waiters, as if no place was free before (notify_waitlist checks
    -- that one is free now). Merged with the capacity raise below: one call
    -- at most.
    v_reopened := v_old.registration_closes_at <= now()
      and v_saved.registration_closes_at > now()
      and v_saved.status = 'published'
      and v_saved.starts_at > now();

    if v_reopened then
      perform private.notify_waitlist(v_old.id, 0);
    -- Story 5.6: a capacity raise may free a place for the waiters.
    elsif v_saved.capacity_adults > v_old.capacity_adults then
      perform private.notify_waitlist(v_old.id, v_free_before);
    end if;
  end if;

  -- Story 3.18: allowed with bookings, which stay as they are. A changed set
  -- has its own audit row, and the credit options on this session are
  -- checked again (one that stops fitting is replaced).
  if p_changes ? 'product_ids'
     and private.save_event_products(
       coalesce(v_saved, v_old), p_changes -> 'product_ids', v_actor, 'admin_update_event'
     ) then
    perform private.refresh_credits_for_event(v_old.id);
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_event', p_idempotency_key,
    jsonb_build_object('event_id', v_old.id)
  );
end;
$function$;

-- Based on 20261004103954_product_catalog_admin (live definition).
CREATE OR REPLACE FUNCTION public.admin_update_product(p_product_id uuid, p_changes jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_prev jsonb;
  v_old public.products;
  v_row public.products;
  v_saved public.products;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_prev := private.idempotent_begin(
    v_actor::text, 'admin_update_product', p_idempotency_key,
    jsonb_build_object('product_id', p_product_id, 'changes', p_changes)
  );
  if v_prev is not null then
    return v_prev;
  end if;

  if p_changes is null
     or jsonb_typeof(p_changes) <> 'object'
     or p_changes = '{}'::jsonb then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select p.* into v_old
  from public.products p
  where p.id = p_product_id
  for update;

  if v_old.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_row := private.apply_product_changes(v_old, p_changes, true);

  -- Story 5.20 (user decision 2026-10-22): a product marked eligible on a
  -- session that is still ahead keeps its event kind; Tal takes it off
  -- those sessions first. Past and cancelled sessions do not count.
  if v_row.eligible_event_kind is distinct from v_old.eligible_event_kind
     and exists (
       select 1
       from public.event_products ep
       join public.events e on e.id = ep.event_id
       where ep.product_id = v_old.id
         and e.status not in ('cancelled', 'completed')
         and e.starts_at > now()
     ) then
    raise exception 'PRODUCT_IN_USE' using errcode = 'P0001';
  end if;

  if v_row is distinct from v_old then
    v_saved := private.save_product(v_row, false);

    perform private.audit(
      v_actor, 'admin', 'admin_update_product', 'products', v_saved.id,
      null, null, to_jsonb(v_old), to_jsonb(v_saved)
    );
  end if;

  return private.idempotent_finish(
    v_actor::text, 'admin_update_product', p_idempotency_key,
    jsonb_build_object('product_id', v_old.id)
  );
end;
$function$;

-- Based on 20261010200221_admin_session_occupancy (live definition).
CREATE OR REPLACE FUNCTION public.admin_list_session_occupancy(p_event_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_event_ids is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_id', e.id,
        'occupied', private.occupied_places(e.id),
        -- Story 5.20: the capacity is read only through admin RPCs.
        'capacity', e.capacity_adults
      )
      order by e.starts_at, e.id
    ),
    '[]'::jsonb
  )
  into v_result
  from public.events e
  where e.id = any (p_event_ids);

  return v_result;
end;
$function$;


-- ==========================================================================
-- Baby birth date: 2 years back to 9 months ahead (user decision 2026-10-22).
-- ==========================================================================

-- Based on 20261005232525_profile_babies_and_photo_consent (live definition).
CREATE OR REPLACE FUNCTION private.babies_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- Story 5.20 (user decision 2026-10-22): from 2 years back to 9 months
  -- ahead of the local today, checked only when the date is set or changed
  -- (an old row keeps its date when only the name changes).
  if (tg_op = 'INSERT' or new.birth_date is distinct from old.birth_date)
     and not private.birth_date_allowed(new.birth_date, v_today) then
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
$function$;

-- Based on 20261007183144_two_photo_consents (live definition).
CREATE OR REPLACE FUNCTION public.join_complete(p_token text, p_profile jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_token public.activation_tokens;
  v_new public.activation_tokens;
  v_scope text;
  v_prev jsonb;
  v_identity jsonb;
  v_full_name text;
  v_dietary_notes text;
  v_babies jsonb;
  v_item record;
  v_name text;
  v_birth_text text;
  v_birth date;
  v_names text[] := '{}';
  v_births date[] := '{}';
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_privacy_version integer;
  v_photo_version integer;
  v_profile public.profiles;
  v_baby public.babies;
  v_conflict_reason text;
  v_constraint text;
  i integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_idempotency_key is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_token := private.find_token(p_token, false);

  if v_token.id is null or v_token.purpose <> 'join' then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  v_scope := 'token:' || v_token.id::text;
  v_prev := private.idempotent_begin(v_scope, 'join_complete', p_idempotency_key, '{}'::jsonb);
  if v_prev is not null then
    return v_prev;
  end if;

  -- Lock order (AD-6): activation_tokens, then profiles, entitlements,
  -- payments and notification_jobs inside private.bind_purchase.
  select t.* into v_token
  from public.activation_tokens t
  where t.id = v_token.id
  for update;

  if v_token.state = 'consumed' then
    raise exception 'LINK_USED' using errcode = 'P0001';
  end if;

  if v_token.state = 'conflict' then
    return private.idempotent_finish(
      v_scope, 'join_complete', p_idempotency_key,
      jsonb_build_object(
        'outcome', 'conflict', 'token_id', v_token.id, 'reason', v_token.conflict_reason
      )
    );
  end if;

  -- A claiming link may finish after its expiry (AD-10).
  if v_token.state <> 'claiming' then
    raise exception 'LINK_EXPIRED' using errcode = 'P0001';
  end if;

  if p_profile is null or jsonb_typeof(p_profile) <> 'object' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_identity := private.join_identity(p_profile ->> 'email', p_profile ->> 'phone');

  if v_identity ->> 'input_hash' is distinct from v_token.input_hash then
    raise exception 'LINK_IN_USE' using errcode = 'P0001';
  end if;

  -- The Auth user of step 2 exists, with the email of this input.
  if not exists (
    select 1
    from auth.users u
    where u.id = v_token.pending_user_id
      and lower(u.email) = v_identity ->> 'email'
  ) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_full_name := btrim(p_profile ->> 'full_name');
  if v_full_name is null or char_length(v_full_name) not between 1 and 200 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "full_name"}';
  end if;

  if (p_profile -> 'privacy_consent') is distinct from 'true'::jsonb then
    raise exception 'CONSENT_REQUIRED' using errcode = 'P0001';
  end if;

  -- "Private" is a full answer; only a missing answer is refused.
  if jsonb_typeof(p_profile -> 'photo_consent') is distinct from 'boolean' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "photo_consent"}';
  end if;

  if jsonb_typeof(p_profile -> 'personal_photo_consent') is distinct from 'boolean' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "personal_photo_consent"}';
  end if;

  if coalesce(jsonb_typeof(p_profile -> 'dietary_notes'), 'null') not in ('string', 'null') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "dietary_notes"}';
  end if;
  v_dietary_notes := nullif(btrim(p_profile ->> 'dietary_notes'), '');
  if char_length(v_dietary_notes) > 2000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "dietary_notes"}';
  end if;

  -- At least one baby (user decision 2026-10-01), at most 10 per form.
  v_babies := p_profile -> 'babies';
  if jsonb_typeof(v_babies) is distinct from 'array'
     or jsonb_array_length(v_babies) not between 1 and 10 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "babies"}';
  end if;

  for v_item in
    select b.value as item, (b.ordinality - 1)::integer as idx
    from jsonb_array_elements(v_babies) with ordinality as b (value, ordinality)
  loop
    if jsonb_typeof(v_item.item) <> 'object' then
      raise exception 'INVALID_INPUT' using errcode = 'P0001', detail = '{"field": "babies"}';
    end if;

    v_name := btrim(v_item.item ->> 'name');
    if v_name is null or char_length(v_name) not between 1 and 100 then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', 'baby_name', 'index', v_item.idx)::text;
    end if;

    v_birth_text := v_item.item ->> 'birth_date';
    v_birth := null;
    if v_birth_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      begin
        v_birth := v_birth_text::date;
      exception when others then
        v_birth := null;
      end;
    end if;

    -- From 2 years back to 9 months ahead of the local today (AD-8,
    -- story 5.20).
    if v_birth is null or not private.birth_date_allowed(v_birth, v_today) then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', 'birth_date', 'index', v_item.idx)::text;
    end if;

    v_names := v_names || v_name;
    v_births := v_births || v_birth;
  end loop;

  -- The published versions at the time of consent (0 = the seed).
  select cp.published_version into v_privacy_version
  from public.content_pages cp
  where cp.slug = 'privacy';

  select cp.published_version into v_photo_version
  from public.content_pages cp
  where cp.slug = 'join-form';

  if v_privacy_version is null or v_photo_version is null then
    raise exception 'join_complete: content pages missing' using errcode = 'XX000';
  end if;

  -- Everything of the customer in one sub-block: a unique violation (the
  -- phone taken since join_begin, or any other) or BIND_CONFLICT undoes it
  -- all and the link goes to conflict.
  begin
    insert into public.profiles (
      id, full_name, phone_e164, dietary_notes, activated_at,
      privacy_consent_at, privacy_policy_version,
      photo_consent, photo_consent_at, photo_consent_text_version,
      personal_photo_consent, personal_photo_consent_at, personal_photo_consent_text_version
    )
    values (
      v_token.pending_user_id, v_full_name, v_identity ->> 'phone', v_dietary_notes, now(),
      now(), v_privacy_version,
      (p_profile ->> 'photo_consent')::boolean, now(), v_photo_version,
      (p_profile ->> 'personal_photo_consent')::boolean, now(), v_photo_version
    )
    returning * into v_profile;

    perform private.audit(
      v_profile.id, 'customer', 'join_complete', 'profiles', v_profile.id,
      v_profile.id, null, null, to_jsonb(v_profile)
    );

    for i in 1 .. cardinality(v_names) loop
      insert into public.babies (customer_id, name, birth_date)
      values (v_profile.id, v_names[i], v_births[i])
      returning * into v_baby;

      perform private.audit(
        v_profile.id, 'customer', 'join_complete', 'babies', v_baby.id,
        v_profile.id, null, null, to_jsonb(v_baby)
      );
    end loop;

    perform private.bind_purchase(v_token.payment_id, v_profile.id);
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      v_conflict_reason := case
        when v_constraint = 'profiles_phone_e164_key' then 'phone_taken'
        else 'bind_conflict'
      end;
    when raise_exception then
      if sqlerrm <> 'BIND_CONFLICT' then
        raise;
      end if;
      v_conflict_reason := 'bind_conflict';
  end;

  if v_conflict_reason is not null then
    update public.activation_tokens
    set state = 'conflict', conflict_reason = v_conflict_reason
    where id = v_token.id
    returning * into v_new;

    perform private.audit(
      null, 'system', 'join_complete', 'activation_tokens', v_token.id,
      null, null, to_jsonb(v_token), to_jsonb(v_new)
    );

    return private.idempotent_finish(
      v_scope, 'join_complete', p_idempotency_key,
      jsonb_build_object(
        'outcome', 'conflict', 'token_id', v_token.id, 'reason', v_conflict_reason
      )
    );
  end if;

  update public.activation_tokens
  set state = 'consumed', consumed_at = now(), customer_id = v_profile.id
  where id = v_token.id
  returning * into v_new;

  perform private.audit(
    v_profile.id, 'customer', 'join_complete', 'activation_tokens', v_token.id,
    v_profile.id, null, to_jsonb(v_token), to_jsonb(v_new)
  );

  return private.idempotent_finish(
    v_scope, 'join_complete', p_idempotency_key,
    jsonb_build_object(
      'outcome', 'joined',
      'token_id', v_token.id,
      'customer_id', v_profile.id,
      'payment_id', v_token.payment_id
    )
  );
end;
$function$;


-- ==========================================================================
-- Credits and cards: only sessions that accept the product.
-- ==========================================================================

-- Based on 20261019204039_credit_adjustments (live definition).
CREATE OR REPLACE FUNCTION private.credit_session_matches(p_credit cancellation_credits, p_event events)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(
    p_event.status = 'published'
    and p_event.kind = p_credit.event_kind
    and p_event.starts_at > now()
    and now() < p_event.registration_closes_at
    and private.occupied_places(p_event.id) + p_credit.party_size <= p_event.capacity_adults
    -- Story 5.20: the session accepts the product of the credit's source
    -- (as private.plan_funding).
    and private.event_accepts_product(
      p_event.id,
      (
        select (se.eligibility_snapshot ->> 'product_id')::uuid
        from public.entitlements se
        where se.id = p_credit.source_entitlement_id
      )
    )
    and p_event.id is distinct from (
      select b.event_id
      from public.bookings b
      where b.id = p_credit.origin_booking_id
    )
    and not exists (
      select 1
      from public.bookings b
      where b.customer_id = p_credit.customer_id
        and b.event_id = p_event.id
        and b.status = 'confirmed'
    ),
    false
  );
$function$;

-- Based on 20261013162639_business_cancel_event (live definition).
CREATE OR REPLACE FUNCTION private.plan_admin_cancel_event(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_event public.events;
  v_concept text;
  v_counts record;
  v_at_risk jsonb;
  v_parked jsonb;
  v_template public.notification_templates;
  v_vars jsonb;
begin
  select e.* into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null
     or v_event.status <> 'published'
     or v_event.starts_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'EVENT_NOT_CANCELLABLE');
  end if;

  if exists (
    select 1
    from public.bookings b
    where b.event_id = v_event.id
      and b.status = 'confirmed'
      and private.needs_manual_cancel(b.id)
  ) then
    return jsonb_build_object('ok', false, 'code', 'MANUAL_HANDLING_REQUIRED');
  end if;

  select c.name into v_concept from public.concepts c where c.id = v_event.concept_id;

  select
    count(*)::integer as booking_count,
    count(*) filter (where x.funding = 'card')::integer as card_count,
    count(*) filter (
      where x.funding <> 'card' and x.customer_id is not null
    )::integer as choice_count,
    count(*) filter (where x.customer_id is null)::integer as unbound_count
  into v_counts
  from (
    select
      b.customer_id,
      coalesce(private.booking_funding(b.id) ->> 'funding', 'card') as funding
    from public.bookings b
    where b.event_id = v_event.id
      and b.status = 'confirmed'
  ) x;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'customer_id', r.customer_id,
        'customer_label', r.customer_label,
        'product_name', r.product_name,
        'expires_on', r.expires_on,
        'reason', r.reason
      )
      order by r.expires_on, r.booking_id
    ),
    '[]'::jsonb
  )
  into v_at_risk
  from (
    select
      b.id as booking_id,
      b.customer_id,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label,
      p.product_snapshot ->> 'name' as product_name,
      e.expires_on,
      case
        when private.local_day_end(e.expires_on) <= now() then 'expired'
        else 'no_session_before_expiry'
      end as reason
    from public.bookings b
    cross join lateral (select private.booking_funding(b.id) as j) f
    join public.entitlements e on e.id = (f.j ->> 'entitlement_id')::uuid
    join public.payments p on p.id = e.payment_id
    left join public.profiles pr on pr.id = b.customer_id
    where b.event_id = v_event.id
      and b.status = 'confirmed'
      and f.j ->> 'funding' = 'card'
      and (
        private.local_day_end(e.expires_on) <= now()
        or not exists (
          select 1
          from public.events o
          where o.id <> v_event.id
            and o.status = 'published'
            and now() < o.registration_closes_at
            and o.starts_at < private.local_day_end(e.expires_on)
            and o.kind = e.eligible_event_kind
            -- Story 5.20: a session that accepts the card's product.
            and private.event_accepts_product(
              o.id, (e.eligibility_snapshot ->> 'product_id')::uuid
            )
            and not (e.kind = 'card' and o.kind = 'couple')
            and (o.starts_at at time zone 'Asia/Jerusalem')::date >= e.valid_from
            and (
              e.allowed_weekdays is null
              or extract(dow from (o.starts_at at time zone 'Asia/Jerusalem')::date)::smallint
                 = any (e.allowed_weekdays)
            )
            and private.occupied_places(o.id) + b.party_size <= o.capacity_adults
            and not exists (
              select 1
              from public.bookings ob
              where ob.event_id = o.id
                and ob.customer_id = b.customer_id
                and ob.status = 'confirmed'
            )
        )
      )
  ) r;

  -- Paid without a place (3.11 'park'): an active entitlement pinned to the
  -- session with no booking on its payment, joined or not. Never blocks;
  -- the action needs p_parked_acknowledged (user decision 2026-10-13).
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'customer_id', x.customer_id,
        'customer_label', x.customer_label,
        'payment_id', x.payment_id
      )
      order by x.created_at, x.payment_id
    ),
    '[]'::jsonb
  )
  into v_parked
  from (
    select
      coalesce(e.customer_id, p.customer_id) as customer_id,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label,
      p.id as payment_id,
      e.created_at
    from public.entitlements e
    join public.payments p on p.id = e.payment_id
    left join public.profiles pr on pr.id = coalesce(e.customer_id, p.customer_id)
    where e.pinned_event_id = v_event.id
      and e.status = 'active'
      and not exists (
        select 1 from public.bookings b where b.payment_id = e.payment_id
      )
  ) x;

  select t.* into v_template
  from public.notification_templates t
  where t.type = 'event_cancelled';

  v_vars := jsonb_build_object(
    'date',
    private.format_day_month((v_event.starts_at at time zone 'Asia/Jerusalem')::date)
  );

  return jsonb_build_object(
    'ok', true,
    'event_id', v_event.id,
    'concept_name', v_concept,
    'starts_at', v_event.starts_at,
    'booking_count', v_counts.booking_count,
    'places', private.occupied_places(v_event.id),
    'card_count', v_counts.card_count,
    'choice_count', v_counts.choice_count,
    'unbound_count', v_counts.unbound_count,
    'at_risk', v_at_risk,
    'parked', v_parked,
    'title', private.render_notification_text(v_template.title, v_vars),
    'body', private.render_notification_text(v_template.body, v_vars)
  );
end;
$function$;


-- ==========================================================================
-- bind_purchase: the pinned side counts a completed booking too (3.12).
-- ==========================================================================

-- Based on 20261019233604_waitlist (live definition).
CREATE OR REPLACE FUNCTION private.bind_purchase(p_payment_id uuid, p_customer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_profile_id uuid;
  v_entitlement public.entitlements;
  v_entitlement_new public.entitlements;
  v_payment public.payments;
  v_payment_new public.payments;
  v_booking public.bookings;
  v_booking_new public.bookings;
  v_credit public.cancellation_credits;
  v_credit_new public.cancellation_credits;
  v_refund public.refund_requests;
  v_refund_new public.refund_requests;
  v_event public.events;
begin
  if p_payment_id is null or p_customer_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select p.id into v_profile_id
  from public.profiles p
  where p.id = p_customer_id
    and p.activated_at is not null
    and p.anonymized_at is null
  for update;

  if v_profile_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  perform 1
  from public.bookings b
  where b.payment_id = p_payment_id
  order by b.id
  for update;

  select e.* into v_entitlement
  from public.entitlements e
  where e.payment_id = p_payment_id
  for update;

  perform 1
  from public.cancellation_credits c
  where c.source_entitlement_id = v_entitlement.id
  order by c.id
  for update;

  select pay.* into v_payment
  from public.payments pay
  where pay.id = p_payment_id
  for update;

  perform 1
  from public.refund_requests r
  where r.payment_id = p_payment_id
  order by r.id
  for update;

  if v_payment.id is null or v_entitlement.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if v_payment.customer_id is not null
     or v_entitlement.customer_id is not null
     or exists (
       select 1
       from public.bookings b
       where b.payment_id = p_payment_id
         and b.customer_id is not null
     )
     or exists (
       select 1
       from public.cancellation_credits c
       where c.source_entitlement_id = v_entitlement.id
         and c.customer_id is not null
     )
     or exists (
       select 1
       from public.refund_requests r
       where r.payment_id = p_payment_id
         and r.customer_id is not null
     )
     or exists (
       select 1
       from public.bookings b
       join public.bookings other
         on other.event_id = b.event_id
        and other.customer_id = p_customer_id
        and private.is_real_booking(other.status)
       where b.payment_id = p_payment_id
         and private.is_real_booking(b.status)
     )
     or (
       (
         v_entitlement.kind = 'intro'
         or coalesce((v_entitlement.eligibility_snapshot ->> 'intro_only')::boolean, false)
       )
       and private.intro_blocked(p_customer_id, p_payment_id)
     ) then
    raise exception 'BIND_CONFLICT' using errcode = 'P0001';
  end if;

  update public.payments
  set customer_id = p_customer_id
  where id = v_payment.id
  returning * into v_payment_new;

  perform private.audit(
    p_customer_id, 'customer', 'bind_purchase', 'payments', v_payment.id,
    p_customer_id, null, to_jsonb(v_payment), to_jsonb(v_payment_new)
  );

  update public.entitlements
  set customer_id = p_customer_id, bound_at = now()
  where id = v_entitlement.id
  returning * into v_entitlement_new;

  perform private.audit(
    p_customer_id, 'customer', 'bind_purchase', 'entitlements', v_entitlement.id,
    p_customer_id, v_entitlement.pinned_event_id, to_jsonb(v_entitlement), to_jsonb(v_entitlement_new)
  );

  for v_booking in
    select b.*
    from public.bookings b
    where b.payment_id = p_payment_id
    order by b.id
  loop
    update public.bookings
    set customer_id = p_customer_id
    where id = v_booking.id
    returning * into v_booking_new;

    perform private.audit(
      p_customer_id, 'customer', 'bind_purchase', 'bookings', v_booking.id,
      p_customer_id, v_booking.event_id, to_jsonb(v_booking), to_jsonb(v_booking_new)
    );
  end loop;

  for v_credit in
    select c.*
    from public.cancellation_credits c
    where c.source_entitlement_id = v_entitlement.id
    order by c.id
  loop
    update public.cancellation_credits
    set customer_id = p_customer_id
    where id = v_credit.id
    returning * into v_credit_new;

    perform private.audit(
      p_customer_id, 'customer', 'bind_purchase', 'cancellation_credits', v_credit.id,
      p_customer_id, null, to_jsonb(v_credit), to_jsonb(v_credit_new)
    );
  end loop;

  for v_refund in
    select r.*
    from public.refund_requests r
    where r.payment_id = p_payment_id
    order by r.id
  loop
    update public.refund_requests
    set customer_id = p_customer_id
    where id = v_refund.id
    returning * into v_refund_new;

    perform private.audit(
      p_customer_id, 'customer', 'bind_purchase', 'refund_requests', v_refund.id,
      p_customer_id, null, to_jsonb(v_refund), to_jsonb(v_refund_new)
    );
  end loop;

  -- Story 5.6: a place bound to her in a session she waits for ends her
  -- entry there (booked).
  update public.waitlist_entries w
  set status = 'booked', closed_at = now()
  where w.customer_id = p_customer_id
    and w.status = 'active'
    and w.event_id in (
      select b.event_id
      from public.bookings b
      where b.payment_id = p_payment_id
        and b.status = 'confirmed'
    );

  -- Skipped at approval because there was no customer (AD-23).
  if v_entitlement.kind = 'card' then
    perform private.enqueue_notification(
      p_customer_id, 'purchase_new_card', p_payment_id::text, '{}'::jsonb, '/me'
    );
  end if;

  for v_booking in
    select b.*
    from public.bookings b
    where b.payment_id = p_payment_id
      and b.status = 'confirmed'
    order by b.id
  loop
    perform private.notify_booking_confirmed(v_booking);
  end loop;

  -- A credit made while there was no customer (Tal cancelled the held
  -- place): its options are refreshed for her now (an option she already
  -- booked is replaced, an unfilled one may fill; the owner's path), and
  -- she hears about it: booking_cancelled_pinned for an active credit,
  -- booking_cancelled_refund for a refund request, refund_completed for a
  -- refund Tal already completed (3.9).
  for v_credit in
    select c.*
    from public.cancellation_credits c
    where c.source_entitlement_id = v_entitlement.id
      and c.status in ('active', 'refund_requested', 'refunded')
    order by c.id
  loop
    if v_credit.status = 'active' then
      perform private.refresh_credit_options(v_credit.id);
    end if;

    -- Story 3.9: the refund was completed before she joined.
    if v_credit.status = 'refunded' then
      select r.* into v_refund
      from public.refund_requests r
      where r.credit_id = v_credit.id;

      select e.* into v_event
      from public.events e
      where e.id = (
        select b.event_id
        from public.bookings b
        where b.id = v_refund.booking_id
      );

      perform private.enqueue_notification(
        p_customer_id,
        'refund_completed',
        'bind:' || v_credit.id::text,
        jsonb_build_object(
          'amount', private.format_agorot(v_refund.amount_agorot),
          'date', private.format_day_month(
            (v_event.starts_at at time zone 'Asia/Jerusalem')::date
          )
        ),
        '/me/purchases/' || v_credit.source_entitlement_id::text
      );
      continue;
    end if;

    -- Story 3.8: a business cancel of a held place; she chooses now.
    if v_credit.status = 'active' and v_credit.choice_pending then
      select e.* into v_event
      from public.events e
      where e.id = (
        select b.event_id
        from public.bookings b
        where b.id = private.credit_cancelled_booking(v_credit.id)
      );

      perform private.enqueue_notification(
        p_customer_id,
        'event_cancelled',
        v_event.id::text || ':' || v_event.revision::text,
        jsonb_build_object(
          'date',
          private.format_day_month((v_event.starts_at at time zone 'Asia/Jerusalem')::date)
        ),
        '/me/bookings'
      );
      continue;
    end if;

    perform private.enqueue_notification(
      p_customer_id,
      case when v_credit.status = 'active'
        then 'booking_cancelled_pinned'
        else 'booking_cancelled_refund'
      end,
      'bind:' || v_credit.id::text,
      jsonb_build_object(
        'date',
        private.format_day_month((v_credit.origin_starts_at at time zone 'Asia/Jerusalem')::date)
      ),
      '/me/bookings'
    );
  end loop;
end;
$function$;


-- ==========================================================================
-- Remove personal details: parked purchases, held places, email change, orphan Auth users.
-- ==========================================================================

-- Based on 20261020200750_remove_personal_details (live definition).
CREATE OR REPLACE FUNCTION private.plan_admin_anonymize_customer(p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'blockers', jsonb_build_object(
      'bookings', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'booking_id', b.id,
              'event_id', e.id,
              'starts_at', e.starts_at,
              'concept', c.name
            )
            order by e.starts_at, b.id
          ),
          '[]'::jsonb
        )
        from public.bookings b
        join public.events e on e.id = b.event_id
        join public.concepts c on c.id = e.concept_id
        where (
            b.customer_id = p_customer_id
            -- Story 5.20: a place held for her purchase while its join link
            -- waits for her sign-in (awaiting_login).
            or (
              b.customer_id is null
              and b.payment_id in (
                select t.payment_id
                from public.activation_tokens t
                where t.purpose = 'join'
                  and t.state = 'awaiting_login'
                  and t.bound_user_id = p_customer_id
                  and t.payment_id is not null
              )
            )
          )
          and b.status = 'confirmed'
          and e.starts_at > now()
      ),
      'refund_requests', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object('id', r.id, 'amount_agorot', r.amount_agorot)
            order by r.requested_at, r.id
          ),
          '[]'::jsonb
        )
        from public.refund_requests r
        where r.customer_id = p_customer_id
          and r.status = 'requested'
      ),
      'pending_choices', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object('credit_id', cc.id)
            order by cc.created_at, cc.id
          ),
          '[]'::jsonb
        )
        from public.cancellation_credits cc
        where cc.customer_id = p_customer_id
          and cc.status = 'active'
          and cc.choice_pending
      ),
      -- Story 5.20 (user decision 2026-10-22): a paid pinned purchase with
      -- no place (3.11 'park'), hers or behind one of her join links, not
      -- settled yet (as "paid without a place" in admin_get_attention_items).
      'parked_purchases', (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'entitlement_id', en.id,
              'payment_id', en.payment_id,
              'event_id', ev.id,
              'starts_at', ev.starts_at,
              'concept', c.name
            )
            order by en.created_at, en.id
          ),
          '[]'::jsonb
        )
        from public.entitlements en
        join public.events ev on ev.id = en.pinned_event_id
        join public.concepts c on c.id = ev.concept_id
        where en.status = 'active'
          and en.pinned_event_id is not null
          and (
            en.customer_id = p_customer_id
            or (
              en.customer_id is null
              and en.payment_id in (
                select t.payment_id
                from public.activation_tokens t
                where t.purpose = 'join'
                  and t.payment_id is not null
                  and (
                    t.customer_id = p_customer_id
                    or t.bound_user_id = p_customer_id
                    or t.pending_user_id = p_customer_id
                  )
              )
            )
          )
          and not exists (
            select 1 from public.bookings b where b.payment_id = en.payment_id
          )
      )
    ),
    'forfeits', jsonb_build_object(
      'entries_left', (
        select coalesce(sum(eb.available), 0)::integer
        from public.entitlement_balances eb
        where eb.customer_id = p_customer_id
          and eb.status = 'active'
          and not eb.is_expired
          and eb.available > 0
      ),
      'active_credits', (
        select count(*)::integer
        from public.cancellation_credits cc
        where cc.customer_id = p_customer_id
          and cc.status = 'active'
          and not cc.choice_pending
      )
    )
  );
$function$;

-- Based on 20261020200750_remove_personal_details (live definition).
CREATE OR REPLACE FUNCTION public.preview_admin_anonymize_customer(p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_customer_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if not exists (
       select 1 from public.profiles p
       where p.id = p_customer_id
         and p.anonymized_at is null
     )
     or exists (select 1 from public.admin_roles r where r.user_id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_AVAILABLE' using errcode = 'P0001';
  end if;

  -- Story 5.20: not while her email change is between its steps.
  if exists (
    select 1 from public.profiles p
    where p.id = p_customer_id
      and p.account_op_state = 'email_change_pending'
  ) then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
  end if;

  return private.plan_admin_anonymize_customer(p_customer_id);
end;
$function$;

-- Based on 20261020203837_remove_personal_details_fixes (live definition).
CREATE OR REPLACE FUNCTION public.admin_anonymize_customer(p_customer_id uuid, p_confirmed boolean, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Story 5.20: the Auth users of her claiming links, deleted by the
  -- caller after this call (they never have a profile).
  v_orphans uuid[] := '{}'::uuid[];
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

  -- Story 5.20: not while her email change is between its steps (AD-21).
  if v_profile.account_op_state = 'email_change_pending' then
    raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
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
     or jsonb_array_length(v_blockers -> 'pending_choices') > 0
     or jsonb_array_length(v_blockers -> 'parked_purchases') > 0 then
    raise exception 'ANONYMIZE_BLOCKED' using errcode = 'P0001',
      detail = jsonb_build_object(
        'bookings', jsonb_array_length(v_blockers -> 'bookings'),
        'refund_requests', jsonb_array_length(v_blockers -> 'refund_requests'),
        'pending_choices', jsonb_array_length(v_blockers -> 'pending_choices'),
        'parked_purchases', jsonb_array_length(v_blockers -> 'parked_purchases')
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

    if v_old_token.state = 'claiming'
       and v_old_token.pending_user_id is not null
       and v_old_token.pending_user_id <> p_customer_id then
      v_orphans := v_orphans || v_old_token.pending_user_id;
    end if;

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
    jsonb_build_object(
      'result', 'pending',
      'user_id', p_customer_id,
      'orphan_user_ids', to_jsonb(v_orphans)
    )
  );
end;
$function$;


-- ==========================================================================
-- Customer card, audit and settings.
-- ==========================================================================

-- Based on 20261020200750_remove_personal_details (live definition).
CREATE OR REPLACE FUNCTION public.admin_get_customer(p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile public.profiles;
  v_threshold integer;
  v_today date;
  v_email text;
  v_babies jsonb;
  v_entitlements jsonb;
  v_bookings jsonb;
  v_payments jsonb;
  v_notes jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select p.* into v_profile
  from public.profiles p
  where p.id = p_customer_id
    and not exists (select 1 from public.admin_roles a where a.user_id = p.id);
  if v_profile.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Story 4.6: a removed customer is a tombstone only (her id, when, and
  -- whether the Auth step is still pending); nothing else is read.
  if v_profile.anonymized_at is not null then
    return jsonb_build_object(
      'profile', jsonb_build_object(
        'id', v_profile.id,
        'anonymized_at', v_profile.anonymized_at,
        'removal_pending',
          coalesce(v_profile.account_op_state = 'anonymization_pending', false)
      )
    );
  end if;

  select u.email into v_email from auth.users u where u.id = v_profile.id;
  select s.admin_expiring_days into v_threshold from public.business_settings s;
  v_today := (now() at time zone 'Asia/Jerusalem')::date;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('name', b.name, 'birth_date', b.birth_date)
      order by b.birth_date, b.id
    ),
    '[]'::jsonb
  )
  into v_babies
  from public.babies b
  where b.customer_id = v_profile.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'entitlement_id', x.entitlement_id,
        'kind', x.kind,
        'status', x.status,
        'product_name', x.product_name,
        'original_units', x.original_units,
        'available', x.available,
        'reserved', x.reserved,
        'used', x.used,
        'expires_on', x.expires_on,
        'is_expired', x.is_expired,
        'days_left', x.days_left,
        'is_expiring', x.status = 'active'
          and not x.is_expired
          and x.available > 0
          and x.days_left <= coalesce(v_threshold, 0),
        'is_used_up', x.status = 'active'
          and x.available = 0
          and x.reserved = 0
          and not x.is_expired,
        'pinned_event_id', x.pinned_event_id,
        'is_extended', x.is_extended,
        'entries', x.entries
      )
      order by x.expires_on, x.entitlement_id
    ),
    '[]'::jsonb
  )
  into v_entitlements
  from (
    select
      b.entitlement_id,
      b.kind,
      b.status,
      b.original_units,
      b.available,
      b.reserved,
      b.used,
      b.expires_on,
      b.is_expired,
      b.expires_on - v_today as days_left,
      e.pinned_event_id,
      private.entitlement_is_extended(b.entitlement_id, b.expires_on) as is_extended,
      p.product_snapshot ->> 'name' as product_name,
      (
        select coalesce(
          jsonb_agg(
            jsonb_build_object(
              'status', bk.status,
              'starts_at', ev.starts_at,
              'concept_name', c.name,
              'event_id', ev.id
            )
            order by ev.starts_at, bk.id, u.n
          ),
          '[]'::jsonb
        )
        from public.booking_allocations a
        join public.bookings bk on bk.id = a.booking_id
        join public.events ev on ev.id = bk.event_id
        join public.concepts c on c.id = ev.concept_id
        cross join lateral generate_series(1, a.units) as u(n)
        where a.entitlement_id = b.entitlement_id
          and bk.status <> 'cancelled'
      ) as entries
    from public.entitlement_balances b
    join public.entitlements e on e.id = b.entitlement_id
    join public.payments p on p.id = b.payment_id
    where b.customer_id = v_profile.id
  ) x;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'booking_id', b.id,
        'event_id', b.event_id,
        'concept_name', c.name,
        'starts_at', e.starts_at,
        'status', b.status,
        'party_size', b.party_size,
        'created_at', b.created_at,
        'credit_id', cr.credit_id,
        -- Story 5.20: the session a moved booking went to (as get_my_bookings).
        'moved_to_starts_at', me.starts_at
      )
      order by e.starts_at desc, b.created_at desc, b.id
    ),
    '[]'::jsonb
  )
  into v_bookings
  from public.bookings b
  join public.events e on e.id = b.event_id
  join public.concepts c on c.id = e.concept_id
  left join lateral (
    select x.credit_id
    from (
      select cc.id as credit_id, 0 as priority
      from public.cancellation_credits cc
      where cc.origin_booking_id = b.id
      union all
      select a.credit_id, 1 as priority
      from public.booking_allocations a
      where a.booking_id = b.id
        and a.credit_id is not null
    ) x
    order by x.priority, x.credit_id
    limit 1
  ) cr on true
  left join public.bookings mb on mb.id = b.moved_to_booking_id
  left join public.events me on me.id = mb.event_id
  where b.customer_id = v_profile.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'payment_id', p.id,
        'product_name', p.product_snapshot ->> 'name',
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on,
        'payment_method_name', p.product_snapshot ->> 'payment_method_name',
        'status', p.status
      )
      order by p.paid_on desc, p.created_at desc, p.id
    ),
    '[]'::jsonb
  )
  into v_payments
  from public.payments p
  where p.customer_id = v_profile.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', n.id, 'body', n.body, 'created_at', n.created_at)
      order by n.created_at desc, n.id
    ),
    '[]'::jsonb
  )
  into v_notes
  from public.customer_notes n
  where n.customer_id = v_profile.id;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'full_name', v_profile.full_name,
      'phone_e164', v_profile.phone_e164,
      'email', v_email,
      'activated_at', v_profile.activated_at,
      'created_at', v_profile.created_at,
      'dietary_notes', v_profile.dietary_notes,
      'photo_consent', v_profile.photo_consent,
      'photo_consent_at', v_profile.photo_consent_at,
      'personal_photo_consent', v_profile.personal_photo_consent,
      'personal_photo_consent_at', v_profile.personal_photo_consent_at,
      'last_activity_on', private.customer_last_activity_on(v_profile.id)
    ),
    'babies', v_babies,
    'entitlements', v_entitlements,
    'bookings', v_bookings,
    'payments', v_payments,
    'notes', v_notes
  );
end;
$function$;

-- Based on 20261018220349_audit_concise (live definition).
CREATE OR REPLACE FUNCTION public.admin_list_audit(p_shown text[], p_event_id uuid DEFAULT NULL::uuid, p_customer_id uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit constant integer := 50;
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  -- The whitelist: "{action}/{entity_type}" or "{action}/{entity_type}/insert".
  if p_shown is null
     or cardinality(p_shown) = 0
     or exists (
       select 1 from unnest(p_shown) as s
       where s is null or s !~ '^[a-z_]+/[a-z_]+(/insert)?$'
     ) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'shown')::text;
  end if;

  if p_from is not null and p_to is not null then
    if p_from > p_to then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', 'to')::text;
    end if;
    -- Both ends are included: over 366 days is refused.
    if p_to - p_from + 1 > 366 then
      raise exception 'INVALID_INPUT' using errcode = 'P0001',
        detail = jsonb_build_object('field', 'from')::text;
    end if;
  end if;

  -- The cursor is the last main row of the previous page: both parts or none.
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = jsonb_build_object('field', 'cursor')::text;
  end if;

  with shown as (
    select
      split_part(s, '/', 1) as action,
      split_part(s, '/', 2) as entity_type,
      split_part(s, '/', 3) = 'insert' as insert_only
    from unnest(p_shown) as s
  ),
  -- Every row in the date range, with its derived customer and whether it
  -- is a main row (its pair is shown; an insert-only pair needs a created
  -- row: private.audit stores an empty before for it).
  scoped as (
    select
      a.id,
      a.created_at,
      a.actor_id,
      a.actor_kind,
      a.action,
      a.entity_type,
      a.entity_id,
      a.event_id,
      a.before,
      a.after,
      a.reason,
      coalesce(
        a.customer_id,
        case a.entity_type
          when 'profiles' then a.entity_id
          when 'payments' then (
            select pay.customer_id from public.payments pay
            where pay.id = a.entity_id
          )
          when 'activation_tokens' then (
            select t.customer_id from public.activation_tokens t
            where t.id = a.entity_id
          )
          when 'bookings' then (
            select b.customer_id from public.bookings b
            where b.id = a.entity_id
          )
          -- Filled later by bind_purchase.
          when 'entitlements' then (
            select en.customer_id from public.entitlements en
            where en.id = a.entity_id
          )
          when 'cancellation_credits' then (
            select cc.customer_id from public.cancellation_credits cc
            where cc.id = a.entity_id
          )
          when 'refund_requests' then (
            select rr.customer_id from public.refund_requests rr
            where rr.id = a.entity_id
          )
        end,
        private.audit_json_uuid(a.after, 'customer_id'),
        private.audit_json_uuid(a.before, 'customer_id')
      ) as customer_id,
      exists (
        select 1
        from shown s
        where s.action = a.action
          and s.entity_type = a.entity_type
          and (
            not s.insert_only
            or (
              coalesce(a.before, '{}'::jsonb) = '{}'::jsonb
              and coalesce(a.after, '{}'::jsonb) <> '{}'::jsonb
            )
          )
      ) as is_primary
    from public.audit_log a
    where (p_from is null or a.created_at >= private.local_day_end(p_from - 1))
      and (p_to is null or a.created_at < private.local_day_end(p_to))
  ),
  primaries as (
    select p.*
    from scoped p
    where p.is_primary
      and (
        p_before_created_at is null
        or (p.created_at, p.id) < (p_before_created_at, p_before_id)
      )
  ),
  -- The other rows of each main row's operation. A row with no visible
  -- change (empty, or only dropped keys such as moved_to_booking_id) is
  -- noise and is left out.
  links as (
    select p.id as primary_id, r.*
    from primaries p
    join scoped r
      on r.created_at = p.created_at
     and r.action = p.action
     and r.actor_id is not distinct from p.actor_id
     and r.id <> p.id
     and not r.is_primary
     and (
       p.customer_id is null
       or r.customer_id is null
       or r.customer_id = p.customer_id
     )
     and private.audit_changes(r.before, r.after) <> '[]'::jsonb
  ),
  -- Each operation's sessions and customers from its related rows, once.
  link_keys as (
    select
      l.primary_id,
      array_agg(l.event_id) filter (where l.event_id is not null) as event_ids,
      array_agg(l.customer_id) filter (where l.customer_id is not null)
        as customer_ids
    from links l
    group by l.primary_id
  ),
  page as (
    select p.*
    from primaries p
    left join link_keys k on k.primary_id = p.id
    where (
        p_event_id is null
        or p.event_id = p_event_id
        or coalesce(p_event_id = any (k.event_ids), false)
      )
      and (
        p_customer_id is null
        or p.customer_id = p_customer_id
        or coalesce(p_customer_id = any (k.customer_ids), false)
      )
    order by p.created_at desc, p.id desc
    limit v_limit + 1
  ),
  -- The related rows of the page only.
  page_links as (
    select l.*
    from links l
    join page pg on pg.id = l.primary_id
  ),
  numbered as (
    select
      p.*,
      row_number() over (order by p.created_at desc, p.id desc) as rn
    from page p
  )
  select jsonb_build_object(
    'rows', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'created_at', n.created_at,
          'actor_kind', n.actor_kind,
          'action', n.action,
          'entity_type', n.entity_type,
          'customer', case
            when n.customer_id is null then null
            else jsonb_build_object(
              'id', n.customer_id,
              'name', (
                select case when pr.anonymized_at is null then pr.full_name end
                from public.profiles pr
                where pr.id = n.customer_id
              )
            )
          end,
          'event', private.audit_event_label(n.event_id),
          -- What the row is about when it is not a customer or a session:
          -- a product's or concept's name (a deleted concept: its name in
          -- before), a content section's "{page}/{key}", a template's type.
          'subject', case n.entity_type
            when 'products' then (
              select pd.name from public.products pd where pd.id = n.entity_id
            )
            when 'concepts' then coalesce(
              (select c.name from public.concepts c where c.id = n.entity_id),
              n.before ->> 'name',
              n.after ->> 'name'
            )
            when 'content_sections' then (
              select cs.page_slug || '/' || cs.key
              from public.content_sections cs
              where cs.id = n.entity_id
            )
            when 'notification_templates' then
              coalesce(n.after ->> 'type', n.before ->> 'type')
            -- Story 5.20: the text itself (TS shortens it).
            when 'marketing_reminder_texts' then coalesce(
              (select m.body from public.marketing_reminder_texts m where m.id = n.entity_id),
              n.after ->> 'body',
              n.before ->> 'body'
            )
          end,
          -- A refund request's current amount: a full refund leaves it
          -- unchanged, so it is not in the row's changes.
          'amount_agorot', case n.entity_type
            when 'refund_requests' then (
              select rr.amount_agorot from public.refund_requests rr
              where rr.id = n.entity_id
            )
          end,
          -- How a booking was paid ('card', 'credit' or 'pinned', from
          -- private.booking_funding), read now: cancelling a credit-paid
          -- booking returns the credit without an audit row of its own.
          'funding', case n.entity_type
            when 'bookings' then private.booking_funding(n.entity_id) ->> 'funding'
          end,
          'changes', private.audit_changes(n.before, n.after),
          'related', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'entity_type', l.entity_type,
                  'changes', private.audit_changes(l.before, l.after),
                  'event', private.audit_event_label(l.event_id)
                )
                order by l.entity_type, l.id
              )
              from page_links l
              where l.primary_id = n.id
            ),
            '[]'::jsonb
          ),
          'reason', n.reason
        )
        order by n.rn
      ) filter (where n.rn <= v_limit),
      '[]'::jsonb
    ),
    'has_more', coalesce(max(n.rn) > v_limit, false)
  )
  into v_result
  from numbered n;

  return v_result;
end;
$function$;

-- Based on 20261020194721_marketing_reminders (live definition).
CREATE OR REPLACE FUNCTION public.admin_update_business_settings(p_changes jsonb, p_expected_version integer, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'duplicate_payment_window_days', 'credit_expiring_days'
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
        when 'credit_expiring_days' then v_int between 1 and 30
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
        when 'credit_expiring_days' then v_row.credit_expiring_days := v_int;
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
        credit_expiring_days = v_row.credit_expiring_days,
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
$function$;


-- ==========================================================================
-- Push: known push services only.
-- ==========================================================================

-- Based on 20261006184326_push_pipeline (live definition).
CREATE OR REPLACE FUNCTION public.register_push_subscription(p_endpoint text, p_keys jsonb, p_platform text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_p256dh text;
  v_auth text;
begin
  if v_user is null
     or ((select private.current_customer_id()) is null
         and not (select private.is_admin())) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  -- Story 5.20: only an endpoint of a known push service.
  if p_endpoint is null
     or not private.push_endpoint_allowed(p_endpoint) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "endpoint"}';
  end if;

  if p_keys is null
     or jsonb_typeof(p_keys) <> 'object'
     or jsonb_typeof(p_keys -> 'p256dh') is distinct from 'string'
     or jsonb_typeof(p_keys -> 'auth') is distinct from 'string' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "keys"}';
  end if;

  v_p256dh := p_keys ->> 'p256dh';
  v_auth := p_keys ->> 'auth';
  if v_p256dh !~ '^[A-Za-z0-9_-]+={0,2}$' or char_length(v_p256dh) > 200
     or v_auth !~ '^[A-Za-z0-9_-]+={0,2}$' or char_length(v_auth) > 100 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "keys"}';
  end if;

  if p_platform is null
     or p_platform not in ('ios', 'android', 'desktop', 'other') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "platform"}';
  end if;

  -- A browser that moved between accounts belongs to the current one only.
  delete from public.push_subscriptions s
  where s.endpoint = p_endpoint
    and s.user_id <> v_user;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, platform)
  values (v_user, p_endpoint, v_p256dh, v_auth, p_platform)
  on conflict (endpoint) do update
  set user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      platform = excluded.platform,
      last_seen_at = now();

  return jsonb_build_object('registered', true);
end;
$function$;


-- ==========================================================================
-- The broadcast template and type (CAP-32 has no screen; 0 rows use it).
-- The check is re-created from its live definition without 'broadcast'.
-- ==========================================================================

delete from public.notification_templates where type = 'broadcast';

alter table public.notification_templates
  drop constraint notification_templates_type_check;

alter table public.notification_templates
  add constraint notification_templates_type_check check (
    type = any (array[
      'purchase_new_card', 'purchase_repeat', 'booking_confirmed',
      'booking_confirmed_couple', 'booking_moved', 'reminder', 'waitlist_spot',
      'booking_cancelled', 'booking_cancelled_pinned', 'booking_cancelled_refund',
      'refund_completed', 'credit_expiring', 'credit_options_changed',
      'credit_refund_requested', 'event_changed', 'event_cancelled',
      'entitlement_changed', 'entitlement_units_changed',
      'entitlement_terms_changed', 'entitlement_auto_extended', 'card_expiring',
      'admin_card_expiring', 'marketing_reminder'
    ]::text[])
  );

-- ==========================================================================
-- Grants and policies.
-- ==========================================================================

-- events.capacity_adults only through admin RPCs (admin_get_event_details,
-- admin_list_session_occupancy): a column grant of every other column.
revoke select on public.events from anon, authenticated;
revoke select (capacity_adults) on public.events from anon, authenticated;
grant select (
  id, concept_id, kind, description, starts_at, ends_at,
  registration_closes_at, registration_close_overridden, status, revision,
  waitlist_cycle, display_price_agorot, created_at, image_id
) on public.events to anon, authenticated;

-- waitlist_entries: written only by definer RPCs; the service role does not
-- touch it. One SELECT policy for the admin and the customer.
revoke all on public.waitlist_entries from service_role;

drop policy waitlist_entries_admin_select on public.waitlist_entries;
drop policy waitlist_entries_customer_select on public.waitlist_entries;

create policy waitlist_entries_select on public.waitlist_entries
  for select to authenticated
  using (
    (select private.is_admin())
    or customer_id = (select private.current_customer_id())
  );

-- Grants (AD-5): every function above, again explicit.
revoke execute on function public.admin_add_note(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_note(text, uuid) to authenticated;
revoke execute on function public.admin_add_prep_day(uuid, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_prep_day(uuid, integer, uuid) to authenticated;
revoke execute on function public.admin_add_shopping_items(uuid, text[], uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_shopping_items(uuid, text[], uuid) to authenticated;
revoke execute on function public.admin_add_work_dish(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_work_dish(uuid, text, uuid) to authenticated;
revoke execute on function public.admin_add_work_task(uuid, integer, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_add_work_task(uuid, integer, text, uuid) to authenticated;
revoke execute on function public.admin_anonymize_customer(uuid, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_anonymize_customer(uuid, boolean, uuid) to authenticated;
revoke execute on function public.admin_approve_payment(uuid, text, uuid, uuid, integer, text, date, uuid, text, text, boolean, boolean, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_approve_payment(uuid, text, uuid, uuid, integer, text, date, uuid, text, text, boolean, boolean, uuid) to authenticated;
revoke execute on function public.admin_begin_email_change(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_begin_email_change(uuid, text, uuid) to authenticated;
revoke execute on function public.admin_begin_media_publish(uuid, text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_begin_media_publish(uuid, text, integer, integer) to authenticated;
revoke execute on function public.admin_create_media(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_create_media(uuid) to authenticated;
revoke execute on function public.admin_delete_note(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_note(uuid, uuid) to authenticated;
revoke execute on function public.admin_delete_shopping_item(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_shopping_item(uuid, uuid) to authenticated;
revoke execute on function public.admin_delete_work_dish(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_work_dish(uuid, uuid) to authenticated;
revoke execute on function public.admin_delete_work_task(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_delete_work_task(uuid, uuid) to authenticated;
revoke execute on function public.admin_duplicate_event(uuid, date, time without time zone, time without time zone, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_duplicate_event(uuid, date, time without time zone, time without time zone, uuid) to authenticated;
revoke execute on function public.admin_finish_anonymize_customer(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_finish_anonymize_customer(uuid, uuid) to authenticated;
revoke execute on function public.admin_finish_media_publish(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_finish_media_publish(uuid) to authenticated;
revoke execute on function public.admin_get_customer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_customer(uuid) to authenticated;
revoke execute on function public.admin_list_audit(text[], uuid, uuid, date, date, timestamp with time zone, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_audit(text[], uuid, uuid, date, date, timestamp with time zone, uuid) to authenticated;
revoke execute on function public.admin_list_session_occupancy(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_session_occupancy(uuid[]) to authenticated;
revoke execute on function public.admin_move_prep_day(uuid, integer, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_move_prep_day(uuid, integer, integer, uuid) to authenticated;
revoke execute on function public.admin_remove_prep_day(uuid, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_remove_prep_day(uuid, integer, uuid) to authenticated;
revoke execute on function public.admin_set_concept_image(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_concept_image(uuid, uuid) to authenticated;
revoke execute on function public.admin_set_content_draft(text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_content_draft(text, text, jsonb) to authenticated;
revoke execute on function public.admin_set_event_image(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_event_image(uuid, uuid) to authenticated;
revoke execute on function public.admin_set_note_archived(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_note_archived(uuid, boolean) to authenticated;
revoke execute on function public.admin_set_note_done(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_note_done(uuid, boolean) to authenticated;
revoke execute on function public.admin_set_note_order(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_note_order(uuid[]) to authenticated;
revoke execute on function public.admin_set_note_pinned(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_note_pinned(uuid, boolean) to authenticated;
revoke execute on function public.admin_set_shopping_item_bought(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_shopping_item_bought(uuid, boolean) to authenticated;
revoke execute on function public.admin_set_shopping_item_order(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_shopping_item_order(uuid[]) to authenticated;
revoke execute on function public.admin_set_work_dish_order(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_work_dish_order(uuid[]) to authenticated;
revoke execute on function public.admin_set_work_task_done(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_work_task_done(uuid, boolean) to authenticated;
revoke execute on function public.admin_set_work_task_order(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_work_task_order(uuid[]) to authenticated;
revoke execute on function public.admin_update_business_settings(jsonb, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_business_settings(jsonb, integer, uuid) to authenticated;
revoke execute on function public.admin_update_event(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_event(uuid, jsonb, uuid) to authenticated;
revoke execute on function public.admin_update_note(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_note(uuid, text, uuid) to authenticated;
revoke execute on function public.admin_update_product(uuid, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_product(uuid, jsonb, uuid) to authenticated;
revoke execute on function public.admin_update_shopping_item(uuid, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_shopping_item(uuid, text, text, uuid) to authenticated;
revoke execute on function public.admin_update_work_dish(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_work_dish(uuid, text, uuid) to authenticated;
revoke execute on function public.admin_update_work_task(uuid, text, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_work_task(uuid, text, integer, uuid) to authenticated;
revoke execute on function public.claim_join(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.claim_join(text, uuid) to authenticated;
revoke execute on function public.join_begin(text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.join_begin(text, text, text, uuid) to service_role;
revoke execute on function public.join_complete(text, jsonb, uuid) from public, anon, authenticated, service_role;
grant execute on function public.join_complete(text, jsonb, uuid) to service_role;
revoke execute on function public.preview_admin_anonymize_customer(uuid) from public, anon, authenticated, service_role;
grant execute on function public.preview_admin_anonymize_customer(uuid) to authenticated;
revoke execute on function public.register_push_subscription(text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.register_push_subscription(text, jsonb, text) to authenticated;
revoke execute on function public.set_booking_guest_details(uuid, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.set_booking_guest_details(uuid, text, uuid) to authenticated;
