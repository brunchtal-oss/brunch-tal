import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import { EmailVerificationBanner } from "./email-verification-banner"
import { EmailVerificationNotice } from "./email-verification-notice"

// Story 6.11: the banner of the customer home and the admin home. Shown
// only while get_my_email_verified says false; nothing when verified or
// when the read fails.

const callRpc = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }))

const copy = customerCopy.emailVerification
const resend = vi.fn()

beforeEach(() => {
  callRpc.mockReset()
})

describe("EmailVerificationNotice", () => {
  it("the reason and the send button (a write button, online-guarded)", () => {
    const html = renderToStaticMarkup(
      <EmailVerificationNotice resend={resend} />
    )
    expect(html).toContain(copy.notice)
    expect(html).toContain(copy.send)
    expect(html).toContain('role="status"')
    expect(html).not.toContain("טל")
  })
})

describe("EmailVerificationBanner", () => {
  const render = async () => {
    const element = await EmailVerificationBanner({ resend })
    return element ? renderToStaticMarkup(element) : ""
  }

  it("not verified: the notice", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { verified: false } })
    expect(await render()).toContain(copy.notice)
    expect(callRpc.mock.calls[0][1]).toBe("get_my_email_verified")
  })

  it("verified: nothing", async () => {
    callRpc.mockResolvedValue({ ok: true, data: { verified: true } })
    expect(await render()).toBe("")
  })

  it("a failed read: nothing (the page goes on)", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "SERVER_ERROR" })
    expect(await render()).toBe("")
  })
})
