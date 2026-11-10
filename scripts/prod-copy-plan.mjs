// Story 6.1: the pure part of the dev -> production content copy
// (prod-copy-content.mjs) and of its comparison (prod-check.mjs): which
// tables, which columns, how rows are matched, what is refused. No env, no
// network; tested in test/prod-copy-plan.test.ts.

import { createHash } from "node:crypto"

/**
 * The copied tables, in write order (a referenced row before its
 * referrer). key: the columns a dev row is matched by in production.
 * copy: the columns written (nullColumns are written as null: dev user ids
 * mean nothing in production). compare: the columns prod-check hashes.
 * mode: "replace" -> production ends with exactly the dev rows (migration
 * seeds with other ids are deleted); "update" -> the rows exist on both
 * sides (same migrations) and only the copy columns change; "add" -> rows
 * are inserted or updated, never deleted (media: only the referenced ones
 * are copied).
 */
export const TABLES = [
  {
    table: "media_assets",
    key: ["id"],
    copy: [
      "id",
      "storage_path",
      "public_path",
      "alt_text",
      "focus_x",
      "focus_y",
      "publish_state",
      "publish_started_at",
      "published_at",
      "source_id",
      "created_by",
    ],
    nullColumns: ["created_by"],
    compare: [
      "id",
      "storage_path",
      "public_path",
      "alt_text",
      "focus_x",
      "focus_y",
      "publish_state",
      "published_at",
      "source_id",
    ],
    mode: "add",
  },
  {
    table: "concepts",
    key: ["id"],
    copy: [
      "id",
      "name",
      "description",
      "default_kind",
      "theme_key",
      "generic_paper_key",
      "default_image_id",
      "archived_at",
      "sort_order",
    ],
    textKeys: ["name"],
    mode: "replace",
  },
  {
    table: "products",
    key: ["id"],
    copy: [
      "id",
      "name",
      "type",
      "units",
      "validity_mode",
      "validity_days",
      "price_agorot",
      "active",
      "intro_only",
      "party_size",
      "eligible_event_kind",
      "allowed_weekdays",
      "post_join_message",
      "post_join_button_label",
    ],
    textKeys: ["name"],
    mode: "replace",
  },
  {
    table: "payment_methods",
    key: ["id"],
    copy: ["id", "name", "sort_order", "hidden"],
    textKeys: ["name"],
    mode: "replace",
  },
  {
    table: "marketing_reminder_texts",
    key: ["id"],
    copy: ["id", "body", "sort_order", "active"],
    textKeys: ["body"],
    mode: "replace",
  },
  {
    table: "notification_templates",
    key: ["type"],
    copy: ["type", "title", "body", "push", "updated_by"],
    nullColumns: ["updated_by"],
    compare: ["type", "title", "body", "push"],
    textKeys: ["type"],
    mode: "update",
  },
  {
    table: "business_settings",
    key: ["id"],
    copy: [
      "id",
      "admin_expiring_days",
      "cancel_window_hours",
      "credit_expiring_days",
      "credit_options_count",
      "customer_expiring_days",
      "default_capacity_couple",
      "default_capacity_regular",
      "default_prep_days",
      "default_session_end_time",
      "default_session_start_time",
      "default_validity_days",
      "duplicate_payment_window_days",
      "inactivity_months",
      "last_places_threshold",
      "marketing_reminder_schedule",
      "registration_close_days_before",
      "registration_close_local_time",
      "reminder_lead_hours",
    ],
    mode: "update",
  },
  {
    table: "content_pages",
    key: ["slug"],
    copy: [
      "slug",
      "draft_content",
      "published_content",
      "published_at",
      "published_version",
      "updated_by",
    ],
    nullColumns: ["updated_by"],
    compare: [
      "slug",
      "draft_content",
      "published_content",
      "published_at",
      "published_version",
    ],
    textKeys: ["slug"],
    mode: "replace",
  },
  {
    // published_content is never written: the trigger
    // content_sections_public_copy derives it from published_content_full.
    table: "content_sections",
    key: ["page_slug", "key"],
    copy: [
      "page_slug",
      "key",
      "kind",
      "sort_order",
      "hidden",
      "draft_content",
      "published_content_full",
      "published_at",
      "updated_by",
    ],
    nullColumns: ["updated_by"],
    compare: [
      "page_slug",
      "key",
      "kind",
      "sort_order",
      "hidden",
      "draft_content",
      "published_content_full",
      "published_content",
      "published_at",
    ],
    textKeys: ["page_slug", "key"],
    mode: "replace",
  },
]

/** The columns prod-check compares (copy minus the null columns). */
export function compareColumns(spec) {
  return (
    spec.compare ??
    spec.copy.filter((c) => !(spec.nullColumns ?? []).includes(c))
  )
}

/** A value with object keys sorted, recursively (a stable JSON form). */
export function canon(value) {
  if (Array.isArray(value)) return value.map(canon)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canon(value[k])])
    )
  }
  return value === undefined ? null : value
}

/** The match key of a row: its key columns, joined. */
export function keyOf(spec, row) {
  return spec.key.map((c) => String(row[c])).join("|")
}

/** sha256 of the given columns of a row (stable form). */
export function rowHash(row, columns) {
  return createHash("sha256")
    .update(JSON.stringify(columns.map((c) => canon(row[c]))))
    .digest("hex")
}

/** The row as written: the copy columns, null columns set to null. */
export function copyRow(spec, row) {
  return Object.fromEntries(
    spec.copy.map((c) => [
      c,
      (spec.nullColumns ?? []).includes(c) ? null : (row[c] ?? null),
    ])
  )
}

/**
 * The plan for one table: dev rows to insert, dev rows to update (they
 * exist in production with other values), production rows to delete
 * ("replace" only), and production rows a dev row is missing for in an
 * "update" table (`unmatched`, never written).
 */
export function planTable(spec, devRows, prodRows) {
  const columns = spec.copy.filter((c) => !(spec.nullColumns ?? []).includes(c))
  const prodByKey = new Map(prodRows.map((row) => [keyOf(spec, row), row]))
  const devKeys = new Set(devRows.map((row) => keyOf(spec, row)))
  const plan = { insert: [], update: [], delete: [], same: 0, unmatched: [] }
  for (const row of devRows) {
    const prod = prodByKey.get(keyOf(spec, row))
    if (!prod) {
      if (spec.mode === "update") plan.unmatched.push(keyOf(spec, row))
      else plan.insert.push(row)
    } else if (
      rowHash(row, columns) !== rowHash(prod, columns) ||
      (spec.nullColumns ?? []).some((c) => prod[c] != null)
    ) {
      plan.update.push(row)
    } else {
      plan.same += 1
    }
  }
  for (const row of prodRows) {
    if (devKeys.has(keyOf(spec, row))) continue
    if (spec.mode === "replace") plan.delete.push(row)
    else if (spec.mode === "update") plan.unmatched.push(keyOf(spec, row))
  }
  return plan
}

const VIDEO_MARK = "video.example.com"

/**
 * The rows that must never reach production: a text key that starts with
 * test_, or any value that mentions video.example.com. Returns
 * "<table> <key>" descriptions.
 */
export function refusedRows(spec, rows) {
  const out = []
  for (const row of rows) {
    const testKey = (spec.textKeys ?? []).some(
      (c) =>
        typeof row[c] === "string" &&
        row[c].trim().toLowerCase().startsWith("test_")
    )
    const video = JSON.stringify(row).toLowerCase().includes(VIDEO_MARK)
    if (testKey || video) {
      out.push(
        `${spec.table} ${keyOf(spec, row)}${video ? ` (${VIDEO_MARK})` : " (test_)"}`
      )
    }
  }
  return out
}

/**
 * Media rows ordered so a row's source_id comes before it. Throws on a
 * source that is not in the set or on a cycle.
 */
export function sourceFirst(rows) {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const done = new Set()
  const out = []
  const visit = (row, path) => {
    if (done.has(row.id)) return
    if (path.has(row.id)) throw new Error(`source_id cycle at ${row.id}`)
    if (row.source_id) {
      const source = byId.get(row.source_id)
      if (!source)
        throw new Error(
          `source ${row.source_id} of ${row.id} is not in the set`
        )
      visit(source, new Set([...path, row.id]))
    }
    done.add(row.id)
    out.push(row)
  }
  for (const row of rows) visit(row, new Set())
  return out
}

/**
 * The Storage files of a media row: the draft always, the public copy
 * while it is published. [{ bucket, name, id }]
 */
export function mediaFiles(row) {
  const files = [{ bucket: "media-drafts", name: row.storage_path, id: row.id }]
  if (row.publish_state === "published") {
    files.push({ bucket: "media-public", name: row.public_path, id: row.id })
  }
  return files
}

/**
 * The dev reminder text a production slot of a deleted seed moves to: the
 * dev text with the same body, else the one with the lowest sort_order
 * (then id). null when dev has no text.
 */
export function slotTarget(devTexts, seed) {
  const same = devTexts.find((d) => d.body === seed.body)
  if (same) return same
  const sorted = [...devTexts].sort(
    (a, b) =>
      a.sort_order - b.sort_order || String(a.id).localeCompare(String(b.id))
  )
  return sorted[0] ?? null
}

/**
 * Dev concepts that never reach production (user decision 2026-11-10: only
 * the five concepts אמהות בחל״ד, יווני, זוגות, עם סבתוש, עם סבוש). The
 * dev ids of 60+ (archived) and פרסי. Their default images are still copied
 * (the user, 2026-11-10: the 60+ image stays available in production).
 */
export const EXCLUDED_CONCEPT_IDS = [
  "b55d8ca1-4308-4bf6-a7d5-6576e9cb806e",
  "64bc9f15-045c-4a01-9a2b-3d5466622dd0",
]

/** Dev rows without the ones that never reach production. */
export function withoutExcluded(spec, rows) {
  if (spec.table !== "concepts") return rows
  return rows.filter((row) => !EXCLUDED_CONCEPT_IDS.includes(row.id))
}

/** The production tables whose rows block the copy. */
export const BLOCKING_TABLES = [
  "profiles",
  "events",
  "payments",
  "entitlements",
  "bookings",
]

/**
 * The SQL (dev or prod) of the media ids a copied row references: any
 * media id inside the draft or full published content of a section, the
 * content of a page, or a concept's default image, plus their source_id
 * chain. Returns rows { id }.
 */
export const REFERENCED_MEDIA_SQL = `
  with recursive direct as (
    select m.id
    from public.media_assets m
    where exists (
        select 1 from public.content_sections s
        where strpos(coalesce(s.draft_content::text, ''), m.id::text) > 0
           or strpos(coalesce(s.published_content_full::text, ''), m.id::text) > 0
      )
      or exists (
        select 1 from public.content_pages p
        where strpos(coalesce(p.draft_content::text, ''), m.id::text) > 0
           or strpos(coalesce(p.published_content::text, ''), m.id::text) > 0
      )
      or exists (
        select 1 from public.concepts c
        where c.default_image_id = m.id
      )
  ),
  chain as (
    select d.id from direct d
    union
    select m.source_id
    from chain c
    join public.media_assets m on m.id = c.id
    where m.source_id is not null
  )
  select distinct id from chain`
