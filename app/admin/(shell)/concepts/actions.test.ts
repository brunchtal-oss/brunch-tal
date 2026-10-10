import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createConceptAction,
  createConceptMediaAction,
  deleteConceptAction,
  setConceptArchivedAction,
  setConceptImageAction,
  updateConceptAction,
} from "./actions"

const callRpc = vi.fn()
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

const CONCEPT_ID = "11111111-1111-4111-8111-111111111111"
const KEY = "22222222-2222-4222-8222-222222222222"
const MEDIA_ID = "33333333-3333-4333-8333-333333333333"
const IMAGE = { media_id: MEDIA_ID, alt: "alt", focus_x: 40, focus_y: 60 }
const PATH = "44444444-4444-4444-8444-444444444444.jpg"

beforeEach(() => {
  callRpc.mockReset()
  publishMedia.mockReset()
  publishMedia.mockResolvedValue({ ok: true, data: undefined })
  deletePublicMedia.mockReset()
  deletePublicMedia.mockResolvedValue(true)
})

describe("createConceptAction", () => {
  it("creates with the admin's session and the form's key", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { concept_id: CONCEPT_ID } })
    const concept = { name: "חגים", description: null, default_kind: "couple" }
    await expect(
      createConceptAction({ concept, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: { conceptId: CONCEPT_ID } })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_create_concept",
      { p_concept: concept, p_idempotency_key: KEY }
    )
  })

  it("refuses a bad key, an empty concept or another key without calling the RPC", async () => {
    for (const input of [
      { concept: { name: "n" }, idempotencyKey: "nope" },
      { concept: {}, idempotencyKey: KEY },
      { concept: { name: "n", theme_key: "greek" }, idempotencyKey: KEY },
    ]) {
      await expect(createConceptAction(input)).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
      })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("passes the RPC's code through", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "CONCEPT_NAME_TAKEN" })
    await expect(
      createConceptAction({
        concept: { name: "n", default_kind: "regular" },
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: false, code: "CONCEPT_NAME_TAKEN" })
  })
})

describe("updateConceptAction", () => {
  it("sends the changes with the key", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { concept_id: CONCEPT_ID } })
    await expect(
      updateConceptAction({
        conceptId: CONCEPT_ID,
        changes: { default_kind: "regular" },
        idempotencyKey: KEY,
      })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_update_concept",
      {
        p_concept_id: CONCEPT_ID,
        p_changes: { default_kind: "regular" },
        p_idempotency_key: KEY,
      }
    )
  })

  it("refuses a bad id, no changes or an unknown field", async () => {
    for (const input of [
      { conceptId: "x", changes: { name: "n" }, idempotencyKey: KEY },
      { conceptId: CONCEPT_ID, changes: {}, idempotencyKey: KEY },
      {
        conceptId: CONCEPT_ID,
        changes: { sort_order: 1 },
        idempotencyKey: KEY,
      },
    ]) {
      await expect(updateConceptAction(input)).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
      })
    }
    expect(callRpc).not.toHaveBeenCalled()
  })
})

describe("setConceptArchivedAction", () => {
  it("archives and restores without a key", async () => {
    callRpc.mockResolvedValue({ ok: true, data: {} })
    await setConceptArchivedAction({ conceptId: CONCEPT_ID, archived: true })
    await setConceptArchivedAction({ conceptId: CONCEPT_ID, archived: false })
    expect(callRpc.mock.calls.map((call) => call.slice(1))).toEqual([
      [
        "admin_set_concept_archived",
        { p_concept_id: CONCEPT_ID, p_archived: true },
      ],
      [
        "admin_set_concept_archived",
        { p_concept_id: CONCEPT_ID, p_archived: false },
      ],
    ])
  })

  it("refuses a value that is not a boolean", async () => {
    await expect(
      setConceptArchivedAction({
        conceptId: CONCEPT_ID,
        archived: "yes" as unknown as boolean,
      })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(callRpc).not.toHaveBeenCalled()
  })
})

describe("deleteConceptAction", () => {
  it("deletes, then deletes the freed public file", async () => {
    callRpc.mockResolvedValue({
      ok: true,
      data: { concept_id: CONCEPT_ID, hidden_paths: [PATH] },
    })
    await expect(
      deleteConceptAction({ conceptId: CONCEPT_ID, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_delete_concept",
      { p_concept_id: CONCEPT_ID, p_idempotency_key: KEY }
    )
    expect(deletePublicMedia).toHaveBeenCalledWith({ session: true }, [PATH])
  })

  it("returns CONCEPT_IN_USE and deletes no file", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "CONCEPT_IN_USE" })
    await expect(
      deleteConceptAction({ conceptId: CONCEPT_ID, idempotencyKey: KEY })
    ).resolves.toEqual({ ok: false, code: "CONCEPT_IN_USE" })
    expect(deletePublicMedia).not.toHaveBeenCalled()
  })
})

describe("createConceptMediaAction", () => {
  it("creates an image row with the key", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { media_id: MEDIA_ID } })
    await expect(
      createConceptMediaAction({ idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: { mediaId: MEDIA_ID } })
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_create_media",
      {
        p_idempotency_key: KEY,
      }
    )
  })
})

describe("setConceptImageAction", () => {
  it("publishes the image, sets it, then deletes the freed file", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { hidden_paths: [PATH] } })
    await expect(
      setConceptImageAction({ conceptId: CONCEPT_ID, image: IMAGE })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(publishMedia).toHaveBeenCalledWith({ session: true }, IMAGE)
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_set_concept_image",
      { p_concept_id: CONCEPT_ID, p_media_id: MEDIA_ID }
    )
    expect(deletePublicMedia).toHaveBeenCalledWith({ session: true }, [PATH])
    expect(publishMedia.mock.invocationCallOrder[0]).toBeLessThan(
      callRpc.mock.invocationCallOrder[0]
    )
    expect(callRpc.mock.invocationCallOrder[0]).toBeLessThan(
      deletePublicMedia.mock.invocationCallOrder[0]
    )
  })

  it("removes the image with null, without publishing", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { hidden_paths: [] } })
    await setConceptImageAction({ conceptId: CONCEPT_ID, image: null })
    expect(publishMedia).not.toHaveBeenCalled()
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_set_concept_image",
      { p_concept_id: CONCEPT_ID, p_media_id: null }
    )
  })

  it("stops when publishing fails", async () => {
    publishMedia.mockResolvedValue({ ok: false, code: "MEDIA_NOT_COPIED" })
    await expect(
      setConceptImageAction({ conceptId: CONCEPT_ID, image: IMAGE })
    ).resolves.toEqual({ ok: false, code: "MEDIA_NOT_COPIED" })
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("refuses a bad image without calling anything", async () => {
    await expect(
      setConceptImageAction({
        conceptId: CONCEPT_ID,
        image: { ...IMAGE, focus_x: 101 },
      })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(publishMedia).not.toHaveBeenCalled()
    expect(callRpc).not.toHaveBeenCalled()
  })
})
