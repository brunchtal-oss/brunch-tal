-- Story 2.2 review fixes (AD-16).
-- 1. A published section is visible only while its page is published too, so
--    a section added to an unpublished page (privacy) stays hidden.
-- 2. content_sections gets the same "object" checks as content_pages.

alter policy content_sections_public_select on public.content_sections
  using (
    published_content is not null
    and not hidden
    and exists (
      select 1
      from public.content_pages p
      where p.slug = page_slug
        and p.published_content is not null
    )
  );

alter table public.content_sections
  add constraint content_sections_draft_content_check
    check (draft_content is null or jsonb_typeof(draft_content) = 'object'),
  add constraint content_sections_published_content_check
    check (published_content is null or jsonb_typeof(published_content) = 'object');
