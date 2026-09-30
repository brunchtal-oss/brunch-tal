-- Story 1.3 fix: private.normalize_phone.
-- 1. Israeli national numbers must have the exact length for their prefix:
--    mobile 5X and 7X (VoIP) are 9 digits, landlines 2, 3, 4, 8, 9 are 8
--    digits. Anything else is null.
-- 2. The strip class is written with \uXXXX regex escapes only (no invisible
--    characters in the source).

create or replace function private.normalize_phone(p_raw text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  with cleaned as (
    -- Removed before parsing:
    --   [:space:]      whitespace
    --   \u00a0         no-break space
    --   \u200b         zero-width space
    --   \u200e \u200f  left-to-right mark, right-to-left mark
    --   \u202a-\u202e  bidi embeddings and overrides (LRE, RLE, PDF, LRO, RLO)
    --   \u2066-\u2069  bidi isolates (LRI, RLI, FSI, PDI)
    --   \u2010-\u2015  hyphen and dash variants
    --   \u2212         minus sign
    --   . ( ) -        dot, parentheses, hyphen-minus
    select regexp_replace(
      p_raw,
      '[[:space:]\u00a0\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\u2010-\u2015\u2212.()-]',
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
        when regexp_replace(substr(intl, 4), '^0', '') ~ '^(5[0-9]{8}|7[0-9]{8}|[2-489][0-9]{7})$'
          then '+972' || regexp_replace(substr(intl, 4), '^0', '')
      end
    when intl is not null then
      case when intl ~ '^[1-9][0-9]{7,14}$' then '+' || intl end
    when v ~ '^0(5[0-9]{8}|7[0-9]{8}|[2-489][0-9]{7})$' then '+972' || substr(v, 2)
  end
  from international;
$$;

revoke execute on function private.normalize_phone(text) from public, anon, authenticated, service_role;
