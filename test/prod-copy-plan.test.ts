import { describe, expect, it } from "vitest"

import {
  canon,
  compareColumns,
  EXCLUDED_CONCEPT_IDS,
  copyRow,
  mediaFiles,
  planTable,
  REFERENCED_MEDIA_SQL,
  refusedRows,
  rowHash,
  slotTarget,
  sourceFirst,
  TABLES,
  withoutExcluded,
} from "../scripts/prod-copy-plan.mjs"

// Story 6.1: the pure plan of the dev -> production content copy.
const spec = (name: string) => {
  const found = TABLES.find((t) => t.table === name)
  if (!found) throw new Error(name)
  return found
}

describe("TABLES", () => {
  it("never copies a customer, money, session or log table", () => {
    const names = TABLES.map((t) => t.table)
    for (const forbidden of [
      "events",
      "profiles",
      "bookings",
      "payments",
      "entitlements",
      "entitlement_movements",
      "cancellation_credits",
      "credit_options",
      "waitlist_entries",
      "notifications",
      "notification_jobs",
      "audit_log",
      "activation_tokens",
      "customer_notes",
      "notes",
      "work_sheets",
      "push_subscriptions",
      "marketing_tags",
    ]) {
      expect(names).not.toContain(forbidden)
    }
  })

  it("writes published_content_full and never published_content of a section", () => {
    const sections = spec("content_sections")
    expect(sections.copy).toContain("published_content_full")
    expect(sections.copy).toContain("draft_content")
    expect(sections.copy).not.toContain("published_content")
    expect(compareColumns(sections)).toContain("published_content")
  })

  it("ends with content_pages then content_sections (the write loop stops at pages)", () => {
    expect(TABLES.slice(-2).map((t) => t.table)).toEqual([
      "content_pages",
      "content_sections",
    ])
  })

  it("orders media before concepts and pages before sections", () => {
    const names = TABLES.map((t) => t.table)
    expect(names.indexOf("media_assets")).toBeLessThan(
      names.indexOf("concepts")
    )
    expect(names.indexOf("content_pages")).toBeLessThan(
      names.indexOf("content_sections")
    )
  })

  it("sets every user id column to null", () => {
    for (const t of TABLES) {
      for (const column of t.copy.filter((c: string) => /_by$/.test(c))) {
        expect(t.nullColumns ?? [], `${t.table}.${column}`).toContain(column)
      }
    }
    const row = copyRow(spec("content_pages"), {
      slug: "home",
      updated_by: "11111111-1111-1111-1111-111111111111",
      published_version: 3,
    })
    expect(row.updated_by).toBeNull()
    expect(row.published_version).toBe(3)
    expect(row.draft_content).toBeNull()
  })
})

describe("rowHash / canon", () => {
  it("ignores object key order, not array order", () => {
    expect(canon({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toEqual({
      a: { c: [3, { e: 0, f: 1 }], d: 2 },
      b: 1,
    })
    expect(rowHash({ x: { a: 1, b: 2 } }, ["x"])).toBe(
      rowHash({ x: { b: 2, a: 1 } }, ["x"])
    )
    expect(rowHash({ x: [1, 2] }, ["x"])).not.toBe(
      rowHash({ x: [2, 1] }, ["x"])
    )
  })
})

describe("planTable", () => {
  const products = spec("products")
  const row = (id: string, name: string) => ({ id, name, units: 4 })

  it("replace: inserts dev rows, updates changed ones, deletes seeds", () => {
    const plan = planTable(
      products,
      [row("a", "כרטיסייה"), row("b", "בודד"), row("c", "זוגי")],
      [row("b", "בודד"), row("c", "זוגי ישן"), row("seed", "seed")]
    )
    expect(plan.insert.map((r: { id: string }) => r.id)).toEqual(["a"])
    expect(plan.update.map((r: { id: string }) => r.id)).toEqual(["c"])
    expect(plan.delete.map((r: { id: string }) => r.id)).toEqual(["seed"])
    expect(plan.same).toBe(1)
  })

  it("a rerun after the copy changes nothing", () => {
    const rows = [row("a", "x"), row("b", "y")]
    const plan = planTable(products, rows, rows)
    expect(
      [plan.insert, plan.update, plan.delete].map((l) => l.length)
    ).toEqual([0, 0, 0])
    expect(plan.same).toBe(2)
  })

  it("update: never inserts or deletes, reports a one-sided row", () => {
    const templates = spec("notification_templates")
    const plan = planTable(
      templates,
      [
        { type: "a", title: "new", body: null, push: true },
        { type: "only_dev", title: "x", body: null, push: true },
      ],
      [
        { type: "a", title: "old", body: null, push: true },
        { type: "only_prod", title: "y", body: null, push: false },
      ]
    )
    expect(plan.insert).toEqual([])
    expect(plan.delete).toEqual([])
    expect(plan.update.map((r: { type: string }) => r.type)).toEqual(["a"])
    expect(plan.unmatched).toEqual(["only_dev", "only_prod"])
  })

  it("add (media): never deletes a production row", () => {
    const plan = planTable(spec("media_assets"), [], [{ id: "tal-upload" }])
    expect(plan.delete).toEqual([])
    expect(plan.unmatched).toEqual([])
  })

  it("matches sections by page and key, not by id", () => {
    const sections = spec("content_sections")
    const plan = planTable(
      sections,
      [{ id: "dev-id", page_slug: "home", key: "hero", kind: "hero" }],
      [{ id: "prod-id", page_slug: "home", key: "hero", kind: "hero" }]
    )
    expect(plan.same).toBe(1)
  })

  it("a dev user id still in production counts as a change", () => {
    const pages = spec("content_pages")
    const plan = planTable(
      pages,
      [{ slug: "home", updated_by: null }],
      [{ slug: "home", updated_by: "u" }]
    )
    expect(plan.update).toHaveLength(1)
  })
})

describe("refusedRows", () => {
  it("refuses a test_ key and any mention of video.example.com", () => {
    expect(
      refusedRows(spec("products"), [
        { id: "1", name: "test_ab12_card" },
        { id: "2", name: "כרטיסייה" },
        { id: "3", name: "x", post_join_message: "michal@video.example.com" },
      ])
    ).toEqual(["products 1 (test_)", "products 3 (video.example.com)"])
    expect(
      refusedRows(spec("content_sections"), [
        { page_slug: "home", key: "test_x_hero" },
        {
          page_slug: "home",
          key: "hero",
          draft_content: { a: "Video.Example.COM" },
        },
      ])
    ).toHaveLength(2)
  })

  it("lets real content through", () => {
    expect(
      refusedRows(spec("content_pages"), [
        { slug: "privacy", draft_content: { text: "test of the policy" } },
      ])
    ).toEqual([])
  })
})

describe("sourceFirst / mediaFiles", () => {
  it("puts a source before its copies", () => {
    const ordered = sourceFirst([
      { id: "copy2", source_id: "orig" },
      { id: "copy1", source_id: "orig" },
      { id: "orig", source_id: null },
    ])
    expect(ordered.map((r: { id: string }) => r.id)).toEqual([
      "orig",
      "copy2",
      "copy1",
    ])
  })

  it("throws on a missing source", () => {
    expect(() => sourceFirst([{ id: "a", source_id: "gone" }])).toThrow(/gone/)
  })

  it("copies the draft file always and the public file only when published", () => {
    const row = { id: "m", storage_path: "m", public_path: "m.jpg" }
    expect(mediaFiles({ ...row, publish_state: "published" })).toEqual([
      { bucket: "media-drafts", name: "m", id: "m" },
      { bucket: "media-public", name: "m.jpg", id: "m" },
    ])
    expect(mediaFiles({ ...row, publish_state: "hidden" })).toEqual([
      { bucket: "media-drafts", name: "m", id: "m" },
    ])
  })
})

describe("slotTarget", () => {
  const dev = [
    { id: "b", body: "שתפי סטורי", sort_order: 2 },
    { id: "a", body: "פוסט אחד", sort_order: 1 },
  ]

  it("moves a seed's slot to the dev text with the same body", () => {
    expect(slotTarget(dev, { id: "seed", body: "שתפי סטורי" })?.id).toBe("b")
  })

  it("else to the dev text with the lowest sort_order", () => {
    expect(slotTarget(dev, { id: "seed", body: "נוסח אחר" })?.id).toBe("a")
  })

  it("returns null when dev has no text", () => {
    expect(slotTarget([], { id: "seed", body: "x" })).toBeNull()
  })
})

describe("withoutExcluded (user decision 2026-11-10: five concepts only)", () => {
  const concepts = TABLES.find((t) => t.table === "concepts")!
  const products = TABLES.find((t) => t.table === "products")!

  it("drops the excluded dev concepts and keeps the rest", () => {
    const rows = [
      { id: EXCLUDED_CONCEPT_IDS[0] },
      { id: "keep" },
      { id: EXCLUDED_CONCEPT_IDS[1] },
    ]
    expect(withoutExcluded(concepts, rows)).toEqual([{ id: "keep" }])
  })

  it("leaves other tables alone", () => {
    const rows = [{ id: EXCLUDED_CONCEPT_IDS[0] }]
    expect(withoutExcluded(products, rows)).toEqual(rows)
  })

  it("still copies an excluded concept's image (the user, 2026-11-10)", () => {
    for (const id of EXCLUDED_CONCEPT_IDS) {
      expect(REFERENCED_MEDIA_SQL).not.toContain(id)
    }
    expect(REFERENCED_MEDIA_SQL).toContain("c.default_image_id = m.id")
  })
})
