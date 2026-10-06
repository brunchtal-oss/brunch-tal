-- Story 5.5, user decision 2026-10-06 (second phone check): the accessibility
-- statement is one text field (body, "## " lines are headings) plus the
-- required contact fields contact_name, contact_phone, contact_email
-- (lib/content/schema.ts). Rows only, draft and published alike: intro, the
-- three former required texts (each under its former heading), more, and the
-- address and note (under the contact heading) are joined into body, in the
-- page's former order. No new published_version: the wording is unchanged.

create function pg_temp.statement_body(p jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select concat_ws(
    E'\n\n',
    nullif(btrim(p ->> 'intro'), ''),
    E'## נגישות האתר\n\n' || nullif(btrim(p ->> 'conformance_level'), ''),
    E'## התאמות הנגישות באתר\n\n' || nullif(btrim(p ->> 'accessible'), ''),
    E'## מגבלות נגישות וקבלת סיוע\n\n' || nullif(btrim(p ->> 'limitations'), ''),
    nullif(btrim(p ->> 'more'), ''),
    E'## פנייה בנושא נגישות\n\n' || nullif(concat_ws(
      E'\n\n',
      'כתובת: ' || nullif(btrim(p ->> 'contact_address'), ''),
      nullif(btrim(p ->> 'contact_note'), '')
    ), '')
  )
$$;

create function pg_temp.statement_content(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null or p = '{}'::jsonb or p ? 'body' then p
    else jsonb_strip_nulls(jsonb_build_object(
      'body', nullif(pg_temp.statement_body(p), ''),
      'contact_name', p -> 'contact_name',
      'contact_phone', p -> 'contact_phone',
      'contact_email', p -> 'contact_email'
    ))
  end
$$;

update public.content_sections
set draft_content = pg_temp.statement_content(draft_content),
    published_content = pg_temp.statement_content(published_content),
    updated_at = now()
where page_slug = 'accessibility'
  and key = 'statement';
