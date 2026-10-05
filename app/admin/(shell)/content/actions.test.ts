import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  discardContentDraftAction,
  publishContentAction,
  saveContentDraftAction,
} from "./actions"
import type { ContentPage, ContentSection } from "./content-items"

const callRpc = vi.fn()
const updateTag = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))
vi.mock("next/cache", () => ({
  updateTag: (...args: unknown[]) => updateTag(...args),
}))

const KEY = "22222222-2222-4222-8222-222222222222"
const HERO = { title: "t", description: "d" }

function section(values: Partial<ContentSection>): ContentSection {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    key: "hero",
    kind: "hero",
    sort_order: 1,
    hidden: false,
    draft_content: null,
    published_content: null,
    published_at: null,
    updated_at: "2026-10-04T10:00:00+00:00",
    ...values,
  }
}

function page(slug: string, sections: ContentSection[]): ContentPage {
  return { slug, published_version: 0, published_at: null, sections }
}

// The first call reads the page, the second writes.
function answer(read: ContentPage, write?: unknown) {
  callRpc.mockImplementation(async (_client, name: string) => {
    if (name === "admin_get_content_page") return { ok: true, data: read }
    return write
  })
}

beforeEach(() => {
  callRpc.mockReset()
  updateTag.mockReset()
})

describe("saveContentDraftAction", () => {
  it("saves the parsed hero, without empty optional fields", async () => {
    answer(page("home", [section({})]), { ok: true, data: { key: "hero" } })
    await expect(
      saveContentDraftAction({
        slug: "home",
        key: "hero",
        content: { title: " t ", description: " " },
      })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_get_content_page",
      { p_slug: "home" }
    )
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_set_content_draft",
      {
        p_slug: "home",
        p_key: "hero",
        p_content: { title: "t" },
      }
    )
    expect(updateTag).not.toHaveBeenCalled()
  })

  it("refuses an intro without its text without saving", async () => {
    answer(page("home", [section({ key: "intro", kind: "text_block" })]), {
      ok: true,
      data: {},
    })
    await expect(
      saveContentDraftAction({
        slug: "home",
        key: "intro",
        content: { title: "t", body: " " },
      })
    ).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "body" },
    })
    expect(callRpc).not.toHaveBeenCalledWith(
      expect.anything(),
      "admin_set_content_draft",
      expect.anything()
    )
  })

  it("saves home › contact as a heading only", async () => {
    answer(page("home", [section({ key: "contact", kind: "text_block" })]), {
      ok: true,
      data: {},
    })
    await expect(
      saveContentDraftAction({
        slug: "home",
        key: "contact",
        content: { title: "t", body: "" },
      })
    ).resolves.toEqual({ ok: true, data: undefined })
  })

  it("names the field of an item that is refused", async () => {
    answer(
      page("gallery", [section({ key: "testimonials", kind: "testimonials" })])
    )
    await expect(
      saveContentDraftAction({
        slug: "gallery",
        key: "testimonials",
        content: {
          items: [
            { name: "a", text: "b" },
            { name: "c", text: " " },
          ],
        },
      })
    ).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "items.1.text" },
    })
  })

  it("saves the testimonials with a hidden item and the section hidden", async () => {
    answer(
      page("gallery", [section({ key: "testimonials", kind: "testimonials" })]),
      { ok: true, data: {} }
    )
    await saveContentDraftAction({
      slug: "gallery",
      key: "testimonials",
      content: {
        hidden: true,
        items: [{ name: "a", text: "b", hidden: true }],
      },
    })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_set_content_draft",
      {
        p_slug: "gallery",
        p_key: "testimonials",
        p_content: {
          hidden: true,
          items: [{ name: "a", text: "b", hidden: true }],
        },
      }
    )
  })

  it("checks the business details by their kind", async () => {
    answer(
      page("contact", [
        section({ key: "business_details", kind: "business_details" }),
      ]),
      { ok: true, data: {} }
    )
    await expect(
      saveContentDraftAction({
        slug: "contact",
        key: "business_details",
        content: { whatsapp_phone: "0544256456", navigation_url: "http://x" },
      })
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "navigation_url" },
    })
  })

  it.each([
    ["privacy", "main"],
    ["x", "hero"],
    ["home", "faq"],
    ["home", "main"],
    ["about", "hero"],
    ["home", "toString"],
  ])("refuses the section %s/%s without calling an RPC", async (slug, key) => {
    await expect(
      saveContentDraftAction({ slug, key, content: HERO })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes NOT_AUTHORIZED of the read through", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "NOT_AUTHORIZED" })
    await expect(
      saveContentDraftAction({ slug: "home", key: "hero", content: HERO })
    ).resolves.toEqual({ ok: false, code: "NOT_AUTHORIZED" })
  })

  it("is NOT_FOUND when the page has no such section", async () => {
    answer(page("home", []))
    await expect(
      saveContentDraftAction({ slug: "home", key: "hero", content: HERO })
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" })
  })
})

describe("discardContentDraftAction", () => {
  it("puts what is published back in the draft, without a schema check", async () => {
    // Published long ago with a field the editor no longer has.
    const published = { title: "t", cta_label: "c" }
    answer(
      page("home", [
        section({
          draft_content: { title: "new" },
          published_content: published,
        }),
      ]),
      { ok: true, data: {} }
    )
    await expect(
      discardContentDraftAction({ slug: "home", key: "hero" })
    ).resolves.toEqual({ ok: true, data: { content: published } })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_set_content_draft",
      { p_slug: "home", p_key: "hero", p_content: published }
    )
    expect(updateTag).not.toHaveBeenCalled()
  })

  it("empties the draft of a section that was never published", async () => {
    answer(
      page("about", [
        section({ key: "main", kind: "text_block", draft_content: { a: 1 } }),
      ]),
      { ok: true, data: {} }
    )
    await expect(
      discardContentDraftAction({ slug: "about", key: "main" })
    ).resolves.toEqual({ ok: true, data: { content: {} } })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_set_content_draft",
      { p_slug: "about", p_key: "main", p_content: {} }
    )
  })

  it.each([
    ["home", "main"],
    ["privacy", "main"],
    ["home", "toString"],
  ])("refuses the section %s/%s without calling an RPC", async (slug, key) => {
    await expect(discardContentDraftAction({ slug, key })).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
    })
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes the RPC errors through", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "NOT_AUTHORIZED" })
    await expect(
      discardContentDraftAction({ slug: "home", key: "hero" })
    ).resolves.toEqual({ ok: false, code: "NOT_AUTHORIZED" })

    answer(page("home", [section({})]), { ok: false, code: "SERVER_ERROR" })
    await expect(
      discardContentDraftAction({ slug: "home", key: "hero" })
    ).resolves.toEqual({ ok: false, code: "SERVER_ERROR" })
  })

  it("is NOT_FOUND when the page has no such section", async () => {
    answer(page("home", []))
    await expect(
      discardContentDraftAction({ slug: "home", key: "hero" })
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" })
  })
})

describe("publishContentAction", () => {
  it("publishes and updates the page's tag", async () => {
    answer(page("home", [section({ draft_content: HERO })]), {
      ok: true,
      data: { published_version: 1, changed: 1 },
    })
    await expect(
      publishContentAction({ slug: "home", idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: { publishedVersion: 1, changed: 1 } })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_publish_content",
      { p_slug: "home", p_idempotency_key: KEY }
    )
    expect(updateTag).toHaveBeenCalledWith("content:home")
    expect(updateTag).not.toHaveBeenCalledWith("content:global")
  })

  it("also updates content:global for the business details", async () => {
    answer(
      page("contact", [
        section({
          key: "business_details",
          kind: "business_details",
          draft_content: { whatsapp_phone: "0544256456" },
        }),
      ]),
      { ok: true, data: { published_version: 2, changed: 1 } }
    )
    await publishContentAction({ slug: "contact", idempotencyKey: KEY })
    expect(updateTag).toHaveBeenCalledWith("content:contact")
    expect(updateTag).toHaveBeenCalledWith("content:global")
  })

  it("publishes nothing when a pending draft is invalid", async () => {
    answer(page("home", [section({ draft_content: { cta_label: "c" } })]))
    await expect(
      publishContentAction({ slug: "home", idempotencyKey: KEY })
    ).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "hero" },
    })
    expect(callRpc).toHaveBeenCalledTimes(1)
    expect(updateTag).not.toHaveBeenCalled()
  })

  it("checks a pending draft with its section's schema", async () => {
    // about › main needs its text, though text_block's body is optional.
    answer(
      page("about", [
        section({
          key: "main",
          kind: "text_block",
          draft_content: { title: "t" },
        }),
      ])
    )
    await expect(
      publishContentAction({ slug: "about", idempotencyKey: KEY })
    ).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "main" },
    })
    expect(callRpc).toHaveBeenCalledTimes(1)
    expect(updateTag).not.toHaveBeenCalled()
  })

  it("ignores a draft that is already published", async () => {
    // Invalid, but equal to what is published: not part of this publish.
    const old = { cta_label: "c" }
    answer(
      page("home", [section({ draft_content: old, published_content: old })]),
      { ok: true, data: { published_version: 3, changed: 0 } }
    )
    await expect(
      publishContentAction({ slug: "home", idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: { publishedVersion: 3, changed: 0 } })
  })

  it("passes an RPC error through without updating a tag", async () => {
    answer(page("home", [section({ draft_content: HERO })]), {
      ok: false,
      code: "IDEMPOTENCY_KEY_REUSED",
    })
    await expect(
      publishContentAction({ slug: "home", idempotencyKey: KEY })
    ).resolves.toEqual({ ok: false, code: "IDEMPOTENCY_KEY_REUSED" })
    expect(updateTag).not.toHaveBeenCalled()
  })

  it.each([
    ["an unknown page", { slug: "privacy", idempotencyKey: KEY }],
    [
      "an editor page that is not a slug",
      { slug: "toString", idempotencyKey: KEY },
    ],
    ["a key that is not a uuid", { slug: "home", idempotencyKey: "x" }],
  ])("refuses %s without calling an RPC", async (_label, input) => {
    await expect(publishContentAction(input)).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
    })
    expect(callRpc).not.toHaveBeenCalled()
  })
})
