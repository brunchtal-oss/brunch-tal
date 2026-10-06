-- Story 5.5, user decision 2026-10-06 (phone check): a legal text is edited as
-- one field to paste the whole wording into, a line starting with "## " being
-- a heading (lib/content/schema.ts, components/public/legal-text.tsx).
-- 1. privacy/body and terms/body: kind legal_sections -> legal_text,
--    {items: [{heading, body}]} -> {body}.
-- 2. accessibility/statement: intro_sections and more_sections (lists) ->
--    intro and more (one text each); the required fields do not change.
-- Rows only, draft and published alike, in the same wording (no new
-- published_version: the text the customer agreed to is unchanged).

create function pg_temp.legal_body(p_items jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select string_agg(
    '## ' || btrim(i.item ->> 'heading') || E'\n\n' || btrim(i.item ->> 'body'),
    E'\n\n'
    order by i.ord
  )
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
    with ordinality as i (item, ord)
$$;

update public.content_sections
set kind = 'legal_text',
    draft_content = case
      when draft_content ? 'items'
        then jsonb_build_object('body', pg_temp.legal_body(draft_content -> 'items'))
      else draft_content
    end,
    published_content = case
      when published_content ? 'items'
        then jsonb_build_object('body', pg_temp.legal_body(published_content -> 'items'))
      else published_content
    end,
    updated_at = now()
where page_slug in ('privacy', 'terms')
  and key = 'body'
  and kind = 'legal_sections';

update public.content_sections
set draft_content = case
      when draft_content is null or draft_content = '{}'::jsonb then draft_content
      else jsonb_strip_nulls(
        (draft_content - 'intro_sections' - 'more_sections')
        || jsonb_build_object(
          'intro', pg_temp.legal_body(draft_content -> 'intro_sections'),
          'more', pg_temp.legal_body(draft_content -> 'more_sections')
        )
      )
    end,
    published_content = case
      when published_content is null or published_content = '{}'::jsonb then published_content
      else jsonb_strip_nulls(
        (published_content - 'intro_sections' - 'more_sections')
        || jsonb_build_object(
          'intro', pg_temp.legal_body(published_content -> 'intro_sections'),
          'more', pg_temp.legal_body(published_content -> 'more_sections')
        )
      )
    end,
    updated_at = now()
where page_slug = 'accessibility'
  and key = 'statement';
