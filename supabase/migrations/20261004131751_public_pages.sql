-- Story 5.2: the static public pages (AD-15, AD-16). Rows only: the pages
-- and their sections, not published and without a draft. The shape of each
-- kind is in lib/content/schema.ts; the content arrives through the editor
-- (5.3) or, in the dev project, as made-up rows.
-- home/intro and home/contact leave sort_order room for the sessions area
-- (3.2) between them. contact/intro comes before contact/business_details.

insert into public.content_pages (slug)
values ('about'), ('how-it-works'), ('gallery'), ('site');

insert into public.content_sections (page_slug, key, kind, sort_order)
values
  ('home', 'intro', 'text_block', 2),
  ('home', 'contact', 'text_block', 5),
  ('about', 'main', 'text_block', 1),
  ('how-it-works', 'steps', 'steps', 1),
  ('how-it-works', 'faq', 'faq', 2),
  ('gallery', 'testimonials', 'testimonials', 1),
  ('contact', 'intro', 'text_block', 0),
  ('site', 'footer', 'footer', 1);
