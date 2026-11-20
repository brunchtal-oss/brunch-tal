-- Online payments, PR A: review pass 3 ("Pass 3" in "Decisions after
-- review", spec-online-payments-grow-a.md). create or replace only, nothing
-- dropped. Redefinitions start from 20261120151033 (or 20261120144357 where
-- that one did not redefine them).
--
-- - begin_checkout_core: back to pass 1, every checkout gets the full window
--   and grace (the "no extension" rule is removed).
-- - Rate limit: private.rate_limit_window / private.rate_limit_cap shared by
--   rate_limit_hit and the new rate_limit_peek (no write). Checkout bucket:
--   id keys 3 an hour, ip keys 10.
-- - Reconciliation also claims unpaid checkouts with first_notified_at and
--   paid / issue checkouts notified again after they closed.
-- - checkout_return: a re-issue within 10 minutes of join_issued_at.
-- - Attention: the issue item carries provider_transaction_id and
--   earlier_issue.

-- ---------------------------------------------------------------------------
-- 1. begin_checkout_core: the full window for every checkout
-- ---------------------------------------------------------------------------

create or replace function private.begin_checkout_core(
  p_customer_id uuid,
  p_product_id uuid,
  p_event_id uuid,
  p_terms_accepted boolean
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_product public.products;
  v_event public.events;
  v_settings public.business_settings;
  v_prev_events uuid[] := '{}'::uuid[];
  v_prev public.checkouts;
  v_place jsonb;
  v_party integer;
  v_id uuid := gen_random_uuid();
  v_notify text;
  v_browser text;
  v_row public.checkouts;
begin
  if p_terms_accepted is not true then
    raise exception 'TERMS_REQUIRED' using errcode = 'P0001';
  end if;

  if p_product_id is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- Lock order (AD-6): profiles -> events -> checkouts. Her open checkouts'
  -- sessions are read without a lock, locked with the new one by id, and
  -- checked again under the checkout lock.
  if p_customer_id is not null then
    perform 1
    from public.profiles p
    where p.id = p_customer_id
    for update;

    select coalesce(array_agg(distinct c.event_id), '{}'::uuid[]) into v_prev_events
    from public.checkouts c
    where c.customer_id = p_customer_id
      and c.state = 'open'
      and c.event_id is not null;
  end if;

  perform 1
  from public.events e
  where e.id = any (array_remove(v_prev_events || p_event_id, null))
  order by e.id
  for update;

  -- One open checkout per customer: the previous one fails and its hold is
  -- released. The waitlist hears of it, unless the new checkout holds the
  -- same session (no place is freed). A late payment on it still lands.
  if p_customer_id is not null then
    for v_prev in
      select c.*
      from public.checkouts c
      where c.customer_id = p_customer_id
        and c.state = 'open'
      order by c.id
      for update
    loop
      if v_prev.event_id is not null and not (v_prev.event_id = any (v_prev_events)) then
        raise exception 'CONCURRENT_CHANGE' using errcode = 'P0001';
      end if;
      perform private.close_checkout(
        v_prev.id, 'failed', v_prev.event_id is distinct from p_event_id
      );
    end loop;
  end if;

  select p.* into v_product
  from public.products p
  where p.id = p_product_id
  for share;

  if v_product.id is null or not v_product.active or v_product.price_agorot <= 0 then
    raise exception 'PRODUCT_NOT_PURCHASABLE' using errcode = 'P0001';
  end if;

  if v_product.validity_mode = 'session' then
    if p_event_id is null then
      raise exception 'PINNED_EVENT_REQUIRED' using errcode = 'P0001';
    end if;

    select e.* into v_event
    from public.events e
    where e.id = p_event_id;

    if v_event.id is null or v_event.status <> 'published' then
      raise exception 'EVENT_NOT_BOOKABLE' using errcode = 'P0001';
    end if;

    -- The self-booking rules (book_session): the moment after the locks.
    if clock_timestamp() >= v_event.registration_closes_at then
      raise exception 'REGISTRATION_CLOSED' using errcode = 'P0001';
    end if;

    -- Full (other holds count), not fit, already booked, intro.
    v_place := private.plan_pinned_placement(p_customer_id, p_product_id, p_event_id, null);
    if not (v_place ->> 'ok')::boolean then
      raise exception '%', v_place ->> 'code' using errcode = 'P0001';
    end if;

    v_party := case when v_event.kind = 'couple' then 2 else 1 end;
  else
    if p_event_id is not null then
      raise exception 'EVENT_NOT_ALLOWED' using errcode = 'P0001';
    end if;

    if (v_product.type = 'intro' or v_product.intro_only)
       and p_customer_id is not null
       and private.intro_blocked(p_customer_id, null) then
      raise exception 'INTRO_NOT_ELIGIBLE' using errcode = 'P0001';
    end if;

    v_party := v_product.party_size;
  end if;

  select s.* into v_settings from public.business_settings s;

  v_notify := translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/=\n', '-_');
  v_browser := translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/=\n', '-_');

  insert into public.checkouts (
    id, customer_id, product_id, event_id, party_size, amount_agorot,
    product_name, reference, state, pay_until, hold_until,
    notify_secret_hash, browser_secret_hash, terms_accepted_at,
    product_snapshot
  )
  values (
    v_id,
    p_customer_id,
    v_product.id,
    v_event.id,
    v_party,
    v_product.price_agorot,
    v_product.name,
    'BT-' || upper(left(replace(v_id::text, '-', ''), 10)),
    'open',
    now() + make_interval(mins => v_settings.online_payment_window_minutes),
    case when v_event.id is not null then
      now() + make_interval(mins => v_settings.online_payment_window_minutes
                                    + v_settings.online_hold_grace_minutes)
    end,
    private.token_hash(v_notify),
    private.token_hash(v_browser),
    now(),
    private.checkout_product_snapshot(v_product)
  )
  returning * into v_row;

  return jsonb_build_object(
    'checkout_id', v_row.id,
    'reference', v_row.reference,
    'amount_agorot', v_row.amount_agorot,
    'product_name', v_row.product_name,
    'product_kind', v_product.validity_mode,
    'event_id', v_row.event_id,
    'pay_until', v_row.pay_until,
    'notify_secret', v_notify,
    'browser_secret', v_browser
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Rate limit: one window and one cap, the hit and the peek
-- ---------------------------------------------------------------------------

-- The bucket's window: checkout by the hour, the others by 15 minutes.
create or replace function private.rate_limit_window(p_bucket text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p_bucket = 'checkout' then date_trunc('hour', now())
    else to_timestamp(floor(extract(epoch from now()) / 900) * 900)
  end;
$$;

-- The cap of a key. Checkout (review pass 3): a customer's id key 3 an hour,
-- an ip key 10.
create or replace function private.rate_limit_cap(p_bucket text, p_key text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_bucket = 'checkout' and p_key like 'id:%' then 3
    when p_bucket = 'checkout' then 10
    when p_bucket = 'email' and p_key like 'ip:%' then 5
    when p_bucket = 'email' then 3
    when p_key like 'ip:%' then 20
    when p_bucket = 'login' then 8
    else 10
  end;
$$;

-- The shared input check of rate_limit_hit and rate_limit_peek.
create or replace function private.rate_limit_input_ok(p_bucket text, p_keys text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_bucket is not null
    and p_bucket in ('login', 'token', 'email', 'checkout')
    and p_keys is not null
    and cardinality(p_keys) between 1 and 4
    and not exists (
      select 1 from unnest(p_keys) k
      where k is null
         or char_length(k) not between 4 and 512
         or k !~ '^(ip|id):.'
    );
$$;

create or replace function public.rate_limit_hit(p_bucket text, p_keys text[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_window timestamptz := private.rate_limit_window(p_bucket);
  v_key text;
  v_hits integer;
  v_allowed boolean := true;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if not coalesce(private.rate_limit_input_ok(p_bucket, p_keys), false) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  -- Sorted, so two concurrent calls lock the rows in one order.
  for v_key in
    select distinct k from unnest(p_keys) k
    order by k
  loop
    insert into private.rate_limits as r (bucket, key_hash, window_start, hits)
    values (
      p_bucket,
      encode(extensions.digest(v_key, 'sha256'), 'hex'),
      v_window,
      1
    )
    on conflict (bucket, key_hash, window_start)
    do update set hits = r.hits + 1
    returning r.hits into v_hits;

    if v_hits > private.rate_limit_cap(p_bucket, v_key) then
      v_allowed := false;
    end if;
  end loop;

  -- Old windows are removed a little at a time.
  delete from private.rate_limits
  where ctid in (
    select r.ctid from private.rate_limits r
    where r.window_start < now() - interval '1 day'
    limit 100
  );

  return jsonb_build_object('allowed', v_allowed);
end;
$function$;

-- Would one more attempt be allowed? The same keys, window and caps as
-- rate_limit_hit, without counting (review pass 3: only a begin that made a
-- checkout and a Grow form is counted, afterwards).
create function public.rate_limit_peek(p_bucket text, p_keys text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if not coalesce(private.rate_limit_input_ok(p_bucket, p_keys), false) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  return jsonb_build_object('allowed', not exists (
    select 1
    from unnest(p_keys) k
    join private.rate_limits r
      on r.bucket = p_bucket
     and r.key_hash = encode(extensions.digest(k, 'sha256'), 'hex')
     and r.window_start = private.rate_limit_window(p_bucket)
    where r.hits >= private.rate_limit_cap(p_bucket, k)
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Reconciliation: notified checkouts, and payments after a close
-- ---------------------------------------------------------------------------

create or replace function public.claim_checkouts_to_reconcile(p_limit integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  with picked as (
    select c.id
    from public.checkouts c
    where c.created_at > now() - interval '7 days'
      and (
        -- Unpaid: Grow made a form (or notified), and an open one is past
        -- its window.
        (
          c.state in ('open', 'failed', 'expired')
          and (c.form_created_at is not null or c.first_notified_at is not null)
          and not (c.state = 'open' and c.pay_until > now())
        )
        -- Review pass 3: paid or issue, and Grow notified again after it
        -- closed (a payment after Tal closed it): the confirm can only give
        -- late_document, second_payment or a replay.
        or (
          c.state in ('issue', 'paid')
          and c.last_notified_at > c.closed_at
        )
      )
    order by c.checked_at nulls first, c.created_at, c.id
    limit p_limit
    for update skip locked
  ),
  stamped as (
    update public.checkouts c
    set checked_at = now()
    from picked
    where c.id = picked.id
    returning c.id
  )
  select array_agg(s.id) into v_ids
  from stamped s;

  return to_jsonb(coalesce(v_ids, '{}'::uuid[]));
end;
$$;

create or replace function private.job_reconcile_payments()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.checkouts c
    where c.created_at > now() - interval '7 days'
      and (
        -- Unpaid: Grow made a form (or notified), and an open one is past
        -- its window.
        (
          c.state in ('open', 'failed', 'expired')
          and (c.form_created_at is not null or c.first_notified_at is not null)
          and not (c.state = 'open' and c.pay_until > now())
        )
        -- Review pass 3: paid or issue, and Grow notified again after it
        -- closed (a payment after Tal closed it): the confirm can only give
        -- late_document, second_payment or a replay.
        or (
          c.state in ('issue', 'paid')
          and c.last_notified_at > c.closed_at
        )
      )
  ) then
    return null;
  end if;

  return private.invoke_reconcile_payments();
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. checkout_return: a re-issue within 10 minutes
-- ---------------------------------------------------------------------------

create or replace function public.checkout_return(p_checkout_id uuid, p_browser_secret text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.checkouts;
  v_kind text;
  v_payment public.payments;
  v_live public.activation_tokens;
  v_token jsonb;
  v_result jsonb;
  v_join_issued_at timestamptz;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  v_row := private.find_checkout(p_checkout_id, p_browser_secret, 'browser');
  if v_row.id is null then
    raise exception 'CHECKOUT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select p.validity_mode into v_kind
  from public.products p
  where p.id = v_row.product_id;

  v_result := jsonb_build_object(
    'state', v_row.state,
    'product_kind', v_kind,
    'event_id', v_row.event_id,
    'customer_known', v_row.customer_id is not null
  );

  if v_row.state <> 'paid' or v_row.customer_id is not null then
    return v_result;
  end if;

  select pay.* into v_payment
  from public.payments pay
  where pay.id = v_row.payment_id;

  if v_payment.customer_id is not null then
    return v_result || jsonb_build_object('joined', true);
  end if;

  begin
    -- Lock order (AD-6): the payment's join tokens first. Raises LINK_USED
    -- (bound or consumed), PURCHASE_VOIDED, LINK_IN_PROGRESS (claiming).
    v_live := private.lock_join_payment(v_payment.id);
  exception when sqlstate 'P0001' then
    return v_result || jsonb_build_object(
      'joined', sqlerrm = 'LINK_USED',
      'join_blocked', sqlerrm <> 'LINK_USED'
    );
  end;

  -- Review pass 2: one link per checkout, read under the token lock; a
  -- later return is blocked (the browser drops its cookie entry anyway).
  -- Review pass 3: within 10 minutes of the first issue the same browser
  -- secret may get a new link (a lost response); the live one is revoked
  -- first, and the window does not move.
  select c.join_issued_at into v_join_issued_at
  from public.checkouts c
  where c.id = v_row.id
  for update;

  if v_join_issued_at is not null and now() > v_join_issued_at + interval '10 minutes' then
    return v_result || jsonb_build_object('joined', false, 'join_blocked', true);
  end if;

  -- A conflict stays for Tal ("לטיפול"); no new link over it.
  if v_live.id is not null and v_live.state = 'conflict' then
    return v_result || jsonb_build_object('joined', false, 'join_blocked', true);
  end if;

  if v_live.id is not null then
    update public.activation_tokens
    set state = 'revoked', revoked_at = now()
    where id = v_live.id;
  end if;

  v_token := private.issue_token('join', null, v_payment.id);

  update public.checkouts
  set join_issued_at = coalesce(join_issued_at, now())
  where id = v_row.id;

  return v_result || jsonb_build_object(
    'joined', false,
    'join_token', v_token ->> 'token'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Attention: the issue's document and the earlier issue
-- ---------------------------------------------------------------------------

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
      p.source,
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
    -- An online purchase has its own item after 24 hours
    -- (online_purchase_incomplete).
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
      and p.source <> 'online'
      and not exists (
        select 1
        from join_links l
        where l.payment_id = p.id
          and l.link_status not in ('revoked', 'expired')
      )

    union all

    -- An online purchase paid more than 24 hours ago and still not joined.
    select
      p.created_at,
      p.id,
      jsonb_build_object(
        'kind', 'online_purchase_incomplete',
        'id', p.id,
        'customer_label', p.customer_label,
        'since', p.created_at,
        'payment_id', p.id,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      )
    from pay p
    where p.status = 'approved'
      and p.source = 'online'
      and p.customer_id is null
      and p.created_at < now() - interval '24 hours'
      -- A live conflict or stuck link already shows as its own item.
      and not exists (
        select 1
        from join_links l
        where l.payment_id = p.id
          and l.link_status in ('conflict', 'stuck')
      )

    union all

    -- An online payment Tal checks by hand (not verified, amount mismatch,
    -- second payment, intro race, approval failure), until resolved.
    select
      i.created_at,
      i.id,
      jsonb_build_object(
        'kind', 'online_payment_issue',
        'id', i.id,
        'customer_label', nullif(btrim(pr.full_name), ''),
        'since', i.created_at,
        'customer_id', c.customer_id,
        'reason', i.reason,
        -- Review pass 3: the morning document and the checkout's earlier
        -- issue (late_document: what Tal already settled).
        'provider_transaction_id', i.provider_transaction_id,
        'earlier_issue', (
          select jsonb_build_object(
            'reason', e.reason,
            'resolved', e.resolved_at is not null
          )
          from public.online_payment_issues e
          where e.checkout_id = i.checkout_id
            and (e.created_at, e.id) < (i.created_at, i.id)
          order by e.created_at desc, e.id desc
          limit 1
        ),
        'reference', c.reference,
        'product_name', c.product_name,
        'amount_agorot', coalesce(i.amount_agorot, c.amount_agorot),
        'event_id', ev.id,
        'concept_name', cn.name,
        'starts_at', ev.starts_at
      )
    from public.online_payment_issues i
    join public.checkouts c on c.id = i.checkout_id
    left join public.profiles pr on pr.id = c.customer_id
    left join public.events ev on ev.id = c.event_id
    left join public.concepts cn on cn.id = ev.concept_id
    where i.resolved_at is null

    union all

    -- Grow first notified 30 minutes ago, nothing was confirmed, and she
    -- did not return: Tal checks it in Grow (and may close it,
    -- admin_close_unconfirmed_checkout).
    select
      c.first_notified_at,
      c.id,
      jsonb_build_object(
        'kind', 'online_payment_unconfirmed',
        'id', c.id,
        'customer_label', nullif(btrim(pr.full_name), ''),
        'since', c.first_notified_at,
        'customer_id', c.customer_id,
        'reference', c.reference,
        'product_name', c.product_name,
        'amount_agorot', c.amount_agorot,
        'event_id', ev.id,
        'concept_name', cn.name,
        'starts_at', ev.starts_at
      )
    from public.checkouts c
    left join public.profiles pr on pr.id = c.customer_id
    left join public.events ev on ev.id = c.event_id
    left join public.concepts cn on cn.id = ev.concept_id
    where c.first_notified_at is not null
      and c.state not in ('paid', 'issue')
      and c.first_notified_at < now() - interval '30 minutes'
      and not exists (
        select 1
        from public.online_payment_issues i
        where i.checkout_id = c.id
          and i.resolved_at is null
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

    -- A removal of personal details stuck between its steps for more than
    -- 15 minutes (4.6, AD-21): no anonymized_at filter (step 1 set it); the
    -- card's "complete the removal" resumes it.
    select
      pr.account_op_started_at,
      pr.id,
      jsonb_build_object(
        'kind', 'anonymization_stuck',
        'id', pr.id,
        'customer_label', null,
        'since', pr.account_op_started_at,
        'customer_id', pr.id
      )
    from public.profiles pr
    where pr.account_op_state = 'anonymization_pending'
      and pr.account_op_started_at < now() - interval '15 minutes'

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
-- 6. Grants (AD-5): revoke from every API role, then one grant
-- ---------------------------------------------------------------------------

revoke execute on function private.begin_checkout_core(uuid, uuid, uuid, boolean) from public, anon, authenticated, service_role;
revoke execute on function private.rate_limit_window(text) from public, anon, authenticated, service_role;
revoke execute on function private.rate_limit_cap(text, text) from public, anon, authenticated, service_role;
revoke execute on function private.rate_limit_input_ok(text, text[]) from public, anon, authenticated, service_role;
revoke execute on function private.job_reconcile_payments() from public, anon, authenticated, service_role;

revoke execute on function public.rate_limit_hit(text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.rate_limit_hit(text, text[]) to service_role;

revoke execute on function public.rate_limit_peek(text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.rate_limit_peek(text, text[]) to service_role;

revoke execute on function public.claim_checkouts_to_reconcile(integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_checkouts_to_reconcile(integer) to service_role;

revoke execute on function public.checkout_return(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.checkout_return(uuid, text) to service_role;

revoke execute on function public.admin_get_attention_items() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_attention_items() to authenticated;
