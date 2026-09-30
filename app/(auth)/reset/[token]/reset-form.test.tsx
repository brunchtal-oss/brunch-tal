import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { completeResetAction } from "./actions"
import { ResetForm } from "./reset-form"

const completeReset = vi.fn()

vi.mock("@/lib/server/privileged/reset", () => ({
  completeReset: (...args: unknown[]) => completeReset(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: {} }),
}))

const TOKEN = "t".repeat(43)
const KEY = "22222222-2222-4222-8222-222222222222"

// The hidden inputs exactly as the form renders them.
function hiddenFields(html: string): FormData {
  const data = new FormData()
  for (const [tag] of html.matchAll(/<input[^>]*>/g)) {
    if (!/type="hidden"/.test(tag)) continue
    const name = /name="([^"]*)"/.exec(tag)?.[1]
    const value = /value="([^"]*)"/.exec(tag)?.[1]
    if (name !== undefined) data.append(name, value ?? "")
  }
  return data
}

beforeEach(() => {
  completeReset.mockReset()
})

describe("ResetForm", () => {
  it("sends the token and idempotency key under the names the action reads", async () => {
    const html = renderToStaticMarkup(
      <ResetForm token={TOKEN} idempotencyKey={KEY} linkState="active" />
    )
    const data = hiddenFields(html)
    data.append("password", "Test-pass-123")
    data.append("confirm", "Test-pass-123")
    completeReset.mockResolvedValue({ ok: true, data: { email: null } })

    await expect(completeResetAction(null, data)).resolves.toEqual({
      ok: true,
      data: { signedIn: false },
    })
    expect(completeReset).toHaveBeenCalledWith(TOKEN, "Test-pass-123", KEY)
  })
})
