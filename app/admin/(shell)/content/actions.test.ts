import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createMediaAction,
  discardContentDraftAction,
  publishContentAction,
  saveContentDraftAction,
} from "./actions"
import type { ContentPage, ContentSection } from "./content-items"

const callRpc = vi.fn()
const updateTag = vi.fn()
const publishMedia = vi.fn()
const deletePublicMedia = vi.fn()

vi.mock("@/lib/server/privileged/media", () => ({
  publishMedia: (...args: unknown[]) => publishMedia(...args),
  deletePublicMedia: (...args: unknown[]) => deletePublicMedia(...args),
}))

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
  publishMedia.mockReset()
  publishMedia.mockResolvedValue({ ok: true, data: undefined })
  deletePublicMedia.mockReset()
  deletePublicMedia.mockResolvedValue(true)
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

  // No field is required but three (user decision 2026-10-08).
  it("saves an intro without its text, or with nothing at all", async () => {
    answer(page("home", [section({ key: "intro", kind: "text_block" })]), {
      ok: true,
      data: {},
    })
    await expect(
      saveContentDraftAction({
        slug: "home",
        key: "intro",
        content: { title: "", body: " " },
      })
    ).resolves.toEqual({ ok: true, data: undefined })
  })

  it("refuses a field over its limit without saving", async () => {
    answer(page("home", [section({ key: "intro", kind: "text_block" })]), {
      ok: true,
      data: {},
    })
    await expect(
      saveContentDraftAction({
        slug: "home",
        key: "intro",
        content: { title: "x".repeat(121) },
      })
    ).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "title" },
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
            { name: "c", text: "x".repeat(1501) },
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
        // An item saved without a kind is a text testimonial (story 5.4).
        p_content: {
          hidden: true,
          items: [{ kind: "text", name: "a", text: "b", hidden: true }],
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
    answer(
      page("home", [section({ draft_content: { title: "x".repeat(81) } })])
    )
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
    // about › main no longer needs its text (2026-10-08); a title over its
    // limit is still refused.
    answer(
      page("about", [
        section({
          key: "main",
          kind: "text_block",
          draft_content: { title: "x".repeat(121) },
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
    ["an unknown page", { slug: "join", idempotencyKey: KEY }],
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

const A = "3f8b1c2a-1d4e-4a8b-9c0d-2e3f4a5b6c7d"
const B = "4f8b1c2a-1d4e-4a8b-9c0d-2e3f4a5b6c7d"
const GALLERY = {
  items: [
    { image: { media_id: A, alt: "a", focus_x: 20, focus_y: 30 } },
    { image: { media_id: B, focus_x: 50, focus_y: 50 }, hidden: true },
  ],
}

// Story 5.4: the images of the pending drafts are published first (AD-21),
// then the page; the hidden files are deleted after the RPC.
describe("publishContentAction with images", () => {
  it("publishes the visible images, then the page, then deletes hidden files", async () => {
    answer(
      page("gallery", [
        section({ key: "photos", kind: "gallery", draft_content: GALLERY }),
      ]),
      {
        ok: true,
        data: { published_version: 1, changed: 1, hidden_paths: [B + ".jpg"] },
      }
    )
    await expect(
      publishContentAction({ slug: "gallery", idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: { publishedVersion: 1, changed: 1 } })
    // Only the visible image, with its alt and focus.
    expect(publishMedia).toHaveBeenCalledTimes(1)
    expect(publishMedia).toHaveBeenCalledWith(
      { session: true },
      { media_id: A, alt: "a", focus_x: 20, focus_y: 30 }
    )
    expect(deletePublicMedia).toHaveBeenCalledWith({ session: true }, [
      B + ".jpg",
    ])
    expect(updateTag).toHaveBeenCalledWith("content:gallery")
  })

  it("skips an upload that did not finish", async () => {
    publishMedia.mockResolvedValue({ ok: false, code: "MEDIA_NOT_UPLOADED" })
    answer(
      page("gallery", [
        section({ key: "photos", kind: "gallery", draft_content: GALLERY }),
      ]),
      { ok: true, data: { published_version: 1, changed: 1, hidden_paths: [] } }
    )
    await expect(
      publishContentAction({ slug: "gallery", idempotencyKey: KEY })
    ).resolves.toMatchObject({ ok: true })
  })

  it("stops before the page when an image did not publish", async () => {
    publishMedia.mockResolvedValue({ ok: false, code: "MEDIA_NOT_COPIED" })
    answer(
      page("gallery", [
        section({ key: "photos", kind: "gallery", draft_content: GALLERY }),
      ])
    )
    await expect(
      publishContentAction({ slug: "gallery", idempotencyKey: KEY })
    ).resolves.toEqual({ ok: false, code: "MEDIA_NOT_COPIED" })
    expect(callRpc).not.toHaveBeenCalledWith(
      expect.anything(),
      "admin_publish_content",
      expect.anything()
    )
    expect(updateTag).not.toHaveBeenCalled()
  })
})

describe("createMediaAction", () => {
  it("creates the row with the screen's key", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { media_id: A } })
    await expect(createMediaAction({ idempotencyKey: KEY })).resolves.toEqual({
      ok: true,
      data: { mediaId: A },
    })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_create_media",
      { p_idempotency_key: KEY }
    )
  })

  it("refuses a key that is not a uuid", async () => {
    await expect(createMediaAction({ idempotencyKey: "x" })).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
    })
    expect(callRpc).not.toHaveBeenCalled()
  })
})
