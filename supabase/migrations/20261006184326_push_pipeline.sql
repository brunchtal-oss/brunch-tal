-- Story 5.8: the push pipeline (AD-11, AD-12, AD-22). Source §8, CAP-21/22/35.
-- 1. push_subscriptions (one row per browser endpoint, owned by an Auth
--    user, customer or admin) and notification_deliveries (which
--    subscription already got which job, so a retry never sends twice).
--    Both internal: RLS without policy, no grant to any API role; written
--    only by the RPCs below.
-- 2. notification_jobs: new status 'skipped' (no subscription, or the
--    notification is more than 24 hours old: user decision 2026-10-06), so
--    the status and finished checks are replaced; an index for the worker.
-- 3. register_push_subscription / unregister_push_subscription
--    (authenticated; AD-5 idempotency exemption: the same call twice leaves
--    the same row) and claim_push_jobs / finish_push_job (service_role
--    only, the worker in lib/server/privileged/push-worker.ts).
-- 4. pg_net + Vault: private.job_invoke_push_worker, every minute through
--    pg_cron, POSTs to <app_url>/api/jobs/push with Bearer <cron_secret>
--    only when a job is ready. Without both Vault values it does nothing.
--    No Vault value, VAPID key or secret is written here.
-- 5. admin_get_attention_items(): the body of 20261006110524 with every
--    branch unchanged, plus push_failed (failed jobs of the last 7 days).

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- push_subscriptions
-- ---------------------------------------------------------------------------

-- user_id = the Auth user (profiles.id or admin_roles.user_id). Deleting the
-- user deletes her subscriptions. endpoint is unique: one browser belongs to
-- one account at a time (register moves it).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique
    check (endpoint ~ '^https://[^[:space:]]+$' and char_length(endpoint) <= 1000),
  p256dh text not null
    check (p256dh ~ '^[A-Za-z0-9_-]+={0,2}$' and char_length(p256dh) <= 200),
  auth text not null
    check (auth ~ '^[A-Za-z0-9_-]+={0,2}$' and char_length(auth) <= 100),
  platform text not null check (platform in ('ios', 'android', 'desktop', 'other')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create index push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- notification_deliveries
-- ---------------------------------------------------------------------------

create table public.notification_deliveries (
  job_id uuid not null
    references public.notification_jobs (id) on delete cascade,
  subscription_id uuid not null
    references public.push_subscriptions (id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (job_id, subscription_id)
);

alter table public.notification_deliveries enable row level security;

-- The cascade from push_subscriptions.
create index notification_deliveries_subscription_id_idx
  on public.notification_deliveries (subscription_id);

-- ---------------------------------------------------------------------------
-- notification_jobs: 'skipped'
-- ---------------------------------------------------------------------------

alter table public.notification_jobs
  drop constraint notification_jobs_status_check;
alter table public.notification_jobs
  add constraint notification_jobs_status_check
  check (status in ('queued', 'sending', 'sent', 'failed', 'skipped'));

alter table public.notification_jobs
  drop constraint notification_jobs_finished_check;
alter table public.notification_jobs
  add constraint notification_jobs_finished_check
  check ((status in ('sent', 'failed', 'skipped')) = (finished_at is not null));

create index notification_jobs_status_next_attempt_idx
  on public.notification_jobs (status, next_attempt_at);

-- ---------------------------------------------------------------------------
-- Subscriptions: register / unregister (the browser, through a Server Action)
-- ---------------------------------------------------------------------------

-- The caller's browser subscription: removed from any other user, then
-- inserted or refreshed for her (keys, platform, last_seen_at). An active
-- customer or an admin only. Returns {"registered": true}.
create function public.register_push_subscription(
  p_endpoint text,
  p_keys jsonb,
  p_platform text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
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

  if p_endpoint is null
     or p_endpoint !~ '^https://[^[:space:]]+$'
     or char_length(p_endpoint) > 1000 then
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
$$;

-- Removes the caller's subscription of this endpoint (sign-out). Someone
-- else's endpoint is left alone. Returns {"removed": <rows deleted>}.
create function public.unregister_push_subscription(p_endpoint text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_removed integer;
begin
  if v_user is null
     or ((select private.current_customer_id()) is null
         and not (select private.is_admin())) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_endpoint is null or char_length(p_endpoint) > 1000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "endpoint"}';
  end if;

  delete from public.push_subscriptions s
  where s.endpoint = p_endpoint
    and s.user_id = v_user;

  get diagnostics v_removed = row_count;

  return jsonb_build_object('removed', v_removed);
end;
$$;

-- ---------------------------------------------------------------------------
-- The worker: claim / finish (service_role only)
-- ---------------------------------------------------------------------------

-- Takes up to p_limit ready jobs: queued with next_attempt_at <= now(), or
-- sending whose lease has passed (a worker that died). for update skip
-- locked, so two workers never take the same job. Each job taken becomes
-- sending with a 2-minute lease and one more attempt. A job is closed here
-- instead of returned:
--   * its notification is more than 24 hours old -> skipped (the
--     notification stays in the center; user decision 2026-10-06);
--   * a lease passed after the 5th attempt -> failed (LEASE_EXPIRED);
--   * no subscription of the recipient is left without a delivery ->
--     sent when some subscription already got it, else skipped.
-- Returns [{job_id, title, body, target_path, subscriptions: [{id,
-- endpoint, p256dh, auth}]}], only subscriptions without a delivery.
create function public.claim_push_jobs(p_limit integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job record;
  v_subs jsonb;
  v_out jsonb := '[]'::jsonb;
  v_count integer := 0;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "limit"}';
  end if;

  for v_job in
    select
      j.id,
      j.status,
      j.attempt_count,
      n.recipient_id,
      n.created_at as notified_at,
      n.payload,
      n.target_path
    from public.notification_jobs j
    join public.notifications n on n.id = j.notification_id
    where (j.status = 'queued' and j.next_attempt_at <= now())
       or (j.status = 'sending' and j.lease_until < now())
    order by j.next_attempt_at, j.id
    for update of j skip locked
  loop
    exit when v_count >= p_limit;

    if v_job.notified_at < now() - interval '24 hours' then
      update public.notification_jobs
      set status = 'skipped', lease_until = null, finished_at = now()
      where id = v_job.id;
      continue;
    end if;

    if v_job.status = 'sending' and v_job.attempt_count >= 5 then
      update public.notification_jobs
      set status = 'failed', lease_until = null, finished_at = now(),
          last_error = 'LEASE_EXPIRED'
      where id = v_job.id;
      continue;
    end if;

    select jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'endpoint', s.endpoint,
        'p256dh', s.p256dh,
        'auth', s.auth
      )
      order by s.id
    )
    into v_subs
    from public.push_subscriptions s
    where s.user_id = v_job.recipient_id
      and not exists (
        select 1
        from public.notification_deliveries d
        where d.job_id = v_job.id
          and d.subscription_id = s.id
      );

    if v_subs is null then
      update public.notification_jobs
      set status = case
            when exists (
              select 1 from public.notification_deliveries d where d.job_id = v_job.id
            ) then 'sent'
            else 'skipped'
          end,
          lease_until = null,
          finished_at = now()
      where id = v_job.id;
      continue;
    end if;

    update public.notification_jobs
    set status = 'sending',
        lease_until = now() + interval '2 minutes',
        attempt_count = attempt_count + 1
    where id = v_job.id;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'job_id', v_job.id,
      'title', v_job.payload ->> 'title',
      'body', v_job.payload ->> 'body',
      'target_path', v_job.target_path,
      'subscriptions', v_subs
    ));
    v_count := v_count + 1;
  end loop;

  return v_out;
end;
$$;

-- Closes one attempt of a job the worker took: records the deliveries
-- (on conflict do nothing), deletes the gone subscriptions (404/410; only
-- the recipient's own), then: no error -> sent; an error before the 5th
-- attempt -> queued again after 1/5/15/60 minutes; else failed. p_error is
-- a code or HTTP status only, cut to 200 characters. A job that is no
-- longer sending (its lease passed and it was closed) keeps its status.
-- Returns {"status": <the job's status>}.
create function public.finish_push_job(
  p_job_id uuid,
  p_delivered uuid[],
  p_gone uuid[],
  p_error text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.notification_jobs;
  v_recipient uuid;
  v_error text := nullif(left(btrim(coalesce(p_error, '')), 200), '');
  v_status text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_job_id is null
     or cardinality(coalesce(p_delivered, '{}')) > 1000
     or cardinality(coalesce(p_gone, '{}')) > 1000 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  select j.* into v_job
  from public.notification_jobs j
  where j.id = p_job_id
  for update;

  if v_job.id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001',
      detail = '{"field": "job_id"}';
  end if;

  select n.recipient_id into v_recipient
  from public.notifications n
  where n.id = v_job.notification_id;

  insert into public.notification_deliveries (job_id, subscription_id)
  select v_job.id, s.id
  from public.push_subscriptions s
  where s.id = any(coalesce(p_delivered, '{}'))
    and s.user_id = v_recipient
  on conflict do nothing;

  delete from public.push_subscriptions s
  where s.id = any(coalesce(p_gone, '{}'))
    and s.user_id = v_recipient;

  if v_job.status <> 'sending' then
    return jsonb_build_object('status', v_job.status);
  end if;

  if v_error is null then
    v_status := 'sent';
    update public.notification_jobs
    set status = 'sent', lease_until = null, finished_at = now(), last_error = null
    where id = v_job.id;
  elsif v_job.attempt_count < 5 then
    v_status := 'queued';
    update public.notification_jobs
    set status = 'queued',
        lease_until = null,
        next_attempt_at = now()
          + make_interval(mins => (array[1, 5, 15, 60])[greatest(v_job.attempt_count, 1)]),
        last_error = v_error
    where id = v_job.id;
  else
    v_status := 'failed';
    update public.notification_jobs
    set status = 'failed', lease_until = null, finished_at = now(), last_error = v_error
    where id = v_job.id;
  end if;

  return jsonb_build_object('status', v_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Waking the worker: pg_net + Vault (AD-11)
-- ---------------------------------------------------------------------------

-- POSTs to <app_url>/api/jobs/push with Bearer <cron_secret> (Vault). Either
-- value missing or empty: nothing, returns null. Returns the pg_net request
-- id otherwise. The response is never read here.
create function private.invoke_push_worker()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select rtrim(btrim(s.decrypted_secret), '/') into v_url
  from vault.decrypted_secrets s
  where s.name = 'app_url';

  select btrim(s.decrypted_secret) into v_secret
  from vault.decrypted_secrets s
  where s.name = 'cron_secret';

  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return null;
  end if;

  return net.http_post(
    url := v_url || '/api/jobs/push',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    timeout_milliseconds := 10000
  );
end;
$$;

-- Every minute (pg_cron): wakes the worker only when a job is ready (queued
-- and due, or a passed lease), so Vercel is not called 1,440 times a day for
-- nothing. Safe to run twice. Called only by pg_cron (as the owner); no
-- grant.
create function private.job_invoke_push_worker()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.notification_jobs j
    where (j.status = 'queued' and j.next_attempt_at <= now())
       or (j.status = 'sending' and j.lease_until < now())
  ) then
    return null;
  end if;

  return private.invoke_push_worker();
end;
$$;

-- ---------------------------------------------------------------------------
-- "To handle": push_failed
-- ---------------------------------------------------------------------------

-- "To handle" (stories 4.1, 5.5, 5.8). Result: as in 20261006110524, plus
--   push_failed id = 'push_failed', count = failed jobs of the last 7 days,
--   since = the latest of them. Disappears when there is none in the week.
create or replace function public.admin_get_attention_items()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  with
  join_links as (
    select t.*, private.join_link_status(t) as link_status
    from public.activation_tokens t
    where t.purpose = 'join'
  ),
  pay as (
    select
      p.id,
      p.customer_id,
      p.status,
      p.amount_agorot,
      p.paid_on,
      p.created_at,
      p.product_snapshot ->> 'name' as product_name,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label
    from public.payments p
    left join public.profiles pr on pr.id = p.customer_id
  ),
  items as (
    -- A link stopped in a conflict (any reason, bind_conflict too).
    select
      coalesce(l.claiming_at, l.created_at) as since,
      l.id,
      jsonb_build_object(
        'kind', 'link_conflict',
        'id', l.id,
        'customer_label', p.customer_label,
        'since', coalesce(l.claiming_at, l.created_at),
        'payment_id', p.id,
        'conflict_reason', l.conflict_reason,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      ) as item
    from join_links l
    join pay p on p.id = l.payment_id
    where l.link_status = 'conflict'

    union all

    -- A join stuck in claiming for more than 15 minutes.
    select
      l.claiming_at,
      l.id,
      jsonb_build_object(
        'kind', 'link_stuck',
        'id', l.id,
        'customer_label', p.customer_label,
        'since', l.claiming_at,
        'payment_id', p.id,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      )
    from join_links l
    join pay p on p.id = l.payment_id
    where l.link_status = 'stuck'

    union all

    -- An approved purchase not bound to a customer whose links were all
    -- revoked or expired (or that has none): no live link, no conflict.
    select
      w.since,
      p.id,
      jsonb_build_object(
        'kind', 'purchase_without_link',
        'id', p.id,
        'customer_label', p.customer_label,
        'since', w.since,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      )
    from pay p
    cross join lateral (
      select coalesce(
        max(case when l.link_status = 'revoked' then l.revoked_at else l.expires_at end),
        p.created_at
      ) as since
      from join_links l
      where l.payment_id = p.id
    ) w
    where p.status = 'approved'
      and p.customer_id is null
      and not exists (
        select 1
        from join_links l
        where l.payment_id = p.id
          and l.link_status not in ('revoked', 'expired')
      )

    union all

    -- Paid without a place (3.11 'park'): an active pinned entitlement with
    -- no booking on its payment.
    select
      e.created_at,
      e.id,
      jsonb_build_object(
        'kind', 'paid_without_place',
        'id', e.id,
        'customer_label', p.customer_label,
        'since', e.created_at,
        'payment_id', p.id,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.entitlements e
    join pay p on p.id = e.payment_id
    join public.events ev on ev.id = e.pinned_event_id
    join public.concepts c on c.id = ev.concept_id
    where e.status = 'active'
      and e.pinned_event_id is not null
      and not exists (
        select 1 from public.bookings b where b.payment_id = e.payment_id
      )

    union all

    -- A pinned booking without a customer still holding a place after its
    -- join ended in bind_conflict, while the session has not ended. Released
    -- on the session page (admin_cancel_booking, 3.6).
    select
      s.since,
      b.id,
      jsonb_build_object(
        'kind', 'pinned_seat_held',
        'id', b.id,
        'customer_label', p.customer_label,
        'since', s.since,
        'payment_id', p.id,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.bookings b
    join pay p on p.id = b.payment_id
    join public.events ev on ev.id = b.event_id
    join public.concepts c on c.id = ev.concept_id
    cross join lateral (
      select max(coalesce(l.claiming_at, l.created_at)) as since
      from join_links l
      where l.payment_id = b.payment_id
        and l.link_status = 'conflict'
        and l.conflict_reason = 'bind_conflict'
    ) s
    where b.status = 'confirmed'
      and b.customer_id is null
      and ev.ends_at > now()
      and s.since is not null
      and not exists (
        select 1
        from join_links l
        where l.payment_id = b.payment_id
          and l.link_status in ('pending', 'awaiting_login', 'claiming', 'stuck')
      )

    union all

    -- An image stuck in copying for 15 minutes or more (5.4); publishing the
    -- page again continues from the stored state.
    select
      m.publish_started_at,
      m.id,
      jsonb_build_object(
        'kind', 'media_stuck',
        'id', m.id,
        'customer_label', null,
        'since', m.publish_started_at
      )
    from public.media_assets m
    where m.publish_state = 'copying'
      and m.publish_started_at <= now() - interval '15 minutes'

    union all

    -- The accessibility statement was never published (5.5, AD-22). The
    -- column id is uuid in every branch; the item's id is the page slug.
    select
      cp.created_at,
      null::uuid,
      jsonb_build_object(
        'kind', 'accessibility_unpublished',
        'id', cp.slug,
        'customer_label', null,
        'since', cp.created_at
      )
    from public.content_pages cp
    where cp.slug = 'accessibility'
      and cp.published_at is null

    union all

    -- Push notifications that failed in the last 7 days (5.8): one item for
    -- all of them, since the latest failure.
    select
      f.since,
      null::uuid,
      jsonb_build_object(
        'kind', 'push_failed',
        'id', 'push_failed',
        'customer_label', null,
        'since', f.since,
        'count', f.n
      )
    from (
      select max(j.finished_at) as since, count(*)::integer as n
      from public.notification_jobs j
      where j.status = 'failed'
        and j.finished_at >= now() - interval '7 days'
    ) f
    where f.n > 0
  )
  select coalesce(
    jsonb_agg(i.item order by i.since desc, i.id),
    '[]'::jsonb
  )
  into v_result
  from items i;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Table and function grants (AD-5)
-- ---------------------------------------------------------------------------

revoke all on table public.push_subscriptions from public, anon, authenticated, service_role;
revoke all on table public.notification_deliveries from public, anon, authenticated, service_role;

revoke execute on function public.register_push_subscription(text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.register_push_subscription(text, jsonb, text) to authenticated;

revoke execute on function public.unregister_push_subscription(text) from public, anon, authenticated, service_role;
grant execute on function public.unregister_push_subscription(text) to authenticated;

revoke execute on function public.claim_push_jobs(integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_push_jobs(integer) to service_role;

revoke execute on function public.finish_push_job(uuid, uuid[], uuid[], text) from public, anon, authenticated, service_role;
grant execute on function public.finish_push_job(uuid, uuid[], uuid[], text) to service_role;

revoke execute on function private.invoke_push_worker() from public, anon, authenticated, service_role;
revoke execute on function private.job_invoke_push_worker() from public, anon, authenticated, service_role;

revoke execute on function public.admin_get_attention_items() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_attention_items() to authenticated;

-- ---------------------------------------------------------------------------
-- Schedule (AD-11): every minute; pg_cron is already enabled (3.12)
-- ---------------------------------------------------------------------------

select cron.schedule('invoke_push_worker', '* * * * *', 'select private.job_invoke_push_worker()');
