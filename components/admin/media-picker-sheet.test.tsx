import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { MediaChoice } from "@/app/admin/(shell)/media/actions"
import { adminCopy } from "@/lib/copy/admin"
import { ERROR_MESSAGES } from "@/lib/errors"

import { chosenValue } from "./image-upload-field"
import {
  chosenFrom,
  keyFor,
  matchesSearch,
  PickerBody,
  Tile,
  type Load,
} from "./media-picker-sheet"

const net = { online: true }
vi.mock("@/lib/use-online", () => ({ useOnline: () => net.online }))
vi.mock("@/app/admin/(shell)/media/actions", () => ({
  listMediaAction: vi.fn(),
  copyMediaAction: vi.fn(),
}))

const copy = adminCopy.image
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TABLE: MediaChoice = {
  id: "11111111-1111-4111-8111-111111111111",
  url: "https://x.example/storage/v1/object/public/media-public/table.jpg",
  alt: "שולחן בראנץ\u05F3 ערוך",
  focusX: 20,
  focusY: 70,
}
const NO_ALT: MediaChoice = {
  id: "22222222-2222-4222-8222-222222222222",
  url: "https://x.example/storage/v1/object/public/media-public/plain.jpg",
  alt: "",
  focusX: 50,
  focusY: 50,
}

function body(
  load: Load,
  values: Partial<React.ComponentProps<typeof PickerBody>> = {}
) {
  return renderToStaticMarkup(
    <PickerBody
      load={load}
      query=""
      onQuery={vi.fn()}
      problem={null}
      busyId={null}
      onChoose={vi.fn()}
      onRetry={vi.fn()}
      {...values}
    />
  )
}

const READY: Load = { state: "ready", items: [TABLE, NO_ALT] }

beforeEach(() => {
  net.online = true
})

describe("matchesSearch", () => {
  it("matches every word of the query in the alt text", () => {
    expect(matchesSearch(TABLE, "")).toBe(true)
    expect(matchesSearch(TABLE, "  שולחן  ערוך ")).toBe(true)
    expect(matchesSearch(TABLE, "שולחן גלידה")).toBe(false)
    expect(matchesSearch(NO_ALT, "שולחן")).toBe(false)
    expect(
      matchesSearch({ ...TABLE, alt: "Brunch Table" }, "brunch TABLE")
    ).toBe(true)
  })

  it("treats geresh and gershayim as the ASCII apostrophe and quote", () => {
    // Alt with a geresh, typed with an apostrophe, and the other way round.
    expect(matchesSearch(TABLE, "בראנץ'")).toBe(true)
    expect(matchesSearch({ ...TABLE, alt: "צ'יפס" }, "צ\u05F3יפס")).toBe(true)
    // Gershayim and a quote.
    expect(matchesSearch({ ...TABLE, alt: "חל\u05F4ד" }, 'חל"ד')).toBe(true)
    expect(matchesSearch({ ...TABLE, alt: 'חל"ד' }, "חל\u05F4ד")).toBe(true)
  })
})

describe("choosing", () => {
  it("keeps one key per source, and gives another source its own", () => {
    const keys = new Map<string, string>()
    const first = keyFor(keys, TABLE.id)
    expect(first).toMatch(UUID)
    expect(keyFor(keys, TABLE.id)).toBe(first)
    const other = keyFor(keys, NO_ALT.id)
    expect(other).toMatch(UUID)
    expect(other).not.toBe(first)
  })

  it("gives the new row with the tile's alt and focus, and its preview", () => {
    const NEW = "33333333-3333-4333-8333-333333333333"
    expect(
      chosenFrom(TABLE, { mediaId: NEW, previewUrl: "https://signed/new" })
    ).toEqual({
      mediaId: NEW,
      previewUrl: "https://signed/new",
      alt: TABLE.alt,
      focusX: 20,
      focusY: 70,
    })
    // Not signed: the tile's own picture.
    expect(chosenFrom(TABLE, { mediaId: NEW, previewUrl: null })).toMatchObject(
      { previewUrl: TABLE.url }
    )
    // The field's value.
    expect(
      chosenValue(chosenFrom(TABLE, { mediaId: NEW, previewUrl: null }))
    ).toEqual({ media_id: NEW, alt: TABLE.alt, focus_x: 20, focus_y: 70 })
  })

  it("does not choose while a tile is locked", () => {
    const onChoose = vi.fn()
    const tile = (locked: boolean) =>
      Tile({ item: TABLE, position: 1, busy: false, locked, onChoose }) as {
        props: { onClick: () => void }
      }
    tile(true).props.onClick()
    expect(onChoose).not.toHaveBeenCalled()
    tile(false).props.onClick()
    expect(onChoose).toHaveBeenCalledTimes(1)
  })
})

describe("PickerBody", () => {
  it("shows the tiles with their names, optimized and at their focus", () => {
    const html = body(READY)
    expect(html).toContain(`aria-label="${TABLE.alt}"`)
    // An image without alt is named by its place.
    expect(html).toContain(`aria-label="${copy.pickNoAlt(2)}"`)
    // next/image: lazy, resized through the optimizer.
    expect(html).toContain('loading="lazy"')
    expect(html).toContain("/_next/image?url=")
    expect(html).toContain("object-position:20% 70%")
    expect(html).toContain(copy.pickSearch)
    expect(html).toContain(copy.pickCount(2))
    expect(html).toContain(copy.pickHint)
    expect(html).not.toContain("aria-describedby")
    expect(html).not.toContain("aria-disabled")
  })

  it("filters by the search, and says when nothing matches", () => {
    const one = body(READY, { query: "ערוך" })
    expect(one).toContain(`aria-label="${TABLE.alt}"`)
    expect(one).not.toContain(copy.pickNoAlt(2))
    expect(one).toContain(copy.pickCount(1))

    const none = body(READY, { query: "גלידה" })
    expect(none).toContain(copy.pickNoMatch)
    expect(none).not.toContain("<img")
  })

  it("shows the empty notice without a search", () => {
    const html = body({ state: "ready", items: [] })
    expect(html).toContain(copy.pickEmpty)
    expect(html).not.toContain(copy.pickSearch)
  })

  it("shows loading, and a failed load with a retry", () => {
    expect(body({ state: "loading" })).toContain(copy.pickLoading)
    const failed = body({ state: "failed", code: "NOT_AUTHORIZED" })
    expect(failed).toContain(ERROR_MESSAGES.NOT_AUTHORIZED)
    expect(failed).toContain(copy.retry)
  })

  it("locks the tiles while one is being chosen, and shows the copy error", () => {
    const html = body(READY, {
      busyId: TABLE.id,
      problem: "MEDIA_COPY_FAILED",
    })
    expect(html).toContain('aria-busy="true"')
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2)
    expect(html).toContain(ERROR_MESSAGES.MEDIA_COPY_FAILED)
  })

  it("disables the tiles offline, pointing at the offline hint", () => {
    net.online = false
    const html = body(READY)
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(2)
    expect(html).toContain('aria-describedby="offline-hint"')
    expect(html).toContain("data-offline")
  })
})
