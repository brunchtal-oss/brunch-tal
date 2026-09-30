-- Story 1.3: pure time and phone helpers.
-- AD-8: every business time is computed in SQL, in 'Asia/Jerusalem'
-- (including daylight saving). AD-9: phone numbers are normalized to E.164
-- only here.
--
-- All helpers are pure functions of their arguments: no now(), no table
-- reads. The caller compares the result with now(), so tests can check exact
-- boundaries (48 hours, DST transitions).
--
-- No grants: these are called only from security definer functions (owned by
-- postgres). A future view or invoker function that needs one adds its own
-- explicit grant (AD-5).

-- ---------------------------------------------------------------------------
-- Time (AD-8)
-- ---------------------------------------------------------------------------

-- End of a local calendar day = start of the next local day in Jerusalem.
-- "Valid until the end of day d" means now() < private.local_day_end(d).
create function private.local_day_end(p_day date)
returns timestamptz
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select (p_day + 1)::timestamp at time zone 'Asia/Jerusalem';
$$;

-- Registration closes p_days_before local days before the session's local
-- date, at local time p_local_time. The caller extracts both values from the
-- event's rule snapshot.
create function private.registration_closes_at(
  p_starts_at timestamptz,
  p_days_before integer,
  p_local_time time
)
returns timestamptz
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select (((p_starts_at at time zone 'Asia/Jerusalem')::date - p_days_before) + p_local_time)
    at time zone 'Asia/Jerusalem';
$$;

-- Self-cancel deadline: p_window_hours real (elapsed) hours before the start,
-- also across a DST change. Self-cancel is allowed while now() <= deadline.
-- The interval has only an hours component, so the result does not depend on
-- the session TimeZone setting.
create function private.cancel_deadline(p_window_hours integer, p_starts_at timestamptz)
returns timestamptz
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select p_starts_at - make_interval(hours => p_window_hours);
$$;

-- The local Sunday that starts the week containing p_day (automatic
-- extension, CAP-36).
create function private.local_week_start(p_day date)
returns date
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select p_day - extract(dow from p_day)::integer;
$$;

-- A work-sheet preparation day: the session's local date shifted by
-- p_offset days (0 = the session day, -1 = the day before).
create function private.prep_day(p_starts_at timestamptz, p_offset integer)
returns date
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select (p_starts_at at time zone 'Asia/Jerusalem')::date + p_offset;
$$;

-- ---------------------------------------------------------------------------
-- Phone (AD-9)
-- ---------------------------------------------------------------------------

-- Returns E.164 ('+972541234567') or null when the input is not a valid
-- number; the caller raises INVALID_PHONE.
--   - Spaces, dashes, dots, parentheses and bidi marks are ignored.
--   - A single leading 0 is an Israeli national number.
--   - '+' or '00' starts an international number. With 972, one trunk 0
--     after the country code is dropped ('+972 054...').
--   - Israeli national numbers: 8 or 9 digits, not starting with 0 or 1.
--   - Other country codes: generic E.164, 8 to 15 digits, not starting with 0.
--   - Anything else (no prefix, letters, '+' in the middle) is null.
create function private.normalize_phone(p_raw text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  with cleaned as (
    select regexp_replace(
      p_raw,
      '[[:space:] .()‎‏‪-‮⁦-⁩-]',
      '',
      'g'
    ) as v
  ),
  international as (
    select
      v,
      case
        when v ~ '^\+[0-9]+$' then substr(v, 2)
        when v ~ '^00[0-9]+$' then substr(v, 3)
      end as intl
    from cleaned
  )
  select case
    when intl is not null and intl like '972%' then
      case
        when regexp_replace(substr(intl, 4), '^0', '') ~ '^[2-9][0-9]{7,8}$'
          then '+972' || regexp_replace(substr(intl, 4), '^0', '')
      end
    when intl is not null then
      case when intl ~ '^[1-9][0-9]{7,14}$' then '+' || intl end
    when v ~ '^0[2-9][0-9]{7,8}$' then '+972' || substr(v, 2)
  end
  from international;
$$;

-- ---------------------------------------------------------------------------
-- Function grants (AD-5): revoked from every role, no grant.
-- ---------------------------------------------------------------------------

revoke execute on function private.local_day_end(date) from public, anon, authenticated, service_role;
revoke execute on function private.registration_closes_at(timestamptz, integer, time) from public, anon, authenticated, service_role;
revoke execute on function private.cancel_deadline(integer, timestamptz) from public, anon, authenticated, service_role;
revoke execute on function private.local_week_start(date) from public, anon, authenticated, service_role;
revoke execute on function private.prep_day(timestamptz, integer) from public, anon, authenticated, service_role;
revoke execute on function private.normalize_phone(text) from public, anon, authenticated, service_role;
