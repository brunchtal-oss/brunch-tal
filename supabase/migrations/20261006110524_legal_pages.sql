-- Story 5.5: privacy policy, accessibility statement and terms of use
-- (CAP-29, CAP-33, AD-16, AD-22).
-- 1. Rows only: the pages accessibility and terms (not published, version 0)
--    and one block per legal page, without a draft. The wording arrives
--    through the editor; nothing legal is written here. The shape of each
--    kind is in lib/content/schema.ts (legal_sections,
--    accessibility_statement).
-- 2. admin_get_attention_items(): the body of 20261005225116 with all six
--    kinds unchanged, plus accessibility_unpublished while the statement was
--    never published (AD-22; 5.5 is the second extension, after 5.4's
--    media_stuck). join_complete and set_photo_consent already read
--    published_version at save time and do not change.

insert into public.content_pages (slug)
values ('accessibility'), ('terms');

insert into public.content_sections (page_slug, key, kind, sort_order)
values
  ('privacy', 'body', 'legal_sections', 1),
  ('terms', 'body', 'legal_sections', 1),
  ('accessibility', 'statement', 'accessibility_statement', 1);

-- "To handle" (stories 4.1, 5.5). Result: as in 20261005225116, plus
--   accessibility_unpublished id = 'accessibility' (the page slug)
-- since: the page's creation. Disappears on the first publish.
create or replace function public.admin_get_attention_items()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  with
  join_links as (
    select t.*, private.join_link_status(t) as link_status
    from public.activation_tokens t
    where t.purpose = 'join'
  ),
  pay as (
    select
      p.id,
      p.customer_id,
      p.status,
      p.amount_agorot,
      p.paid_on,
      p.created_at,
      p.product_snapshot ->> 'name' as product_name,
      coalesce(nullif(btrim(pr.full_name), ''), p.payer_label) as customer_label
    from public.payments p
    left join public.profiles pr on pr.id = p.customer_id
  ),
  items as (
    -- A link stopped in a conflict (any reason, bind_conflict too).
    select
      coalesce(l.claiming_at, l.created_at) as since,
      l.id,
      jsonb_build_object(
        'kind', 'link_conflict',
        'id', l.id,
        'customer_label', p.customer_label,
        'since', coalesce(l.claiming_at, l.created_at),
        'payment_id', p.id,
        'conflict_reason', l.conflict_reason,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      ) as item
    from join_links l
    join pay p on p.id = l.payment_id
    where l.link_status = 'conflict'

    union all

    -- A join stuck in claiming for more than 15 minutes.
    select
      l.claiming_at,
      l.id,
      jsonb_build_object(
        'kind', 'link_stuck',
        'id', l.id,
        'customer_label', p.customer_label,
        'since', l.claiming_at,
        'payment_id', p.id,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      )
    from join_links l
    join pay p on p.id = l.payment_id
    where l.link_status = 'stuck'

    union all

    -- An approved purchase not bound to a customer whose links were all
    -- revoked or expired (or that has none): no live link, no conflict.
    select
      w.since,
      p.id,
      jsonb_build_object(
        'kind', 'purchase_without_link',
        'id', p.id,
        'customer_label', p.customer_label,
        'since', w.since,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on
      )
    from pay p
    cross join lateral (
      select coalesce(
        max(case when l.link_status = 'revoked' then l.revoked_at else l.expires_at end),
        p.created_at
      ) as since
      from join_links l
      where l.payment_id = p.id
    ) w
    where p.status = 'approved'
      and p.customer_id is null
      and not exists (
        select 1
        from join_links l
        where l.payment_id = p.id
          and l.link_status not in ('revoked', 'expired')
      )

    union all

    -- Paid without a place (3.11 'park'): an active pinned entitlement with
    -- no booking on its payment.
    select
      e.created_at,
      e.id,
      jsonb_build_object(
        'kind', 'paid_without_place',
        'id', e.id,
        'customer_label', p.customer_label,
        'since', e.created_at,
        'payment_id', p.id,
        'product_name', p.product_name,
        'amount_agorot', p.amount_agorot,
        'paid_on', p.paid_on,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.entitlements e
    join pay p on p.id = e.payment_id
    join public.events ev on ev.id = e.pinned_event_id
    join public.concepts c on c.id = ev.concept_id
    where e.status = 'active'
      and e.pinned_event_id is not null
      and not exists (
        select 1 from public.bookings b where b.payment_id = e.payment_id
      )

    union all

    -- A pinned booking without a customer still holding a place after its
    -- join ended in bind_conflict, while the session has not ended. Released
    -- on the session page (admin_cancel_booking, 3.6).
    select
      s.since,
      b.id,
      jsonb_build_object(
        'kind', 'pinned_seat_held',
        'id', b.id,
        'customer_label', p.customer_label,
        'since', s.since,
        'payment_id', p.id,
        'event_id', ev.id,
        'concept_name', c.name,
        'starts_at', ev.starts_at
      )
    from public.bookings b
    join pay p on p.id = b.payment_id
    join public.events ev on ev.id = b.event_id
    join public.concepts c on c.id = ev.concept_id
    cross join lateral (
      select max(coalesce(l.claiming_at, l.created_at)) as since
      from join_links l
      where l.payment_id = b.payment_id
        and l.link_status = 'conflict'
        and l.conflict_reason = 'bind_conflict'
    ) s
    where b.status = 'confirmed'
      and b.customer_id is null
      and ev.ends_at > now()
      and s.since is not null
      and not exists (
        select 1
        from join_links l
        where l.payment_id = b.payment_id
          and l.link_status in ('pending', 'awaiting_login', 'claiming', 'stuck')
      )

    union all

    -- An image stuck in copying for 15 minutes or more (5.4); publishing the
    -- page again continues from the stored state.
    select
      m.publish_started_at,
      m.id,
      jsonb_build_object(
        'kind', 'media_stuck',
        'id', m.id,
        'customer_label', null,
        'since', m.publish_started_at
      )
    from public.media_assets m
    where m.publish_state = 'copying'
      and m.publish_started_at <= now() - interval '15 minutes'

    union all

    -- The accessibility statement was never published (5.5, AD-22). The
    -- column id is uuid in every branch; the item's id is the page slug.
    select
      cp.created_at,
      null::uuid,
      jsonb_build_object(
        'kind', 'accessibility_unpublished',
        'id', cp.slug,
        'customer_label', null,
        'since', cp.created_at
      )
    from public.content_pages cp
    where cp.slug = 'accessibility'
      and cp.published_at is null
  )
  select coalesce(
    jsonb_agg(i.item order by i.since desc, i.id),
    '[]'::jsonb
  )
  into v_result
  from items i;

  return v_result;
end;
$$;

revoke execute on function public.admin_get_attention_items() from public, anon, authenticated, service_role;
grant execute on function public.admin_get_attention_items() to authenticated;
