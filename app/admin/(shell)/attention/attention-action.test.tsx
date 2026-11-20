import type { ComponentProps } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"
import { ERROR_MESSAGES } from "@/lib/errors"

// The two online payment buttons (PR B) must be OnlineButtons: marked here.
vi.mock("@/components/shared/online-button", () => ({
  OnlineButton: (props: ComponentProps<"button">) => (
    <button data-online-button="" {...props} />
  ),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("./actions", () => ({
  closeUnconfirmedCheckoutAction: vi.fn(),
  markCorrectionHandledAction: vi.fn(),
  previewSettleParkedAction: vi.fn(),
  resolveOnlinePaymentIssueAction: vi.fn(),
  settleParkedAction: vi.fn(),
}))

const { AttentionActionButton } = await import("./attention-action")

const items = adminCopy.home.items
const ID = "44444444-4444-4444-8444-444444444444"

describe("online payment buttons under a 'לטיפול' row (PR B)", () => {
  it("סימון כטופל: an OnlineButton, its name with the customer", () => {
    const html = renderToStaticMarkup(
      <AttentionActionButton
        action={{ kind: "resolve_issue", issueId: ID, name: "Dana" }}
      />
    )
    expect(html).toContain("data-online-button")
    expect(html).toContain(">סימון כטופל<")
    expect(html).toContain('aria-label="סימון כטופל: Dana"')
    expect(html).not.toContain('role="alert"')
  })

  it("סגירה: an OnlineButton, its name 'סגירה: X'", () => {
    const html = renderToStaticMarkup(
      <AttentionActionButton
        action={{ kind: "close_checkout", checkoutId: ID, name: "Dana" }}
      />
    )
    expect(html).toContain("data-online-button")
    expect(html).toContain(">סגירה<")
    expect(html).toContain('aria-label="סגירה: Dana"')
  })

  it("the wording: one verb for unconfirmed, the action errors from lib/errors.ts", () => {
    expect(items.online_payment_unconfirmed.title("Dana")).toBe(
      "התשלום של Dana לא אומת"
    )
    expect(items.online_payment_unconfirmed.chip).toBe("לא אומת")
    expect(items.online_payment_unconfirmed.detail).toContain("שלא אומת")
    expect(ERROR_MESSAGES.CHECKOUT_NOT_CLOSABLE).toBeTruthy()
  })
})
