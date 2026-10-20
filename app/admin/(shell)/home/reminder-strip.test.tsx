import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"
import { errorMessage } from "@/lib/errors"

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))
vi.mock("../notifications/actions", () => ({ markRead: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin",
}))

const { currentReminder } = await import("./reminder-strip")
const { ReminderStripView, dismissReminder } =
  await import("./reminder-strip-view")

const copy = adminCopy.home

describe("the reminder strip (story 5.11)", () => {
  it("the newest reminder while unread: its body", () => {
    expect(
      currentReminder({
        id: "n1",
        payload: { title: "תזכורת שיווק", body: " סטורי אחד. קדימה. " },
        read_at: null,
      })
    ).toEqual({ id: "n1", body: "סטורי אחד. קדימה." })
  })

  it("the newest one read (an older one unread does not count): no strip", () => {
    expect(
      currentReminder({
        id: "n2",
        payload: { body: "x" },
        read_at: "2026-10-20T07:00:00Z",
      })
    ).toBeNull()
    expect(currentReminder(null)).toBeNull()
    expect(
      currentReminder({ id: "n3", payload: { body: "" }, read_at: null })
    ).toBeNull()
  })

  it("muted, a status, the body and a link-style close", () => {
    const html = renderToStaticMarkup(
      <ReminderStripView id="n1" body="סטורי אחד. קדימה." />
    )
    expect(html).toContain('role="status"')
    expect(html).toContain(`aria-label="${copy.reminderLabel}"`)
    expect(html).toContain("bg-muted")
    expect(html).toContain("סטורי אחד. קדימה.")
    expect(html).toContain(`>${copy.reminderDismiss}<`)
  })

  it("a failed close: the strip stays with the message from lib/errors.ts", async () => {
    const dismiss = vi.fn(async () => ({
      ok: false as const,
      code: "NOT_AUTHORIZED" as const,
    }))
    expect(await dismissReminder("n1", dismiss)).toBe(
      errorMessage("NOT_AUTHORIZED")
    )
    expect(dismiss).toHaveBeenCalledWith(["n1"])
    expect(
      await dismissReminder("n1", async () => {
        throw new Error("network")
      })
    ).toBe(errorMessage("SERVER_ERROR"))
    expect(
      await dismissReminder("n1", async () => ({
        ok: true,
        data: { marked: 1 },
      }))
    ).toBeNull()
  })
})
