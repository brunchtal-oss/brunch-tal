import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import { EmailRow } from "./email-row"

// Story 6.11: the profile's email row. "המייל אומת" only when the server
// says so; not verified: the label and the resend notice with its button.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/app/(auth)/verify-email/actions", () => ({
  resendVerificationAction: vi.fn(),
}))

const copy = customerCopy.profile
const banner = customerCopy.emailVerification

describe("EmailRow", () => {
  it("verified: the verified label, no notice", () => {
    const html = renderToStaticMarkup(
      <dl>
        <EmailRow email="her@example.test" verified />
      </dl>
    )
    expect(html).toContain("her@example.test")
    expect(html).toContain(`>${copy.emailVerified}<`)
    expect(html).not.toContain(copy.emailNotVerified)
    expect(html).not.toContain(banner.send)
    // The change lives in the details' edit form (user decision 2026-11-12).
    expect(html).not.toContain("<form")
    expect(html).not.toContain("<button")
  })

  it("after a change: where she logs in now, instead of the resend notice", () => {
    const html = renderToStaticMarkup(
      <dl>
        <EmailRow
          email="her@example.test"
          verified={false}
          changedTo="new@example.test"
        />
      </dl>
    )
    expect(html).toContain(copy.emailChangedBefore)
    expect(html).toContain("new@example.test")
    expect(html).not.toContain(banner.send)
  })

  it("not verified: the label and the resend notice", () => {
    const html = renderToStaticMarkup(
      <dl>
        <EmailRow email="her@example.test" verified={false} />
      </dl>
    )
    expect(html).toContain(`>${copy.emailNotVerified}<`)
    expect(html).not.toContain(`>${copy.emailVerified}<`)
    expect(html).toContain(banner.notice)
    expect(html).toContain(banner.send)
  })
})
