import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  addBaby,
  deleteBaby,
  setPhotoConsent,
  updateBaby,
  updateDetails,
} from "./actions"

const callRpc = vi.fn()
const revalidatePath = vi.fn()
const getClaims = vi.fn()

// One write of a test: the table, the operation, its values and filters.
type Write = {
  table: string
  op?: string
  values?: unknown
  eq?: [string, unknown]
}
let writes: Write[] = []
let result: { data: unknown; error: unknown } = { data: null, error: null }

function from(table: string) {
  const write: Write = { table }
  writes.push(write)
  const builder = {
    insert(values: unknown) {
      Object.assign(write, { op: "insert", values })
      return Promise.resolve(result)
    },
    update(values: unknown) {
      Object.assign(write, { op: "update", values })
      return builder
    },
    delete() {
      write.op = "delete"
      return builder
    },
    eq(column: string, value: unknown) {
      write.eq = [column, value]
      return builder
    },
    select() {
      return Promise.resolve(result)
    },
  }
  return builder
}

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}))
vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, auth: { getClaims } }),
}))

const USER = "11111111-1111-4111-8111-111111111111"
const BABY = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  writes = []
  result = { data: [{ id: "x" }], error: null }
  callRpc.mockReset()
  revalidatePath.mockReset()
  getClaims.mockReset()
  getClaims.mockResolvedValue({ data: { claims: { sub: USER } } })
})

describe("updateDetails", () => {
  it("writes the trimmed name and empty dietary notes as null, on her own row", async () => {
    await expect(
      updateDetails({ fullName: "  Dana  ", dietaryNotes: "   " })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(writes).toEqual([
      {
        table: "profiles",
        op: "update",
        values: { full_name: "Dana", dietary_notes: null },
        eq: ["id", USER],
      },
    ])
    expect(revalidatePath).toHaveBeenCalledWith("/me/profile")
  })

  it("keeps written dietary notes as written (trimmed)", async () => {
    await updateDetails({ fullName: "Dana", dietaryNotes: " vegan\nno nuts " })
    expect(writes[0].values).toEqual({
      full_name: "Dana",
      dietary_notes: "vegan\nno nuts",
    })
  })

  it.each([
    [{ fullName: " ", dietaryNotes: "" }, "FIELD_REQUIRED", "full_name"],
    [null, "FIELD_REQUIRED", "full_name"],
    [
      { fullName: "a".repeat(201), dietaryNotes: "" },
      "INVALID_INPUT",
      "full_name",
    ],
    [
      { fullName: "Dana", dietaryNotes: "a".repeat(2001) },
      "INVALID_INPUT",
      "dietary_notes",
    ],
    // Missing notes never erase the saved ones.
    [{ fullName: "Dana" }, "INVALID_INPUT", "dietary_notes"],
    [{ fullName: "Dana", dietaryNotes: 5 }, "INVALID_INPUT", "dietary_notes"],
  ])(
    "refuses %j with %s on %s, without writing",
    async (input, code, field) => {
      await expect(
        updateDetails(
          input as unknown as { fullName: string; dietaryNotes: string }
        )
      ).resolves.toEqual({ ok: false, code, detail: { field } })
      expect(writes).toEqual([])
    }
  )

  it("is NOT_AUTHORIZED when no row is hers (RLS) or no session", async () => {
    result = { data: [], error: null }
    await expect(
      updateDetails({ fullName: "Dana", dietaryNotes: "" })
    ).resolves.toEqual({ ok: false, code: "NOT_AUTHORIZED" })
    getClaims.mockResolvedValue({ data: null })
    await expect(
      updateDetails({ fullName: "Dana", dietaryNotes: "" })
    ).resolves.toEqual({ ok: false, code: "NOT_AUTHORIZED" })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})

describe("babies", () => {
  it("adds a baby without customer_id", async () => {
    await expect(
      addBaby({ name: " Ori ", birthDate: "2026-07-05" })
    ).resolves.toEqual({ ok: true, data: undefined })
    expect(writes).toEqual([
      {
        table: "babies",
        op: "insert",
        values: { name: "Ori", birth_date: "2026-07-05" },
      },
    ])
  })

  it("refuses a missing name or a bad date without writing", async () => {
    await expect(
      addBaby({ name: "", birthDate: "2026-07-05" })
    ).resolves.toEqual({
      ok: false,
      code: "FIELD_REQUIRED",
      detail: { field: "baby_name" },
    })
    await expect(addBaby({ name: "Ori", birthDate: " " })).resolves.toEqual({
      ok: false,
      code: "FIELD_REQUIRED",
      detail: { field: "birth_date" },
    })
    await expect(
      addBaby({ name: "a".repeat(101), birthDate: "2026-07-05" })
    ).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "baby_name" },
    })
    for (const birthDate of ["2026-02-30", "05.07.2026"]) {
      await expect(addBaby({ name: "Ori", birthDate })).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
        detail: { field: "birth_date" },
      })
    }
    expect(writes).toEqual([])
  })

  it("passes the database's refusal through with its field", async () => {
    result = {
      data: null,
      error: {
        code: "P0001",
        message: "INVALID_INPUT",
        details: '{"field": "birth_date"}',
      },
    }
    await expect(
      addBaby({ name: "Ori", birthDate: "2099-01-01" })
    ).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "birth_date" },
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("updates one baby by id", async () => {
    await updateBaby({ id: BABY, name: "Ori", birthDate: "2026-07-05" })
    expect(writes).toEqual([
      {
        table: "babies",
        op: "update",
        values: { name: "Ori", birth_date: "2026-07-05" },
        eq: ["id", BABY],
      },
    ])
  })

  it("is NOT_FOUND when the baby to update is not hers, without revalidating", async () => {
    result = { data: [], error: null }
    await expect(
      updateBaby({ id: BABY, name: "Ori", birthDate: "2026-07-05" })
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("passes an update's database refusal through with its field", async () => {
    result = {
      data: null,
      error: {
        code: "P0001",
        message: "INVALID_INPUT",
        details: '{"field": "birth_date"}',
      },
    }
    await expect(
      updateBaby({ id: BABY, name: "Ori", birthDate: "2099-01-01" })
    ).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "birth_date" },
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it("deletes one baby, and passes LAST_BABY through", async () => {
    await expect(deleteBaby({ id: BABY })).resolves.toEqual({
      ok: true,
      data: undefined,
    })
    expect(writes).toEqual([
      { table: "babies", op: "delete", eq: ["id", BABY] },
    ])
    result = { data: null, error: { code: "P0001", message: "LAST_BABY" } }
    await expect(deleteBaby({ id: BABY })).resolves.toEqual({
      ok: false,
      code: "LAST_BABY",
    })
  })

  it("is NOT_FOUND when the baby is not hers, and refuses a bad id", async () => {
    result = { data: [], error: null }
    await expect(deleteBaby({ id: BABY })).resolves.toEqual({
      ok: false,
      code: "NOT_FOUND",
    })
    writes = []
    await expect(deleteBaby({ id: "nope" })).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
    })
    await expect(
      updateBaby({ id: "nope", name: "Ori", birthDate: "2026-07-05" })
    ).resolves.toEqual({ ok: false, code: "INVALID_INPUT" })
    expect(writes).toEqual([])
  })

  it("hides a raw database error as SERVER_ERROR", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    result = { data: null, error: { code: "42501", message: "denied" } }
    await expect(deleteBaby({ id: BABY })).resolves.toEqual({
      ok: false,
      code: "SERVER_ERROR",
    })
  })
})

describe("setPhotoConsent", () => {
  it("calls set_photo_consent with the session", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { photo_consent: true } })
    await expect(setPhotoConsent({ consent: true })).resolves.toEqual({
      ok: true,
      data: undefined,
    })
    expect(callRpc).toHaveBeenCalledWith(
      expect.objectContaining({ from }),
      "set_photo_consent",
      { p_consent: true }
    )
    expect(revalidatePath).toHaveBeenCalledWith("/me/profile")
  })

  it("refuses a non-boolean and passes the RPC's code through", async () => {
    await expect(
      setPhotoConsent({ consent: "yes" as unknown as boolean })
    ).resolves.toEqual({
      ok: false,
      code: "INVALID_INPUT",
      detail: { field: "photo_consent" },
    })
    expect(callRpc).not.toHaveBeenCalled()
    callRpc.mockResolvedValue({ ok: false, code: "NOT_AUTHORIZED" })
    await expect(setPhotoConsent({ consent: false })).resolves.toEqual({
      ok: false,
      code: "NOT_AUTHORIZED",
    })
  })
})
