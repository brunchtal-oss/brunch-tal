-- Fix fix-public-read-leaks, review: one SELECT policy per role on
-- public.concepts (performance advisor multiple_permissive_policies), as
-- events_anon_select / events_authenticated_select. Nothing is dropped.
-- anon: an active concept, or an archived one that a session that is not a
-- draft shows. authenticated: the same, or every concept for the admin.

alter policy concepts_public_select on public.concepts
  to anon;

alter policy concepts_admin_select on public.concepts
  using (
    archived_at is null
    or exists (
      select 1
      from public.events e
      where e.concept_id = concepts.id
        and e.status <> 'draft'
    )
    or (select private.is_admin())
  );

alter policy concepts_public_select on public.concepts
  rename to concepts_anon_select;

alter policy concepts_admin_select on public.concepts
  rename to concepts_authenticated_select;

comment on column public.content_sections.published_content_full is
  'The whole published content, hidden content included. Read only by admin RPCs; published_content is its public copy (trigger content_sections_public_copy). A data migration transforms published_content_full, never published_content: a write of published_content alone becomes the full copy, so rewriting published_content from itself would lose hidden content for good.';
