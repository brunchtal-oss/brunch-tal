import { describe, expect, it } from "vitest"

import {
  getPublicSession,
  listUpcomingPublicSessions,
  PUBLIC_SESSION_COLUMNS,
  toPublicSession,
} from "./public"

const ID = "6f1c2a52-6b7e-4c0e-9a51-3c1e5d0b2a11"

const ROW = {
  id: ID,
  starts_at: "2026-12-15T08:00:00+00:00",
  description: "session text",
  display_price_agorot: 13800,
  concepts: { name: "יווני", description: "concept text" },
}

// A stand-in for the anon client's query builder: records every call and
// resolves to `result`.
function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: [string, ...unknown[]][] = []
  const builder: Record<string, unknown> = {}
  for (const name of [
    "from",
    "select",
    "eq",
    "gt",
    "order",
    "limit",
    "maybeSingle",
  ]) {
    builder[name] = (...args: unknown[]) => {
      calls.push([name, ...args])
      return builder
    }
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result)
  return { client: builder as never, calls }
}

describe("PUBLIC_SESSION_COLUMNS", () => {
  it("selects only the public columns, never capacity or kind", () => {
    // Nested joins (the images) are dropped from the inside out.
    let flat = PUBLIC_SESSION_COLUMNS
    while (/\([^()]*\)/.test(flat)) flat = flat.replace(/\([^()]*\)/g, "")
    const top = flat.split(",").map((column) => column.trim())
    expect(top).toEqual([
      "id",
      "starts_at",
      "description",
      "display_price_agorot",
      "image:media_assets!events_image_id_fkey",
      "concepts",
    ])
    expect(PUBLIC_SESSION_COLUMNS).toContain("concepts(name, description,")
    // The images: only the display columns.
    expect(PUBLIC_SESSION_COLUMNS).toContain(
      "(public_path, alt_text, focus_x, focus_y)"
    )
    expect(PUBLIC_SESSION_COLUMNS).not.toMatch(
      /capacity|kind|status|bookings|availability/
    )
  })
})

describe("toPublicSession", () => {
  it("keeps the session's description over the concept's", () => {
    expect(toPublicSession(ROW)).toEqual({
      id: ID,
      starts_at: ROW.starts_at,
      description: "session text",
      display_price_agorot: 13800,
      concept_name: "יווני",
      photo: null,
    })
  })

  it("shows the session's photo, else the concept's (story 5.4)", () => {
    const media = (path: string) => ({
      public_path: path,
      alt_text: null,
      focus_x: 30,
      focus_y: 60,
    })
    const own = toPublicSession({ ...ROW, image: media("own.jpg") })
    expect(own.photo).toMatchObject({ photoAlt: "", focusX: 30, focusY: 60 })
    expect(own.photo?.photoUrl).toMatch(
      /\/storage\/v1\/object\/public\/media-public\/own\.jpg$/
    )
    const concept = toPublicSession({
      ...ROW,
      image: null,
      concepts: { ...ROW.concepts, default_image: media("concept.jpg") },
    })
    expect(concept.photo?.photoUrl).toMatch(/concept\.jpg$/)
  })

  it("falls back to the concept's description", () => {
    expect(toPublicSession({ ...ROW, description: null }).description).toBe(
      "concept text"
    )
    expect(toPublicSession({ ...ROW, description: "  " }).description).toBe(
      "concept text"
    )
  })

  it("has no description when neither has text", () => {
    expect(
      toPublicSession({
        ...ROW,
        description: null,
        concepts: { name: "יווני", description: null },
      }).description
    ).toBeNull()
  })

  it("keeps a missing display price as null", () => {
    expect(
      toPublicSession({ ...ROW, display_price_agorot: null })
        .display_price_agorot
    ).toBeNull()
  })
})

describe("listUpcomingPublicSessions", () => {
  it("reads published future sessions in order, up to the limit", async () => {
    const { client, calls } = fakeClient({ data: [ROW], error: null })
    const sessions = await listUpcomingPublicSessions(3, client)
    expect(sessions.map((s) => s.id)).toEqual([ID])
    expect(calls[0]).toEqual(["from", "events"])
    expect(calls[1]).toEqual(["select", PUBLIC_SESSION_COLUMNS])
    expect(calls).toContainEqual(["eq", "status", "published"])
    const gt = calls.find((call) => call[0] === "gt")
    expect(gt?.[1]).toBe("starts_at")
    expect(Date.parse(gt?.[2] as string)).not.toBeNaN()
    expect(calls.filter((call) => call[0] === "order")).toEqual([
      ["order", "starts_at"],
      ["order", "id"],
    ])
    expect(calls).toContainEqual(["limit", 3])
  })

  it("throws on a read error", async () => {
    const { client } = fakeClient({ data: null, error: { message: "x" } })
    await expect(listUpcomingPublicSessions(3, client)).rejects.toThrow()
  })
})

describe("getPublicSession", () => {
  it("returns null for an id that is not a UUID, without a read", async () => {
    const { client, calls } = fakeClient({ data: ROW, error: null })
    expect(await getPublicSession("not-a-uuid", client)).toBeNull()
    expect(calls).toEqual([])
  })

  it("reads one published future session", async () => {
    const { client, calls } = fakeClient({ data: ROW, error: null })
    expect((await getPublicSession(ID, client))?.concept_name).toBe("יווני")
    expect(calls).toContainEqual(["eq", "id", ID])
    expect(calls).toContainEqual(["eq", "status", "published"])
    expect(calls.some((call) => call[0] === "gt")).toBe(true)
  })

  it("returns null when no row matches (draft, cancelled, past, missing)", async () => {
    const { client } = fakeClient({ data: null, error: null })
    expect(await getPublicSession(ID, client)).toBeNull()
  })

  it("throws on a read error", async () => {
    const { client } = fakeClient({ data: null, error: { message: "x" } })
    await expect(getPublicSession(ID, client)).rejects.toThrow()
  })
})
