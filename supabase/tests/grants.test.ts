// Story 1.4: every grant to an API role is explicit and listed here (AD-5).
// The comparison covers tables, views, sequences, columns and functions in
// public and private, and the private schema itself, for anon,
// authenticated, service_role and PUBLIC. An object with no ACL is read as
// its built-in default (acldefault), so a forgotten revoke shows up as well.
// Objects that belong to extensions are skipped.
//
// A new migration that grants something adds its line to EXPECTED_GRANTS in
// the same commit.

import { describe, expect, it } from "vitest"

import { inRollback, sql, type Db } from "./support/db"

const EXPECTED_GRANTS = [
  "column public.babies.birth_date authenticated INSERT",
  "column public.babies.birth_date authenticated UPDATE",
  "column public.babies.customer_id authenticated INSERT",
  "column public.babies.name authenticated INSERT",
  "column public.babies.name authenticated UPDATE",
  "column public.content_pages.published_at anon SELECT",
  "column public.content_pages.published_at authenticated SELECT",
  "column public.content_pages.published_content anon SELECT",
  "column public.content_pages.published_content authenticated SELECT",
  "column public.content_pages.published_version anon SELECT",
  "column public.content_pages.published_version authenticated SELECT",
  "column public.content_pages.slug anon SELECT",
  "column public.content_pages.slug authenticated SELECT",
  "column public.content_sections.id anon SELECT",
  "column public.content_sections.id authenticated SELECT",
  "column public.content_sections.key anon SELECT",
  "column public.content_sections.key authenticated SELECT",
  "column public.content_sections.kind anon SELECT",
  "column public.content_sections.kind authenticated SELECT",
  "column public.content_sections.page_slug anon SELECT",
  "column public.content_sections.page_slug authenticated SELECT",
  "column public.content_sections.published_at anon SELECT",
  "column public.content_sections.published_at authenticated SELECT",
  "column public.content_sections.published_content anon SELECT",
  "column public.content_sections.published_content authenticated SELECT",
  "column public.content_sections.sort_order anon SELECT",
  "column public.content_sections.sort_order authenticated SELECT",
  "column public.entitlement_movements.action authenticated SELECT",
  "column public.entitlement_movements.booking_id authenticated SELECT",
  "column public.entitlement_movements.created_at authenticated SELECT",
  "column public.entitlement_movements.entitlement_id authenticated SELECT",
  "column public.entitlement_movements.id authenticated SELECT",
  "column public.entitlement_movements.reverses_id authenticated SELECT",
  "column public.entitlement_movements.units authenticated SELECT",
  "column public.media_assets.alt_text anon SELECT",
  "column public.media_assets.alt_text authenticated SELECT",
  "column public.media_assets.focus_x anon SELECT",
  "column public.media_assets.focus_x authenticated SELECT",
  "column public.media_assets.focus_y anon SELECT",
  "column public.media_assets.focus_y authenticated SELECT",
  "column public.media_assets.id anon SELECT",
  "column public.media_assets.id authenticated SELECT",
  "column public.media_assets.public_path anon SELECT",
  "column public.media_assets.public_path authenticated SELECT",
  "column public.media_assets.publish_state anon SELECT",
  "column public.media_assets.publish_state authenticated SELECT",
  "column public.payments.amount_agorot authenticated SELECT",
  "column public.payments.created_at authenticated SELECT",
  "column public.payments.customer_id authenticated SELECT",
  "column public.payments.id authenticated SELECT",
  "column public.payments.paid_on authenticated SELECT",
  "column public.payments.product_id authenticated SELECT",
  "column public.payments.product_snapshot authenticated SELECT",
  "column public.payments.source authenticated SELECT",
  "column public.payments.status authenticated SELECT",
  "column public.profiles.dietary_notes authenticated UPDATE",
  "column public.profiles.full_name authenticated UPDATE",
  "function private.current_customer_id() authenticated EXECUTE",
  "function private.is_admin() authenticated EXECUTE",
  "function public.admin_approve_payment(p_customer_id uuid, p_payer_label text, p_product_id uuid, p_event_id uuid, p_amount_agorot integer, p_amount_override_reason text, p_paid_on date, p_payment_method_id uuid, p_reference text, p_note text, p_confirmed boolean, p_duplicate_confirmed boolean, p_idempotency_key uuid) authenticated EXECUTE",
  "function public.admin_begin_media_publish(p_media_id uuid, p_alt_text text, p_focus_x integer, p_focus_y integer) authenticated EXECUTE",
  "function public.admin_book_customer(p_customer_id uuid, p_event_id uuid, p_idempotency_key uuid) authenticated EXECUTE",
  "function public.admin_create_event(p_event jsonb, p_idempotency_key uuid) authenticated EXECUTE",
  "function public.admin_create_media(p_idempotency_key uuid) authenticated EXECUTE",
  "function public.admin_create_product(p_product jsonb, p_idempotency_key uuid) authenticated EXECUTE",
  "function public.admin_duplicate_event(p_event_id uuid, p_date date, p_start_time time without time zone, p_end_time time without time zone, p_idempotency_key uuid) authenticated EXECUTE",
  "function public.admin_finish_media_publish(p_media_id uuid) authenticated EXECUTE",
  "function public.admin_get_attention_items() authenticated EXECUTE",
  "function public.admin_get_content_page(p_slug text) authenticated EXECUTE",
  "function public.admin_get_event_details(p_event_id uuid) authenticated EXECUTE",
  "function public.admin_get_home() authenticated EXECUTE",
  "function public.admin_issue_link(p_purpose text, p_target_id uuid, p_idempotency_key uuid) authenticated EXECUTE",
  "function public.admin_list_bookable_events() authenticated EXECUTE",
  "function public.admin_list_links() authenticated EXECUTE",
  "function public.admin_list_payments() authenticated EXECUTE",
  "function public.admin_publish_content(p_slug text, p_idempotency_key uuid) authenticated EXECUTE",
  "function public.admin_publish_event(p_event_id uuid, p_idempotency_key uuid) authenticated EXECUTE",
  "function public.admin_revoke_link(p_token_id uuid, p_idempotency_key uuid) authenticated EXECUTE",
  "function public.admin_search_customers(p_query text) authenticated EXECUTE",
  "function public.admin_set_content_draft(p_slug text, p_key text, p_content jsonb) authenticated EXECUTE",
  "function public.admin_set_event_image(p_event_id uuid, p_media_id uuid) authenticated EXECUTE",
  "function public.admin_set_product_price(p_product_id uuid, p_price_agorot integer, p_reason text, p_confirmed boolean, p_idempotency_key uuid) authenticated EXECUTE",
  "function public.admin_update_event(p_event_id uuid, p_changes jsonb, p_idempotency_key uuid) authenticated EXECUTE",
  "function public.admin_update_product(p_product_id uuid, p_changes jsonb, p_idempotency_key uuid) authenticated EXECUTE",
  "function public.book_session(p_event_id uuid, p_idempotency_key uuid) authenticated EXECUTE",
  "function public.book_sessions(p_items uuid[], p_idempotency_key uuid) authenticated EXECUTE",
  "function public.claim_join(p_token text, p_idempotency_key uuid) authenticated EXECUTE",
  "function public.get_event_availability(p_event_ids uuid[]) authenticated EXECUTE",
  "function public.get_my_entitlements() authenticated EXECUTE",
  "function public.get_my_session_role() authenticated EXECUTE",
  "function public.issue_reset_token(p_user_id uuid) service_role EXECUTE",
  "function public.join_begin(p_token text, p_email text, p_phone text, p_idempotency_key uuid) service_role EXECUTE",
  "function public.join_complete(p_token text, p_profile jsonb, p_idempotency_key uuid) service_role EXECUTE",
  "function public.preview_admin_approve_payment(p_customer_id uuid, p_payer_label text, p_product_id uuid, p_event_id uuid, p_amount_agorot integer, p_paid_on date, p_payment_method_id uuid) authenticated EXECUTE",
  "function public.preview_admin_book_customer(p_customer_id uuid, p_event_id uuid) authenticated EXECUTE",
  "function public.preview_admin_set_product_price(p_product_id uuid, p_price_agorot integer) authenticated EXECUTE",
  "function public.preview_book_session(p_event_id uuid) authenticated EXECUTE",
  "function public.preview_book_sessions(p_items uuid[]) authenticated EXECUTE",
  "function public.reset_begin(p_token text, p_idempotency_key uuid) service_role EXECUTE",
  "function public.reset_complete(p_token text, p_idempotency_key uuid) service_role EXECUTE",
  "function public.token_view(p_token text) service_role EXECUTE",
  "schema private authenticated USAGE",
  "table public.admin_roles service_role INSERT",
  "table public.admin_roles service_role SELECT",
  "table public.audit_log authenticated SELECT",
  "table public.babies authenticated DELETE",
  "table public.babies authenticated SELECT",
  "table public.booking_allocations authenticated SELECT",
  "table public.bookings authenticated SELECT",
  "table public.business_settings authenticated SELECT",
  "table public.concepts anon SELECT",
  "table public.concepts authenticated SELECT",
  "table public.entitlements authenticated SELECT",
  "table public.events anon SELECT",
  "table public.events authenticated SELECT",
  "table public.notifications authenticated SELECT",
  "table public.payment_methods authenticated SELECT",
  "table public.products authenticated SELECT",
  "table public.profiles authenticated SELECT",
  "table public.profiles service_role INSERT",
  "table public.profiles service_role SELECT",
  "view public.entitlement_balances authenticated SELECT",
]

type Query = (text: string) => Promise<Array<Record<string, unknown>>>

// Runs on the pool, or on a transaction's client (inRollback).
const on =
  (db?: Db): Query =>
  async (text) =>
    db ? (await db.query(text)).rows : sql(text)

const API_ROLES = `
  roles as (
    select 0::oid as oid, 'PUBLIC' as role_name
    union all
    select oid, rolname from pg_roles
    where rolname in ('anon', 'authenticated', 'service_role')
  ),
  ext as (select objid from pg_depend where deptype = 'e')`

const ACTUAL_GRANTS = `
  with ${API_ROLES},
  rels as (
    select
      case c.relkind when 'S' then 'sequence' when 'v' then 'view'
        when 'm' then 'matview' else 'table' end as kind,
      n.nspname || '.' || c.relname as object_name,
      (aclexplode(coalesce(c.relacl, acldefault(
        case when c.relkind = 'S' then 's'::"char" else 'r'::"char" end,
        c.relowner)))).*
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private')
      and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
      and c.oid not in (select objid from ext)
  ),
  cols as (
    select
      'column' as kind,
      n.nspname || '.' || c.relname || '.' || a.attname as object_name,
      (aclexplode(a.attacl)).*
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private')
      and a.attacl is not null
      and not a.attisdropped
      and c.oid not in (select objid from ext)
  ),
  funcs as (
    select
      'function' as kind,
      n.nspname || '.' || p.proname
        || '(' || pg_get_function_identity_arguments(p.oid) || ')' as object_name,
      (aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner)))).*
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.oid not in (select objid from ext)
  ),
  schemas as (
    select
      'schema' as kind,
      n.nspname as object_name,
      (aclexplode(coalesce(n.nspacl, acldefault('n'::"char", n.nspowner)))).*
    from pg_namespace n
    where n.nspname = 'private'
  ),
  all_grants as (
    select * from rels
    union all select * from cols
    union all select * from funcs
    union all select * from schemas
  )
  select kind || ' ' || object_name || ' ' || role_name || ' ' || privilege_type as g
  from all_grants
  join roles on roles.oid = all_grants.grantee
  order by 1`

async function actualGrants(db?: Db): Promise<string[]> {
  const rows = await on(db)(ACTUAL_GRANTS)
  return rows.map((row) => row.g as string)
}

// A function is executable by anon or PUBLIC, or by more than one API role.
async function functionGrantViolations(db?: Db): Promise<string[]> {
  const rows = await on(db)(`
    with ${API_ROLES},
    grants as (
      select p.oid, n.nspname || '.' || p.proname as fn, roles.role_name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f'::"char", p.proowner))) acl
      join roles on roles.oid = acl.grantee
      where n.nspname in ('public', 'private')
        and p.oid not in (select objid from ext)
    )
    select fn || ': ' || string_agg(role_name, ',' order by role_name) as v
    from grants
    group by oid, fn
    having bool_or(role_name in ('anon', 'PUBLIC')) or count(*) > 1
    order by 1`)
  return rows.map((row) => row.v as string)
}

// Two functions with one name (a changed signature without drop).
async function duplicateFunctionNames(db?: Db): Promise<string[]> {
  const rows = await on(db)(`
    select n.nspname || '.' || p.proname as v
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.oid not in (select objid from pg_depend where deptype = 'e')
    group by 1
    having count(*) > 1
    order by 1`)
  return rows.map((row) => row.v as string)
}

// Default privileges of postgres (the role migrations run as), global or in
// public/private, that hand new objects to an API role or PUBLIC.
async function defaultAclViolations(db?: Db): Promise<string[]> {
  const rows = await on(db)(`
    with ${API_ROLES}
    , scoped as (
      select
        d.*,
        coalesce(
          (select n.nspname from pg_namespace n where n.oid = d.defaclnamespace),
          '<global>'
        ) as scope_name
      from pg_default_acl d
      where d.defaclrole = 'postgres'::regrole
    )
    select d.scope_name || ' ' || d.defaclobjtype::text
      || ' ' || roles.role_name || ' ' || acl.privilege_type as v
    from scoped d
    cross join lateral aclexplode(d.defaclacl) acl
    join roles on roles.oid = acl.grantee
    where d.scope_name in ('<global>', 'public', 'private')
    order by 1`)
  return rows.map((row) => row.v as string)
}

describe("grants", () => {
  it("match the explicit list", async () => {
    expect(await actualGrants()).toEqual(EXPECTED_GRANTS)
  })

  it("give every function at most one API role, never anon or PUBLIC", async () => {
    expect(await functionGrantViolations()).toEqual([])
  })

  it("have one function per name", async () => {
    expect(await duplicateFunctionNames()).toEqual([])
  })

  it("leave no default privileges for API roles", async () => {
    expect(await defaultAclViolations()).toEqual([])
    // Without this global entry PostgreSQL grants EXECUTE on every new
    // function to PUBLIC.
    const rows = await sql<{ n: number }>(`
      select count(*)::int as n from pg_default_acl d
      where d.defaclrole = 'postgres'::regrole
        and d.defaclnamespace = 0 and d.defaclobjtype = 'f'`)
    expect(rows[0].n).toBe(1)
  })
})

describe("grants check catches a mistake", () => {
  it("an unintended table grant", async () => {
    await inRollback(async (db) => {
      await db.query("grant select on public.audit_log to anon")
      expect(await actualGrants(db)).toContain(
        "table public.audit_log anon SELECT"
      )
      expect(await actualGrants(db)).not.toEqual(EXPECTED_GRANTS)
    })
  })

  it("an unintended column grant", async () => {
    await inRollback(async (db) => {
      await db.query("grant update (full_name) on public.profiles to anon")
      expect(await actualGrants(db)).toContain(
        "column public.profiles.full_name anon UPDATE"
      )
    })
  })

  it("an unintended sequence grant", async () => {
    await inRollback(async (db) => {
      await db.query("create sequence private.grants_check_seq")
      await db.query(
        "grant usage on sequence private.grants_check_seq to service_role"
      )
      expect(await actualGrants(db)).toContain(
        "sequence private.grants_check_seq service_role USAGE"
      )
    })
  })

  it("a function granted to anon", async () => {
    await inRollback(async (db) => {
      await db.query(
        "grant execute on function public.token_view(text) to anon"
      )
      expect(await functionGrantViolations(db)).toEqual([
        "public.token_view: anon,service_role",
      ])
    })
  })

  it("a function granted to two roles", async () => {
    await inRollback(async (db) => {
      await db.query(
        "grant execute on function public.get_my_session_role() to service_role"
      )
      expect(await functionGrantViolations(db)).toEqual([
        "public.get_my_session_role: authenticated,service_role",
      ])
    })
  })

  it("a function granted to PUBLIC", async () => {
    await inRollback(async (db) => {
      await db.query(
        "create function private.grants_check_fn() returns int language sql set search_path = '' as 'select 1'"
      )
      await db.query(
        "grant execute on function private.grants_check_fn() to public"
      )
      expect(await functionGrantViolations(db)).toEqual([
        "private.grants_check_fn: PUBLIC",
      ])
    })
  })

  it("an object with a NULL ACL, read through acldefault", async () => {
    await inRollback(async (db) => {
      // Restores PostgreSQL's built-in default, so the new function gets no
      // ACL at all (proacl is NULL) and executes for PUBLIC.
      await db.query(
        "alter default privileges for role postgres grant execute on functions to public"
      )
      await db.query(
        "create function private.grants_check_null_acl() returns int language sql set search_path = '' as 'select 1'"
      )
      const { rows } = await db.query(
        "select proacl is null as is_null from pg_proc where oid = 'private.grants_check_null_acl()'::regprocedure"
      )
      expect(rows[0].is_null).toBe(true)

      expect(await actualGrants(db)).toContain(
        "function private.grants_check_null_acl() PUBLIC EXECUTE"
      )
      expect(await functionGrantViolations(db)).toEqual([
        "private.grants_check_null_acl: PUBLIC",
      ])
    })
  })

  it("two functions with the same name", async () => {
    await inRollback(async (db) => {
      await db.query(
        "create function public.token_view(p_token text, p_extra int) returns jsonb language sql set search_path = '' as 'select null::jsonb'"
      )
      expect(await duplicateFunctionNames(db)).toEqual(["public.token_view"])
    })
  })

  it("default privileges that grant to an API role", async () => {
    await inRollback(async (db) => {
      await db.query(
        "alter default privileges for role postgres in schema public grant select on tables to anon"
      )
      expect(await defaultAclViolations(db)).toEqual(["public r anon SELECT"])
    })
  })
})
