-- Fix 15: the home page's promo banner (AD-16). A row only, without a
-- draft or published content: admin_set_content_draft needs the row (it
-- raises NOT_FOUND without it). The text arrives through the editor; the
-- shape is lib/content/schema.ts › promoBannerSchema. sort_order 1 ties the
-- hero; the site and the editor pick a section by its key, not its order.

insert into public.content_sections (page_slug, key, kind, sort_order)
values ('home', 'promo_banner', 'promo_banner', 1)
on conflict (page_slug, key) do nothing;
