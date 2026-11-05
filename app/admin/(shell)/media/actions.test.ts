import { beforeEach, describe, expect, it, vi } from "vitest"

import { copyMediaAction, listMediaAction } from "./actions"

const callRpc = vi.fn()
const signedDraftUrls = vi.fn()
const copy = vi.fn()
const from = vi.fn(() => ({ copy }))

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/media/drafts", () => ({
  signedDraftUrls: (...args: unknown[]) => signedDraftUrls(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ storage: { from } }),
}))

const SOURCE = "11111111-1111-4111-8111-111111111111"
const KEY = "22222222-2222-4222-8222-222222222222"
const NEW = "33333333-3333-4333-8333-333333333333"
const OTHER = "44444444-4444-4444-8444-444444444444"

beforeEach(() => {
  callRpc.mockReset()
  signedDraftUrls.mockReset()
  copy.mockReset()
  from.mockClear()
})

describe("listMediaAction", () => {
  it("returns the listed images with their published thumbnails, unsigned", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://dev.example")
    callRpc.mockResolvedValue({
      ok: true,
      data: [
        {
          id: SOURCE,
          created_at: "2026-11-05T10:00:00+00:00",
          alt_text: "שולחן",
          focus_x: 20,
          focus_y: 30,
          public_path: `${NEW}.jpg`,
        },
        {
          // Still copying: no published member, no thumbnail.
          id: OTHER,
          created_at: "2026-11-04T10:00:00+00:00",
          alt_text: null,
          focus_x: 50,
          focus_y: 50,
          public_path: null,
        },
      ],
    })
    await expect(listMediaAction()).resolves.toEqual({
      ok: true,
      data: {
        items: [
          {
            id: SOURCE,
            url: `https://dev.example/storage/v1/object/public/media-public/${NEW}.jpg`,
            alt: "שולחן",
            focusX: 20,
            focusY: 30,
          },
        ],
      },
    })
    expect(callRpc).toHaveBeenCalledWith(expect.anything(), "admin_list_media")
    expect(signedDraftUrls).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it("passes on the RPC's code", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "NOT_AUTHORIZED" })
    await expect(listMediaAction()).resolves.toEqual({
      ok: false,
      code: "NOT_AUTHORIZED",
    })
    expect(signedDraftUrls).not.toHaveBeenCalled()
  })
})

describe("copyMediaAction", () => {
  function copied() {
    callRpc.mockResolvedValue({
      ok: true,
      data: { media_id: NEW, storage_path: NEW, source_path: SOURCE },
    })
  }

  it("checks the shape before anything", async () => {
    await expect(
      copyMediaAction({ sourceId: "x", idempotencyKey: KEY })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    await expect(
      copyMediaAction({ sourceId: SOURCE, idempotencyKey: "x" })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("makes the row, copies the draft file and returns its preview", async () => {
    copied()
    copy.mockResolvedValue({ data: { path: NEW }, error: null })
    signedDraftUrls.mockResolvedValue({
      [NEW]: "https://signed/new",
      [SOURCE]: "https://signed/source",
    })
    await expect(
      copyMediaAction({ sourceId: SOURCE, idempotencyKey: KEY })
    ).resolves.toEqual({
      ok: true,
      data: { mediaId: NEW, previewUrl: "https://signed/new" },
    })
    expect(callRpc).toHaveBeenCalledWith(
      expect.anything(),
      "admin_copy_media",
      {
        p_source_id: SOURCE,
        p_idempotency_key: KEY,
      }
    )
    expect(from).toHaveBeenCalledWith("media-drafts")
    expect(copy).toHaveBeenCalledWith(SOURCE, NEW)
  })

  it("takes an existing file as copied (a retry), with the source's preview as a fallback", async () => {
    copied()
    copy.mockResolvedValue({
      data: null,
      error: { message: "The resource already exists", statusCode: "409" },
    })
    signedDraftUrls.mockResolvedValue({ [SOURCE]: "https://signed/source" })
    await expect(
      copyMediaAction({ sourceId: SOURCE, idempotencyKey: KEY })
    ).resolves.toEqual({
      ok: true,
      data: { mediaId: NEW, previewUrl: "https://signed/source" },
    })
  })

  it("returns a code when the file copy fails", async () => {
    copied()
    copy.mockResolvedValue({
      data: null,
      error: { message: "network", statusCode: "500" },
    })
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(
      copyMediaAction({ sourceId: SOURCE, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: false, code: "MEDIA_COPY_FAILED" })
    expect(log).toHaveBeenCalled()
    log.mockRestore()
    expect(signedDraftUrls).not.toHaveBeenCalled()
  })

  it("passes on the RPC's code without copying", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "MEDIA_NOT_UPLOADED" })
    await expect(
      copyMediaAction({ sourceId: SOURCE, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: false, code: "MEDIA_NOT_UPLOADED" })
    expect(copy).not.toHaveBeenCalled()
  })
})
