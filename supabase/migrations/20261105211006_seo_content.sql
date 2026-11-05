-- fix-seo-editor: the content editor's SEO page (AD-16). One page, slug
-- 'seo', with the site's share image (key 'site', kind seo_site) and one
-- record per public page (kind page_seo): its H1, Google title, description
-- and share image. The shapes are lib/content/schema.ts › seoSiteSchema and
-- pageSeoSchema; the site reads them with getPublishedPage('seo') (tag
-- content:seo) and falls back to the same values in code.
--
-- Seeded published, draft = published = full copy, with the H1s the site
-- shows today (lib/seo/page-seo.ts › DEFAULT_H1; the home page: the
-- published business name, else the wordmark), so nothing on the site
-- changes until the admin edits. Version 0, like the other seeds. No schema
-- change; on conflict do nothing, so a rerun keeps what was edited.

insert into public.content_pages (slug, published_content, published_at, published_version)
values ('seo', '{}'::jsonb, now(), 0)
on conflict (slug) do nothing;

-- published_content_full is the full copy; the trigger
-- content_sections_public_copy derives published_content from it.
insert into public.content_sections (
  page_slug, key, kind, sort_order, draft_content, published_content_full, published_at
)
select 'seo', s.key, s.kind, s.sort_order, s.content, s.content, now()
from (
  values
    ('site', 'seo_site', 1, '{}'::jsonb),
    ('home', 'page_seo', 2, jsonb_build_object('h1', coalesce(
      (
        select nullif(btrim(c.published_content_full ->> 'business_name'), '')
        from public.content_sections c
        where c.page_slug = 'contact' and c.key = 'business_details'
      ),
      'בראנץ׳ אצל טל'
    ))),
    ('sessions', 'page_seo', 3, jsonb_build_object('h1', 'לו״ז בראנצ׳ים')),
    ('how_it_works', 'page_seo', 4, jsonb_build_object('h1', 'איך זה עובד ושאלות נפוצות')),
    ('gallery', 'page_seo', 5, jsonb_build_object('h1', 'גלריה והמלצות')),
    ('contact', 'page_seo', 6, jsonb_build_object('h1', 'יצירת קשר')),
    ('privacy', 'page_seo', 7, jsonb_build_object('h1', 'מדיניות פרטיות')),
    ('terms', 'page_seo', 8, jsonb_build_object('h1', 'תנאי שימוש')),
    ('accessibility', 'page_seo', 9, jsonb_build_object('h1', 'הצהרת נגישות'))
) as s (key, kind, sort_order, content)
on conflict (page_slug, key) do nothing;
