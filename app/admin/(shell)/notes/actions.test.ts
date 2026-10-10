import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  addNoteAction,
  addNoteTopicAction,
  deleteNoteAction,
  deleteNoteTopicAction,
  previewDeleteNoteTopicAction,
  renameNoteTopicAction,
  setNoteArchivedAction,
  setNoteDoneAction,
  setNoteOrderAction,
  setNotePinnedAction,
  setNoteTopicOrderAction,
  updateNoteAction,
} from "./actions"

const callRpc = vi.fn()

vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const ID = "33333333-3333-4333-8333-333333333333"
const KEY = "22222222-2222-4222-8222-222222222222"
const INVALID = { ok: false, code: "INVALID_INPUT" }
const OK = { ok: true, data: undefined }

beforeEach(() => {
  callRpc.mockReset()
  callRpc.mockResolvedValue({ ok: true, data: { note_id: ID } })
})

describe("the notes tab's actions (story 4.11)", () => {
  it("send each RPC its arguments", async () => {
    callRpc.mockResolvedValueOnce({ ok: true, data: { topic_id: ID } })
    await expect(
      addNoteTopicAction({ name: "ספקים", idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: { topicId: ID } })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_add_note_topic",
      { p_name: "ספקים", p_idempotency_key: KEY }
    )

    await expect(
      renameNoteTopicAction({ topicId: ID, name: "x", idempotencyKey: KEY })
    ).resolves.toEqual(OK)
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_rename_note_topic",
      { p_topic_id: ID, p_name: "x", p_idempotency_key: KEY }
    )

    await deleteNoteTopicAction({
      topicId: ID,
      confirmed: true,
      idempotencyKey: KEY,
    })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_delete_note_topic",
      { p_topic_id: ID, p_confirmed: true, p_idempotency_key: KEY }
    )

    await setNoteTopicOrderAction({ ids: [ID, KEY] })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_set_note_topic_order",
      { p_ids: [ID, KEY] }
    )

    await addNoteAction({ topicId: ID, body: "ספק פרחים", idempotencyKey: KEY })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_add_note",
      { p_topic_id: ID, p_body: "ספק פרחים", p_idempotency_key: KEY }
    )

    await updateNoteAction({
      noteId: ID,
      topicId: KEY,
      body: "x",
      idempotencyKey: KEY,
    })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_update_note",
      { p_note_id: ID, p_topic_id: KEY, p_body: "x", p_idempotency_key: KEY }
    )

    await deleteNoteAction({ noteId: ID, idempotencyKey: KEY })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_delete_note",
      { p_note_id: ID, p_idempotency_key: KEY }
    )

    await setNotePinnedAction({ noteId: ID, pinned: true })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_set_note_pinned",
      { p_note_id: ID, p_pinned: true }
    )

    await setNoteDoneAction({ noteId: ID, done: false })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_set_note_done",
      { p_note_id: ID, p_done: false }
    )

    await setNoteArchivedAction({ noteId: ID, archived: true })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_set_note_archived",
      { p_note_id: ID, p_archived: true }
    )

    await setNoteOrderAction({ topicId: ID, ids: [KEY, ID] })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_set_note_order",
      { p_topic_id: ID, p_ids: [KEY, ID] }
    )
  })

  it("read the delete plan's note count", async () => {
    callRpc.mockResolvedValueOnce({
      ok: true,
      data: { topic_id: ID, name: "ספקים", note_count: 3 },
    })
    await expect(
      previewDeleteNoteTopicAction({ topicId: ID })
    ).resolves.toEqual({ ok: true, data: { name: "ספקים", noteCount: 3 } })
    callRpc.mockResolvedValueOnce({ ok: true, data: { note_count: "3" } })
    await expect(
      previewDeleteNoteTopicAction({ topicId: ID })
    ).resolves.toEqual({ ok: false, code: "SERVER_ERROR" })
    callRpc.mockResolvedValueOnce({ ok: false, code: "NOT_AUTHORIZED" })
    await expect(
      previewDeleteNoteTopicAction({ topicId: ID })
    ).resolves.toEqual({ ok: false, code: "NOT_AUTHORIZED" })
  })

  it("reject a bad shape without calling the RPC", async () => {
    const cases = [
      addNoteTopicAction({ name: "   ", idempotencyKey: KEY }),
      addNoteTopicAction({ name: "א".repeat(61), idempotencyKey: KEY }),
      addNoteTopicAction({ name: "x", idempotencyKey: "nope" }),
      renameNoteTopicAction({ topicId: "x", name: "x", idempotencyKey: KEY }),
      previewDeleteNoteTopicAction({ topicId: "x" }),
      deleteNoteTopicAction({
        topicId: ID,
        confirmed: "yes" as unknown as boolean,
        idempotencyKey: KEY,
      }),
      setNoteTopicOrderAction({ ids: [] }),
      setNoteTopicOrderAction({ ids: [ID, "x"] }),
      addNoteAction({ topicId: ID, body: "   ", idempotencyKey: KEY }),
      addNoteAction({
        topicId: ID,
        body: "א".repeat(2001),
        idempotencyKey: KEY,
      }),
      updateNoteAction({
        noteId: ID,
        topicId: "x",
        body: "x",
        idempotencyKey: KEY,
      }),
      deleteNoteAction({ noteId: ID, idempotencyKey: "" }),
      setNotePinnedAction({ noteId: ID, pinned: null as unknown as boolean }),
      setNoteDoneAction({ noteId: "x", done: true }),
      setNoteArchivedAction({ noteId: ID, archived: 1 as unknown as boolean }),
      setNoteOrderAction({ topicId: ID, ids: "x" as unknown as string[] }),
      addNoteAction(
        undefined as unknown as Parameters<typeof addNoteAction>[0]
      ),
    ]
    for (const result of await Promise.all(cases)) {
      expect(result).toEqual(INVALID)
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("accept a 2000-character note and a 60-character topic", async () => {
    await expect(
      addNoteAction({
        topicId: ID,
        body: ` ${"א".repeat(2000)} `,
        idempotencyKey: KEY,
      })
    ).resolves.toEqual(OK)
    callRpc.mockResolvedValueOnce({ ok: true, data: { topic_id: ID } })
    await expect(
      addNoteTopicAction({ name: "א".repeat(60), idempotencyKey: KEY })
    ).resolves.toEqual({ ok: true, data: { topicId: ID } })
  })
})
