-- Story 5.10: the scheduled jobs (CAP-18, CAP-21, CAP-22, CAP-35, CAP-36,
-- AD-11, AD-22). Additive only: no drop, no constraint change (the type
-- credit_expiring is already in notification_templates_type_check since
-- 3.7).
--
-- The user runs it in the Supabase SQL Editor and the main session
-- registers it (apply_migration through the MCP is declined).
-- admin_get_attention_items was built from its latest definition
-- (20261018084612, still the live one on 2026-10-20), with every existing
-- branch unchanged.
--
-- 1. business_settings.credit_expiring_days (no settings field yet).
-- 2. Template credit_expiring.
-- 3. private.job_expiry_alerts (cards and credits about to expire).
-- 4. private.job_refresh_credit_options (the owner refresh, per customer).
-- 5. private.job_cleanup (old rows).
-- 6. private.job_intervals (every scheduled job and its frequency).
-- 7. admin_get_attention_items: job_failed, vault_missing, push_stuck.
-- 8. Grants: no job or helper gets one.
-- 9. Schedules: expiry_alerts, auto_extend (3.14's function, unchanged),
--    refresh_credit_options, cleanup.
--
-- Every job: security definer (pg_cron runs it as the owner), no grant,
-- safe to run twice, decides in SQL by Asia/Jerusalem against now(), never
-- by the cron's time; each unit in its own block, so one failure never
-- stops the others (as job_complete_events). Returns the rows acted on.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

-- How many days before registration closes for a credit's last alternative
-- the customer hears that the credit is about to expire (user decision
-- 2026-10-20). Read at run time (a display value, AD-15).
alter table public.business_settings
  add column credit_expiring_days integer not null default 5
    constraint business_settings_credit_expiring_days_check
      check (credit_expiring_days between 1 and 30);

-- ---------------------------------------------------------------------------
-- 2. Template (Hebrew stays in the template table, AD-5)
-- ---------------------------------------------------------------------------

-- Vars: {date} (DD.MM of the last alternative session) and {closes_on}
-- (DD.MM, the local day its registration closes).
insert into public.notification_templates (
  type, recipient_kind, push, body_mode, title, body, allowed_vars
)
values (
  'credit_expiring', 'customer', true, 'template',
  'הזיכוי שלך עומד לפוג',
  'ההרשמה למפגש החלופי האחרון, ב-{date}, נסגרת ב-{closes_on}. זה הזמן להירשם',
  array['date', 'closes_on']
);

-- ---------------------------------------------------------------------------
-- 3. Expiry alerts (hourly)
-- ---------------------------------------------------------------------------

-- Cards (3.14's set): active, not pinned, validity_mode days, bound to a
-- customer, with free entries (entitlement_balances.available > 0), and
-- days_left = expires_on - the local today between 0 and the threshold.
--   days_left <= admin_expiring_days: admin_card_expiring to every admin;
--   days_left <= customer_expiring_days: card_expiring to the customer.
--   Discriminator entitlement_id:expires_on (AD-12), so an extension (a new
--   expires_on) allows new alerts, and a rerun creates nothing.
-- Credits: active, not choice_pending, bound, not in use
-- (private.credit_in_use), all options set (active + passed =
-- options_count) and at least one active. The last option is the active one
-- whose registration closes last; once now() reaches its closing minus
-- credit_expiring_days (and before it closes): credit_expiring, with the
-- discriminator credit_id:event_id of that option, so a new last option
-- (replaced by the refresh, or changed by Tal) allows a new alert.
-- Reads only; locks nothing. Returns the notifications it created.
create function private.job_expiry_alerts()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_settings public.business_settings;
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_card record;
  v_credit record;
  v_last record;
  v_active integer;
  v_set integer;
  v_count integer := 0;
begin
  select s.* into v_settings
  from public.business_settings s;

  for v_card in
    select
      e.id,
      e.customer_id,
      e.expires_on,
      e.expires_on - v_today as days_left,
      b.available,
      coalesce(pr.full_name, '') as full_name
    from public.entitlements e
    join public.entitlement_balances b on b.entitlement_id = e.id
    join public.profiles pr on pr.id = e.customer_id
    where e.status = 'active'
      and e.pinned_event_id is null
      and e.eligibility_snapshot ->> 'validity_mode' = 'days'
      and e.customer_id is not null
      and b.available > 0
      and e.expires_on - v_today >= 0
      and e.expires_on - v_today <= greatest(
        v_settings.admin_expiring_days, v_settings.customer_expiring_days
      )
    order by e.id
  loop
    begin
      if v_card.days_left <= v_settings.admin_expiring_days then
        v_count := v_count + private.enqueue_admin_notification(
          'admin_card_expiring',
          v_card.id::text || ':' || to_char(v_card.expires_on, 'YYYY-MM-DD'),
          jsonb_build_object(
            'customer', v_card.full_name,
            'units', v_card.available,
            'expires_on', private.format_day_month(v_card.expires_on)
          ),
          '/admin/customers/' || v_card.customer_id::text
        );
      end if;

      if v_card.days_left <= v_settings.customer_expiring_days then
        if private.enqueue_notification(
          v_card.customer_id,
          'card_expiring',
          v_card.id::text || ':' || to_char(v_card.expires_on, 'YYYY-MM-DD'),
          jsonb_build_object(
            'units', v_card.available,
            'expires_on', private.format_day_month(v_card.expires_on)
          ),
          '/me/sessions'
        ) is not null then
          v_count := v_count + 1;
        end if;
      end if;
    exception when others then
      raise warning 'job_expiry_alerts: entitlement % failed: % %',
        v_card.id, sqlstate, sqlerrm;
    end;
  end loop;

  for v_credit in
    select c.id, c.customer_id, c.options_count, c.party_size
    from public.cancellation_credits c
    where c.status = 'active'
      and not c.choice_pending
      and c.customer_id is not null
    order by c.id
  loop
    begin
      if private.credit_in_use(v_credit.id) then
        continue;
      end if;

      select
        count(*) filter (where o.state = 'active')::integer,
        count(*) filter (where o.state in ('active', 'passed'))::integer
      into v_active, v_set
      from public.credit_options o
      where o.credit_id = v_credit.id;

      if v_active = 0 or v_set <> v_credit.options_count then
        continue;
      end if;

      select o.event_id, e.starts_at, e.registration_closes_at, e.status,
        e.capacity_adults
      into v_last
      from public.credit_options o
      join public.events e on e.id = o.event_id
      where o.credit_id = v_credit.id
        and o.state = 'active'
      order by e.registration_closes_at desc, e.id desc
      limit 1;

      -- Its session is no longer bookable (cancelled, unpublished or full)
      -- but the refresh has not replaced it yet: no alert this run (the
      -- same room test as private.refresh_credit_options).
      if v_last.status <> 'published'
         or private.occupied_places(v_last.event_id) + v_credit.party_size
            > v_last.capacity_adults then
        continue;
      end if;

      if now() >= v_last.registration_closes_at
           - make_interval(days => v_settings.credit_expiring_days)
         and now() < v_last.registration_closes_at then
        if private.enqueue_notification(
          v_credit.customer_id,
          'credit_expiring',
          v_credit.id::text || ':' || v_last.event_id::text,
          jsonb_build_object(
            'date', private.format_day_month(
              (v_last.starts_at at time zone 'Asia/Jerusalem')::date
            ),
            'closes_on', private.format_day_month(
              (v_last.registration_closes_at at time zone 'Asia/Jerusalem')::date
            )
          ),
          '/me/bookings'
        ) is not null then
          v_count := v_count + 1;
        end if;
      end if;
    exception when others then
      raise warning 'job_expiry_alerts: credit % failed: % %',
        v_credit.id, sqlstate, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Credit options refresh (every 15 minutes)
-- ---------------------------------------------------------------------------

-- The owner path of the refresh (3.7, 3.16 rule as is), for every customer
-- with an active credit that is not choice_pending, by customer_id: her
-- profile (the customer's mutex, AD-6) for update skip locked (held by
-- another transaction: done on the next run), then
-- private.refresh_customer_credits (profile, then her credits by id;
-- nothing else is held, so it cannot deadlock with the booking paths).
-- Returns how many customers were refreshed.
-- pg_cron runs the whole function in one transaction, so the locks of every
-- customer already processed stay held until the run ends. lock_timeout is
-- below deadlock_timeout (1s), so when the fill waits on a session someone
-- else holds (for example Tal cancelling it while waiting on a credit this
-- run already locked), the job gives up first: that customer's block fails
-- with a warning and is retried on the next run.
create function private.job_refresh_credit_options()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
set lock_timeout = '500ms'
as $$
declare
  v_customer uuid;
  v_count integer := 0;
begin
  for v_customer in
    select distinct c.customer_id
    from public.cancellation_credits c
    where c.status = 'active'
      and not c.choice_pending
      and c.customer_id is not null
    order by c.customer_id
  loop
    begin
      perform 1
      from public.profiles p
      where p.id = v_customer
      for update skip locked;

      if not found then
        continue;
      end if;

      perform private.refresh_customer_credits(v_customer);
      v_count := v_count + 1;
    exception when others then
      raise warning 'job_refresh_credit_options: customer % failed: % %',
        v_customer, sqlstate, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Cleanup (daily)
-- ---------------------------------------------------------------------------

-- Deletes: notifications read more than 90 days ago (an unread one is never
-- deleted; its job and deliveries go with it, on delete cascade); push jobs
-- finished more than 30 days ago (the notification stays; deliveries
-- cascade); idempotency results older than 7 days; pg_cron run details
-- that ended more than 14 days ago (net._http_response cleans itself).
-- Then closes the active waitlist entries of past sessions (5.6). Each step
-- in its own block. Returns the rows deleted or closed.
create function private.job_cleanup()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rows integer;
  v_count integer := 0;
begin
  begin
    delete from public.notifications n
    where n.read_at < now() - interval '90 days';
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  exception when others then
    raise warning 'job_cleanup: notifications failed: % %', sqlstate, sqlerrm;
  end;

  begin
    delete from public.notification_jobs j
    where j.finished_at < now() - interval '30 days';
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  exception when others then
    raise warning 'job_cleanup: notification_jobs failed: % %', sqlstate, sqlerrm;
  end;

  begin
    delete from private.idempotency_results r
    where r.created_at < now() - interval '7 days';
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  exception when others then
    raise warning 'job_cleanup: idempotency_results failed: % %', sqlstate, sqlerrm;
  end;

  begin
    delete from cron.job_run_details d
    where d.end_time < now() - interval '14 days';
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  exception when others then
    raise warning 'job_cleanup: job_run_details failed: % %', sqlstate, sqlerrm;
  end;

  -- 5.6's rule (deferred-work, target 5.10): the active waitlist entries of
  -- a session that started, was cancelled or completed are closed (they
  -- are already hidden; this only records it). A row held by another
  -- transaction waits for the next run.
  begin
    update public.waitlist_entries w
    set status = 'closed', closed_at = now()
    where w.id in (
      select we.id
      from public.waitlist_entries we
      join public.events e on e.id = we.event_id
      where we.status = 'active'
        and (
          e.starts_at <= now()
          or e.status in ('cancelled', 'completed')
        )
      order by we.id
      for update of we skip locked
    );
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  exception when others then
    raise warning 'job_cleanup: waitlist_entries failed: % %', sqlstate, sqlerrm;
  end;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The scheduled jobs and their frequency
-- ---------------------------------------------------------------------------

-- One row per cron.schedule (the jobname), with how often it runs. "To
-- handle" flags a job that is missing, whose latest run failed, or that has
-- not succeeded within 3 x every (AD-22). A story that schedules a job adds
-- its row here with create or replace (5.11: marketing_reminders).
create function private.job_intervals()
returns table (jobname text, every interval)
language sql
stable
set search_path = ''
as $$
  values
    ('reminders'::text, interval '1 minute'),
    ('invoke_push_worker', interval '1 minute'),
    ('complete_events', interval '5 minutes'),
    ('refresh_credit_options', interval '15 minutes'),
    ('expiry_alerts', interval '1 hour'),
    ('auto_extend', interval '1 hour'),
    ('cleanup', interval '1 day');
$$;

-- ---------------------------------------------------------------------------
-- 7. admin_get_attention_items
-- ---------------------------------------------------------------------------

-- As in 20261018084612, plus job_failed, vault_missing and push_stuck.
create or replace function public.admin_get_attention_items()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
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
  -- Every scheduled job (private.job_intervals) with its cron.job row, if
  -- any (an active one first).
  jobs as (
    select ji.jobname, ji.every, j.jobid, coalesce(j.active, false) as active
    from private.job_intervals() ji
    left join lateral (
      select cj.jobid, cj.active
      from cron.job cj
      where cj.jobname = ji.jobname
      order by cj.active desc, cj.jobid desc
      limit 1
    ) j on true
  ),
  -- Per job, by index lookups only (no aggregate over the whole of
  -- cron.job_run_details): its latest run, its latest succeeded run, and
  -- whether any run started more than 3 x its frequency ago.
  -- missing: not in cron.job, or not active. failed: its latest run failed.
  -- late: no succeeded run ended within 3 x its frequency, and either a
  -- succeeded run exists or a run started before that window (a first run
  -- still running is not late). A job with no runs at all is not flagged.
  job_states as (
    select
      jb.jobname,
      case
        when jb.jobid is null or not jb.active then 'missing'
        when lr.status = 'failed' then 'failed'
        when (ok.end_time is null or ok.end_time < now() - jb.every * 3)
          and (
            ok.runid is not null
            or exists (
              select 1
              from cron.job_run_details od
              where od.jobid = jb.jobid
                and od.start_time < now() - jb.every * 3
            )
          ) then 'late'
      end as reason,
      case
        when jb.jobid is null or not jb.active then now()
        when lr.status = 'failed'
          then coalesce(lr.end_time, lr.start_time, now())
        else coalesce(ok.end_time, lr.start_time, now())
      end as since
    from jobs jb
    left join lateral (
      select d.runid, d.status, d.start_time, d.end_time
      from cron.job_run_details d
      where d.jobid = jb.jobid
      order by d.runid desc
      limit 1
    ) lr on true
    left join lateral (
      select d.runid, d.end_time
      from cron.job_run_details d
      where d.jobid = jb.jobid
        and d.status = 'succeeded'
      order by d.runid desc
      limit 1
    ) ok on true
    where jb.jobid is null
       or not jb.active
       or lr.runid is not null
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
        'event_status', ev.status,
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

    -- A refund she asked for (3.7), open until Tal completes it (3.9).
    select
      r.requested_at,
      r.id,
      jsonb_build_object(
        'kind', 'refund_requested',
        'id', r.id,
        'customer_label', p.customer_label,
        'since', r.requested_at,
        'customer_id', coalesce(r.customer_id, p.customer_id),
        'amount_agorot', r.amount_agorot,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.refund_requests r
    join pay p on p.id = r.payment_id
    join public.bookings b on b.id = r.booking_id
    join public.events ev on ev.id = b.event_id
    join public.concepts c on c.id = ev.concept_id
    where r.status = 'requested'

    union all

    -- A business cancel she has not chosen for yet (3.8): refund or credit,
    -- no deadline; bound credits only.
    select
      cb.cancelled_at,
      c.id,
      jsonb_build_object(
        'kind', 'choice_pending',
        'id', c.id,
        'customer_label', coalesce(nullif(btrim(pr.full_name), ''), p.customer_label),
        'since', cb.cancelled_at,
        'customer_id', c.customer_id,
        'event_id', ev.id,
        'concept_name', cn.name,
        'starts_at', ev.starts_at,
        'amount_agorot', c.monetary_basis_agorot
      )
    from public.cancellation_credits c
    join public.entitlements se on se.id = c.source_entitlement_id
    join pay p on p.id = se.payment_id
    left join public.profiles pr on pr.id = c.customer_id
    join public.bookings cb on cb.id = private.credit_cancelled_booking(c.id)
    join public.events ev on ev.id = cb.event_id
    join public.concepts cn on cn.id = ev.concept_id
    where c.status = 'active'
      and c.choice_pending
      and c.customer_id is not null

    union all

    -- A booking that no longer fits its card after a correction (3.13): the
    -- latest unhandled warning per booking, while the booking is confirmed,
    -- its session has not started and the card still does not fit it.
    select
      w.since,
      w.booking_id,
      jsonb_build_object(
        'kind', 'correction_affected',
        'id', w.booking_id,
        'customer_id', coalesce(b.customer_id, p.customer_id),
        'customer_label', p.customer_label,
        'since', w.since,
        'entitlement_id', e.id,
        'event_id', ev.id,
        'concept_name', cn.name,
        'starts_at', ev.starts_at,
        'field', w.field
      )
    from (
      select distinct on (cb.booking_id)
        cb.booking_id, co.entitlement_id, co.field, co.created_at as since
      from public.entitlement_correction_bookings cb
      join public.entitlement_corrections co on co.id = cb.correction_id
      where cb.handled_at is null
      order by cb.booking_id, co.created_at desc, co.id desc
    ) w
    join public.bookings b on b.id = w.booking_id
    join public.entitlements e on e.id = w.entitlement_id
    join pay p on p.id = e.payment_id
    join public.events ev on ev.id = b.event_id
    join public.concepts cn on cn.id = ev.concept_id
    where b.status = 'confirmed'
      and ev.starts_at > now()
      and not private.entitlement_fits_event(e, ev)

    union all

    -- An email change stuck between its steps for more than 15 minutes
    -- (2.8, AD-21); saving the same address again on the card resumes it.
    select
      pr.account_op_started_at,
      pr.id,
      jsonb_build_object(
        'kind', 'email_change_stuck',
        'id', pr.id,
        'customer_label', nullif(btrim(pr.full_name), ''),
        'since', pr.account_op_started_at,
        'customer_id', pr.id
      )
    from public.profiles pr
    where pr.account_op_state = 'email_change_pending'
      and pr.account_op_started_at < now() - interval '15 minutes'
      and pr.anonymized_at is null

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

    union all

    -- A scheduled job that failed, is late or is missing (5.10, AD-22): one
    -- item per job; the item's id is the jobname.
    select
      s.since,
      null::uuid,
      jsonb_build_object(
        'kind', 'job_failed',
        'id', s.jobname,
        'customer_label', null,
        'since', s.since,
        'job', s.jobname,
        'reason', s.reason
      )
    from job_states s
    where s.reason is not null

    union all

    -- app_url or cron_secret absent or empty in Vault (5.10, AD-22): push
    -- never leaves. Only the item, never a value.
    select
      now(),
      null::uuid,
      jsonb_build_object(
        'kind', 'vault_missing',
        'id', 'vault_missing',
        'customer_label', null,
        'since', now()
      )
    where not exists (
        select 1
        from vault.decrypted_secrets vs
        where vs.name = 'app_url'
          and coalesce(btrim(vs.decrypted_secret), '') <> ''
      )
      or not exists (
        select 1
        from vault.decrypted_secrets vs
        where vs.name = 'cron_secret'
          and coalesce(btrim(vs.decrypted_secret), '') <> ''
      )

    union all

    -- Push jobs still queued 15 minutes after they were due (5.10): the
    -- worker is not reached (a wrong secret or URL). One item for all.
    select
      q.since,
      null::uuid,
      jsonb_build_object(
        'kind', 'push_stuck',
        'id', 'push_stuck',
        'customer_label', null,
        'since', q.since,
        'count', q.n
      )
    from (
      select min(j.next_attempt_at) as since, count(*)::integer as n
      from public.notification_jobs j
      where j.status = 'queued'
        and j.next_attempt_at < now() - interval '15 minutes'
    ) q
    where q.n > 0
  )
  select coalesce(
    jsonb_agg(i.item order by i.since desc, i.id),
    '[]'::jsonb
  )
  into v_result
  from items i;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Grants (AD-5): the jobs and the helper get none
-- ---------------------------------------------------------------------------

revoke execute on function private.job_expiry_alerts() from public, anon, authenticated, service_role;
revoke execute on function private.job_refresh_credit_options() from public, anon, authenticated, service_role;
revoke execute on function private.job_cleanup() from public, anon, authenticated, service_role;
revoke execute on function private.job_intervals() from public, anon, authenticated, service_role;

revoke execute on function public.admin_get_attention_items() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_attention_items() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Schedules (AD-11): the frequency is only the maximum delay
-- ---------------------------------------------------------------------------

select cron.schedule('expiry_alerts', '0 * * * *', 'select private.job_expiry_alerts()');
select cron.schedule('auto_extend', '5 * * * *', 'select private.job_auto_extend()');
select cron.schedule('refresh_credit_options', '*/15 * * * *', 'select private.job_refresh_credit_options()');
select cron.schedule('cleanup', '30 0 * * *', 'select private.job_cleanup()');
