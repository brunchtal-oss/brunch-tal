import { beforeEach, describe, expect, it, vi } from "vitest"

import { copyMediaToPublic, deletePublicMedia, publishMedia } from "./media"

const callRpc = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))

const ID = "3f8b1c2a-1d4e-4a8b-9c0d-2e3f4a5b6c7d"
const OTHER = "4f8b1c2a-1d4e-4a8b-9c0d-2e3f4a5b6c7d"

type StorageArg = Parameters<typeof copyMediaToPublic>[1] & object

function fakeStorage(result: { error: unknown }) {
  const copy = vi.fn().mockResolvedValue(result)
  const remove = vi.fn().mockResolvedValue(result)
  const from = vi.fn().mockReturnValue({ copy, remove })
  return {
    client: { storage: { from } } as unknown as StorageArg,
    from,
    copy,
    remove,
  }
}

// The admin's client: media_assets rows that are hidden right now.
function fakeAdmin(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = []
  const builder: Record<string, unknown> = {}
  for (const name of ["from", "select", "in", "eq"]) {
    builder[name] = (...args: unknown[]) => {
      calls.push([name, ...args])
      return builder
    }
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result)
  return {
    client: builder as unknown as Parameters<typeof deletePublicMedia>[0],
    calls,
  }
}

beforeEach(() => {
  callRpc.mockReset()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("copyMediaToPublic", () => {
  it("copies the draft to <id>.jpg in media-public", async () => {
    const fake = fakeStorage({ error: null })
    expect(await copyMediaToPublic(ID, fake.client)).toBe(true)
    expect(fake.from).toHaveBeenCalledWith("media-drafts")
    expect(fake.copy).toHaveBeenCalledWith(ID, `${ID}.jpg`, {
      destinationBucket: "media-public",
    })
  })

  it("counts an existing destination as copied (a retry)", async () => {
    const fake = fakeStorage({
      error: { message: "The resource already exists", statusCode: "409" },
    })
    expect(await copyMediaToPublic(ID, fake.client)).toBe(true)
  })

  it("reports any other failure with the id, and refuses an id that is not a uuid", async () => {
    const fake = fakeStorage({
      error: { message: "Object not found", statusCode: "404" },
    })
    expect(await copyMediaToPublic(ID, fake.client)).toBe(false)
    expect(console.error).toHaveBeenCalledWith("media.copy_failed", {
      mediaId: ID,
      message: "Object not found",
      statusCode: "404",
    })
    expect(await copyMediaToPublic("../x", fake.client)).toBe(false)
    expect(fake.copy).toHaveBeenCalledTimes(1)
  })
})

describe("deletePublicMedia", () => {
  it("deletes only public files whose row is hidden now", async () => {
    const admin = fakeAdmin({
      data: [{ public_path: `${ID}.jpg` }],
      error: null,
    })
    const storage = fakeStorage({ error: null })
    expect(
      await deletePublicMedia(
        admin.client,
        [`${ID}.jpg`, `${OTHER}.jpg`, "../secret", ID],
        storage.client
      )
    ).toBe(true)
    expect(admin.calls).toEqual([
      ["from", "media_assets"],
      ["select", "public_path"],
      ["in", "public_path", [`${ID}.jpg`, `${OTHER}.jpg`]],
      ["eq", "publish_state", "hidden"],
    ])
    // OTHER was published again in between: its file stays.
    expect(storage.from).toHaveBeenCalledWith("media-public")
    expect(storage.remove).toHaveBeenCalledWith([`${ID}.jpg`])
  })

  it("deletes nothing without paths or without a hidden row", async () => {
    const storage = fakeStorage({ error: null })
    const none = fakeAdmin({ data: [], error: null })
    expect(await deletePublicMedia(none.client, [], storage.client)).toBe(true)
    expect(none.calls).toEqual([])
    expect(
      await deletePublicMedia(none.client, [`${ID}.jpg`], storage.client)
    ).toBe(true)
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it("reports a failed check or delete", async () => {
    const storage = fakeStorage({ error: null })
    const broken = fakeAdmin({ data: null, error: { message: "down" } })
    expect(
      await deletePublicMedia(broken.client, [`${ID}.jpg`], storage.client)
    ).toBe(false)
    expect(storage.remove).not.toHaveBeenCalled()

    const admin = fakeAdmin({
      data: [{ public_path: `${ID}.jpg` }],
      error: null,
    })
    const failing = fakeStorage({ error: { message: "down" } })
    expect(
      await deletePublicMedia(admin.client, [`${ID}.jpg`], failing.client)
    ).toBe(false)
    expect(console.error).toHaveBeenCalledWith("media.delete_failed", {
      paths: [`${ID}.jpg`],
      message: "down",
    })
  })
})

describe("publishMedia", () => {
  const IMAGE = { media_id: ID, alt: "שולחן", focus_x: 20, focus_y: 80 }
  const session = { session: true } as unknown as Parameters<
    typeof publishMedia
  >[0]

  it("begins with the image's alt and focus, copies, then finishes", async () => {
    callRpc
      .mockResolvedValueOnce({ ok: true, data: { publish_state: "copying" } })
      .mockResolvedValueOnce({ ok: true, data: { publish_state: "published" } })
    const storage = fakeStorage({ error: null })
    await expect(publishMedia(session, IMAGE, storage.client)).resolves.toEqual(
      { ok: true, data: undefined }
    )
    expect(callRpc).toHaveBeenNthCalledWith(
      1,
      session,
      "admin_begin_media_publish",
      { p_media_id: ID, p_alt_text: "שולחן", p_focus_x: 20, p_focus_y: 80 }
    )
    expect(storage.copy).toHaveBeenCalledWith(ID, `${ID}.jpg`, {
      destinationBucket: "media-public",
    })
    expect(callRpc).toHaveBeenNthCalledWith(
      2,
      session,
      "admin_finish_media_publish",
      { p_media_id: ID }
    )
  })

  it("sends an empty alt when there is none", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: { publish_state: "published" },
    })
    await publishMedia(
      session,
      { media_id: ID, focus_x: 50, focus_y: 50 },
      fakeStorage({ error: null }).client
    )
    expect(callRpc.mock.calls[0][2]).toMatchObject({ p_alt_text: "" })
  })

  it("does not copy or finish an image that is already published", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: { publish_state: "published" },
    })
    const storage = fakeStorage({ error: null })
    await expect(publishMedia(session, IMAGE, storage.client)).resolves.toEqual(
      { ok: true, data: undefined }
    )
    expect(storage.copy).not.toHaveBeenCalled()
    expect(callRpc).toHaveBeenCalledTimes(1)
  })

  it("stops with MEDIA_NOT_COPIED, before finish, when the copy fails", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { publish_state: "copying" } })
    const storage = fakeStorage({
      error: { message: "down", statusCode: "500" },
    })
    await expect(publishMedia(session, IMAGE, storage.client)).resolves.toEqual(
      { ok: false, code: "MEDIA_NOT_COPIED" }
    )
    expect(callRpc).toHaveBeenCalledTimes(1)
  })

  it("passes a begin error through", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "MEDIA_NOT_UPLOADED" })
    const storage = fakeStorage({ error: null })
    await expect(publishMedia(session, IMAGE, storage.client)).resolves.toEqual(
      { ok: false, code: "MEDIA_NOT_UPLOADED" }
    )
    expect(storage.copy).not.toHaveBeenCalled()
  })
})
