import { beforeEach, describe, expect, it, vi } from "vitest"

import * as actions from "./actions"

const {
  addNoteAction,
  deleteNoteAction,
  setNoteArchivedAction,
  setNoteDoneAction,
  setNoteOrderAction,
  setNotePinnedAction,
  updateNoteAction,
} = actions

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

describe("the notes board's actions (story 4.11, fix 13)", () => {
  it("has no topic actions", () => {
    expect(Object.keys(actions).filter((k) => /topic/i.test(k))).toEqual([])
  })

  it("send each RPC its arguments", async () => {
    await expect(
      addNoteAction({ body: "ספק פרחים", idempotencyKey: KEY })
    ).resolves.toEqual(OK)
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_add_note",
      { p_body: "ספק פרחים", p_idempotency_key: KEY }
    )

    await updateNoteAction({ noteId: ID, body: "x", idempotencyKey: KEY })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_update_note",
      { p_note_id: ID, p_body: "x", p_idempotency_key: KEY }
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

    await setNoteOrderAction({ ids: [KEY, ID] })
    expect(callRpc).toHaveBeenLastCalledWith(
      { session: true },
      "admin_set_note_order",
      { p_ids: [KEY, ID] }
    )
  })

  it("returns the RPC's refusal as is", async () => {
    callRpc.mockResolvedValueOnce({ ok: false, code: "CONCURRENT_CHANGE" })
    await expect(setNoteOrderAction({ ids: [ID] })).resolves.toEqual({
      ok: false,
      code: "CONCURRENT_CHANGE",
    })
  })

  it("reject a bad shape without calling the RPC", async () => {
    const cases = [
      addNoteAction({ body: "   ", idempotencyKey: KEY }),
      addNoteAction({ body: "א".repeat(2001), idempotencyKey: KEY }),
      addNoteAction({ body: "x", idempotencyKey: "nope" }),
      updateNoteAction({ noteId: "x", body: "x", idempotencyKey: KEY }),
      updateNoteAction({ noteId: ID, body: " ", idempotencyKey: KEY }),
      deleteNoteAction({ noteId: ID, idempotencyKey: "" }),
      setNotePinnedAction({ noteId: ID, pinned: null as unknown as boolean }),
      setNoteDoneAction({ noteId: "x", done: true }),
      setNoteArchivedAction({ noteId: ID, archived: 1 as unknown as boolean }),
      setNoteOrderAction({ ids: [] }),
      setNoteOrderAction({ ids: [ID, "x"] }),
      setNoteOrderAction({ ids: "x" as unknown as string[] }),
      addNoteAction(
        undefined as unknown as Parameters<typeof addNoteAction>[0]
      ),
    ]
    for (const result of await Promise.all(cases)) {
      expect(result).toEqual(INVALID)
    }
    expect(callRpc).not.toHaveBeenCalled()
  })

  it("accept a 2000-character note", async () => {
    await expect(
      addNoteAction({ body: ` ${"א".repeat(2000)} `, idempotencyKey: KEY })
    ).resolves.toEqual(OK)
  })
})
