-- Story 5.23: the cookie notice of the public site (AD-16). Rows only,
-- without a draft or published content: admin_set_content_draft needs the
-- rows (it raises NOT_FOUND without them). The wording arrives through the
-- editor; the shape is lib/content/schema.ts › cookieNoticeSchema. The site
-- reads it with getPublishedSections('cookie-notice') (tag
-- content:cookie-notice). No schema change.

insert into public.content_pages (slug)
values ('cookie-notice')
on conflict (slug) do nothing;

insert into public.content_sections (page_slug, key, kind, sort_order)
values ('cookie-notice', 'notice', 'cookie_notice', 1)
on conflict (page_slug, key) do nothing;
