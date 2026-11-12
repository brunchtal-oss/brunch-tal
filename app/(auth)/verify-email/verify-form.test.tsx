import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { authCopy } from "@/lib/copy/auth"
import { safeNext } from "@/lib/auth/safe-next"

import { verifyEmailAction } from "./actions"
import { VerifyForm, verifyLoginHref } from "./verify-form"

// Story 6.11: verifying needs the account's own login. Signed out, the page
// shows the login prompt with the way back, and the action is never sent.

vi.mock("./actions", () => ({ verifyEmailAction: vi.fn() }))

const TOKEN = "Abc_-".repeat(8) + "xyz"
const copy = authCopy.verify

describe("VerifyForm", () => {
  it("signed out: the login prompt back to this link, no verify button", () => {
    const html = renderToStaticMarkup(
      <VerifyForm token={TOKEN} signedIn={false} />
    )
    expect(html).toContain(copy.loginNeeded)
    expect(html).toContain(
      `href="/login?next=${encodeURIComponent(`/verify-email?token=${TOKEN}`)}"`
    )
    expect(html).not.toContain(copy.submit)
    expect(html).not.toContain("<form")
    expect(verifyEmailAction).not.toHaveBeenCalled()
  })

  it("signed in: the verify button", () => {
    const html = renderToStaticMarkup(<VerifyForm token={TOKEN} signedIn />)
    expect(html).toContain(copy.submit)
    expect(html).not.toContain(copy.loginNeeded)
  })

  it("no token: LINK_INVALID with the login, signed in or not", () => {
    for (const signedIn of [true, false]) {
      const html = renderToStaticMarkup(
        <VerifyForm token="" signedIn={signedIn} />
      )
      expect(html).not.toContain(copy.loginNeeded)
      expect(html).toContain('href="/login"')
    }
  })

  it("the way back is an internal path the login accepts as it is", () => {
    const next = new URL(
      verifyLoginHref(TOKEN),
      "http://x.invalid"
    ).searchParams.get("next")
    expect(safeNext(next)).toBe(`/verify-email?token=${TOKEN}`)
  })
})
