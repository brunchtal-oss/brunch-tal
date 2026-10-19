-- Story 3.14, part 2 of 2: the automatic extension of a card (CAP-36,
-- AD-8, AD-11, AD-19). Runs after 20261019203302_auto_extended_type (the
-- type check).
--
-- A card (active, not pinned, validity_mode days, expired or not) with
-- something left in it (available + reserved > 0) gets +7 days for every
-- ended local week (Sunday to Saturday, Asia/Jerusalem) that overlaps its
-- validity and has no published or completed session it fits (kind,
-- weekdays, no card for a couple session). Each extension is a system
-- correction (unique week_start per card), audited, and the customer gets
-- one entitlement_auto_extended notification per card per run.
--
-- The user runs it in the Supabase SQL Editor and the main session
-- registers it. admin_get_entitlement was built from the live
-- pg_get_functiondef on 2026-10-19 (identical to 20261018084612), adding
-- only week_start to each correction.
--
-- 1. Template entitlement_auto_extended.
-- 2. private.week_has_eligible_session.
-- 3. private.job_auto_extend (no grant: pg_cron runs it as the owner; the
--    schedule arrives in 5.10: select private.job_auto_extend(); hourly).
-- 4. admin_get_entitlement: week_start in each correction.

-- ---------------------------------------------------------------------------
-- 1. Template (Hebrew stays in the template table, AD-5)
-- ---------------------------------------------------------------------------

-- Vars: {expires_on} (DD.MM, the final expiry) and {units} (available).
insert into public.notification_templates (
  type, recipient_kind, push, body_mode, title, body, allowed_vars
)
values (
  'entitlement_auto_extended', 'customer', true, 'template',
  'הכרטיסייה הוארכה',
  E'לא היו בראנצ׳ים השבוע ולכן הארכנו לך את תוקף הכרטיסייה!\nהכרטיסייה שלך בתוקף עד {expires_on}, ונשארו בה {units} כניסות פנויות.',
  array['expires_on', 'units']
);

-- ---------------------------------------------------------------------------
-- 2. Whether a week had a brunch the card fits
-- ---------------------------------------------------------------------------

-- A published or completed session (full or past ones count; drafts and
-- cancelled ones do not) that starts in the local week [p_week_start,
-- p_week_start + 7) and that the card fits (private.entitlement_fits_event)
-- when its validity is that whole week. So only the kind, the weekdays and
-- "no card for a couple session" decide; the card's own dates never do (a
-- partial first or last week with a session does not extend).
create function private.week_has_eligible_session(
  p_entitlement public.entitlements,
  p_week_start date
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_entitlement public.entitlements := p_entitlement;
begin
  v_entitlement.status := 'active';
  v_entitlement.valid_from := p_week_start;
  v_entitlement.expires_on := p_week_start + 6;

  return exists (
    select 1
    from public.events ev
    where ev.status in ('published', 'completed')
      and ev.starts_at >= (p_week_start::timestamp at time zone 'Asia/Jerusalem')
      and ev.starts_at < ((p_week_start + 7)::timestamp at time zone 'Asia/Jerusalem')
      and private.entitlement_fits_event(v_entitlement, ev)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The job
-- ---------------------------------------------------------------------------

-- p_today: the local day the run counts from (null = today in
-- Asia/Jerusalem); p_entitlement_ids: only these cards (null = all; tests
-- pass their own). Returns how many weeks were extended.
-- Per card, by id: for update skip locked on the entitlement only (a card
-- held by another transaction waits for the next run), each in its own
-- block, so one failure never stops the others. Weeks from the local week
-- of valid_from, while the week starts on or before expires_on (re-read
-- after each extension, so an added week that has ended is checked in the
-- same run) and has ended (w + 7 <= today). A week that already has a
-- correction of this card is skipped (the unique week_start makes reruns
-- harmless). Never locks events or profiles, so it cannot deadlock with
-- the booking paths.
create function private.job_auto_extend(
  p_today date default null,
  p_entitlement_ids uuid[] default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today date := coalesce(p_today, (now() at time zone 'Asia/Jerusalem')::date);
  v_id uuid;
  v_entitlement public.entitlements;
  v_saved public.entitlements;
  v_correction public.entitlement_corrections;
  v_week date;
  v_extended integer;
  v_available integer;
  v_count integer := 0;
begin
  for v_id in
    select e.id
    from public.entitlements e
    join public.entitlement_balances b on b.entitlement_id = e.id
    where e.status = 'active'
      and e.pinned_event_id is null
      and e.eligibility_snapshot ->> 'validity_mode' = 'days'
      and b.available + b.reserved > 0
      and (p_entitlement_ids is null or e.id = any (p_entitlement_ids))
    order by e.id
  loop
    begin
      select e.* into v_entitlement
      from public.entitlements e
      where e.id = v_id
        and e.status = 'active'
        and e.pinned_event_id is null
        and e.eligibility_snapshot ->> 'validity_mode' = 'days'
      for update skip locked;

      if not found then
        continue;
      end if;

      -- Checked again under the lock: a finished card is never extended.
      if not exists (
        select 1
        from public.entitlement_balances b
        where b.entitlement_id = v_entitlement.id
          and b.available + b.reserved > 0
      ) then
        continue;
      end if;

      v_extended := 0;
      v_correction := null;
      v_week := private.local_week_start(v_entitlement.valid_from);

      while v_week <= v_entitlement.expires_on and v_week + 7 <= v_today loop
        if not exists (
             select 1
             from public.entitlement_corrections c
             where c.entitlement_id = v_entitlement.id
               and c.week_start = v_week
           )
           and not private.week_has_eligible_session(v_entitlement, v_week) then
          update public.entitlements
          set expires_on = expires_on + 7
          where id = v_entitlement.id
          returning * into v_saved;

          insert into public.entitlement_corrections (
            entitlement_id, field, old_value, new_value, related_event_id,
            reason, actor_id, actor_kind, week_start
          )
          values (
            v_entitlement.id, 'expires_on', to_jsonb(v_entitlement.expires_on),
            to_jsonb(v_saved.expires_on), null, null, null, 'system', v_week
          )
          returning * into v_correction;

          perform private.audit(
            null, 'system', 'job_auto_extend', 'entitlements', v_entitlement.id,
            v_entitlement.customer_id, null, to_jsonb(v_entitlement), to_jsonb(v_saved)
          );

          v_entitlement := v_saved;
          v_extended := v_extended + 1;
        end if;

        v_week := v_week + 7;
      end loop;

      if v_extended > 0 then
        -- One notification per card per run, with the final expiry; an
        -- unbound card has no one to tell (AD-23).
        if v_entitlement.customer_id is not null then
          select b.available into v_available
          from public.entitlement_balances b
          where b.entitlement_id = v_entitlement.id;

          perform private.enqueue_notification(
            v_entitlement.customer_id,
            'entitlement_auto_extended',
            v_correction.id::text,
            jsonb_build_object(
              'expires_on', private.format_day_month(v_entitlement.expires_on),
              'units', v_available
            ),
            '/me/purchases/' || v_entitlement.id::text
          );
        end if;

        v_count := v_count + v_extended;
      end if;
    exception when others then
      raise warning 'job_auto_extend: entitlement % failed: % %',
        v_id, sqlstate, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. admin_get_entitlement: week_start in each correction
-- ---------------------------------------------------------------------------

create or replace function public.admin_get_entitlement(p_entitlement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entitlement public.entitlements;
  v_balance public.entitlement_balances;
  v_payment public.payments;
  v_label text;
  v_today date := (now() at time zone 'Asia/Jerusalem')::date;
  v_entries jsonb;
  v_bookings jsonb;
  v_corrections jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select e.* into v_entitlement
  from public.entitlements e
  where e.id = p_entitlement_id;

  if v_entitlement.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  select b.* into v_balance
  from public.entitlement_balances b
  where b.entitlement_id = v_entitlement.id;

  select p.* into v_payment
  from public.payments p
  where p.id = v_entitlement.payment_id;

  select coalesce(nullif(btrim(pr.full_name), ''), v_payment.payer_label)
  into v_label
  from (select 1) one
  left join public.profiles pr
    on pr.id = coalesce(v_entitlement.customer_id, v_payment.customer_id);

  -- As admin_get_customer.entries.
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
  into v_entries
  from public.booking_allocations a
  join public.bookings bk on bk.id = a.booking_id
  join public.events ev on ev.id = bk.event_id
  join public.concepts c on c.id = ev.concept_id
  cross join lateral generate_series(1, a.units) as u(n)
  where a.entitlement_id = v_entitlement.id
    and bk.status <> 'cancelled';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'booking_id', x.booking_id,
        'event_id', x.event_id,
        'concept_name', x.concept_name,
        'starts_at', x.starts_at,
        'status', x.status
      )
      order by x.starts_at desc, x.booking_id
    ),
    '[]'::jsonb
  )
  into v_bookings
  from (
    select distinct bk.id as booking_id, ev.id as event_id, c.name as concept_name,
      ev.starts_at, bk.status
    from public.booking_allocations a
    join public.bookings bk on bk.id = a.booking_id
    join public.events ev on ev.id = bk.event_id
    join public.concepts c on c.id = ev.concept_id
    where a.entitlement_id = v_entitlement.id
  ) x;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'correction_id', co.id,
        'field', co.field,
        'old_value', co.old_value,
        'new_value', co.new_value,
        'reason', co.reason,
        'actor_kind', co.actor_kind,
        'created_at', co.created_at,
        'related_event_id', co.related_event_id,
        'related_concept_name', c.name,
        'related_starts_at', ev.starts_at,
        'week_start', co.week_start
      )
      order by co.created_at desc, co.id
    ),
    '[]'::jsonb
  )
  into v_corrections
  from public.entitlement_corrections co
  left join public.events ev on ev.id = co.related_event_id
  left join public.concepts c on c.id = ev.concept_id
  where co.entitlement_id = v_entitlement.id;

  return jsonb_build_object(
    'entitlement_id', v_entitlement.id,
    'customer_id', coalesce(v_entitlement.customer_id, v_payment.customer_id),
    'customer_label', v_label,
    'product_name', v_payment.product_snapshot ->> 'name',
    'kind', v_entitlement.kind,
    'status', v_entitlement.status,
    'validity_mode', v_entitlement.eligibility_snapshot ->> 'validity_mode',
    'correctable', v_entitlement.status = 'active'
      and v_entitlement.pinned_event_id is null
      and v_entitlement.eligibility_snapshot ->> 'validity_mode' = 'days',
    'paid_on', v_payment.paid_on,
    'original_units', v_entitlement.original_units,
    'available', v_balance.available,
    'reserved', v_balance.reserved,
    'used', v_balance.used,
    'valid_from', v_entitlement.valid_from,
    'expires_on', v_entitlement.expires_on,
    'is_expired', v_balance.is_expired,
    'days_left', v_entitlement.expires_on - v_today,
    'allowed_weekdays', to_jsonb(v_entitlement.allowed_weekdays),
    'eligible_event_kind', v_entitlement.eligible_event_kind,
    'is_extended', private.entitlement_is_extended(v_entitlement.id, v_entitlement.expires_on),
    'entries', v_entries,
    'bookings', v_bookings,
    'corrections', v_corrections
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants (AD-5): the helper and the job get none
-- ---------------------------------------------------------------------------

revoke execute on function private.week_has_eligible_session(public.entitlements, date) from public, anon, authenticated, service_role;
revoke execute on function private.job_auto_extend(date, uuid[]) from public, anon, authenticated, service_role;

revoke execute on function public.admin_get_entitlement(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_entitlement(uuid) to authenticated;
