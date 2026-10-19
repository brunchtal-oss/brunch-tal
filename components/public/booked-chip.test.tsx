import { readFileSync } from "node:fs"
import { join } from "node:path"

import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

const getViewerRole = vi.fn()
const createClient = vi.fn()
const bookedEventIds = vi.fn()

vi.mock("@/lib/auth/viewer-role", () => ({
  getViewerRole: () => getViewerRole(),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}))
vi.mock("@/app/me/sessions/load-sessions", () => ({
  bookedEventIds: (...args: unknown[]) => bookedEventIds(...args),
}))

const { BookedChip, myBookedEventIds } = await import("./booked-chip")

const A = "00000000-0000-4000-8000-00000000000a"
const B = "00000000-0000-4000-8000-00000000000b"
const IDS = `${A},${B}`

beforeEach(() => {
  getViewerRole.mockReset()
  createClient.mockReset().mockResolvedValue({ client: true })
  bookedEventIds.mockReset()
})

async function render(eventId: string) {
  return renderToStaticMarkup(
    (await BookedChip({ eventId, eventIds: IDS })) ?? <></>
  )
}

// Story 5.21: "נרשמת" on public /sessions.
describe("BookedChip", () => {
  it("a customer: 'נרשמת' on her booked session only", async () => {
    getViewerRole.mockResolvedValue("customer")
    bookedEventIds.mockResolvedValue(new Set([A]))
    expect(await render(A)).toContain(customerCopy.booked)
    expect(await render(B)).toBe("")
    expect(bookedEventIds).toHaveBeenCalledWith({ client: true }, [A, B])
  })

  it.each([null, "admin", "none"])(
    "a viewer whose role is %s: no chip, no bookings read",
    async (role) => {
      getViewerRole.mockResolvedValue(role)
      expect(await render(A)).toBe("")
      expect(createClient).not.toHaveBeenCalled()
      expect(bookedEventIds).not.toHaveBeenCalled()
    }
  )

  it("a failed read: no chip", async () => {
    getViewerRole.mockResolvedValue("customer")
    bookedEventIds.mockRejectedValue(new Error("bookings read failed"))
    expect(await myBookedEventIds(IDS)).toEqual(new Set())
    expect(await render(A)).toBe("")
  })
})

describe("the public list read", () => {
  it("uses only the anon client: no cookies, no server client", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/sessions/public.ts"),
      "utf8"
    )
    expect(source).toContain("createPublicClient")
    expect(source).not.toMatch(/supabase\/server|cookies|use cache/)
  })
})
