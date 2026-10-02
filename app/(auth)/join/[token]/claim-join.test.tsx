import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { joinCopy } from "@/lib/copy/join"
import { errorMessage } from "@/lib/errors"
import { shellCopy } from "@/lib/copy/shell"

import type { ClaimFormState } from "./actions"
import { ClaimJoin, ClaimScreen, ExistingAccountLogin } from "./claim-join"
import { claimLoginHref } from "./join-view"

vi.mock("./actions", () => ({ claimJoinAction: vi.fn() }))
vi.mock("@/lib/auth/sign-out", () => ({ signOutAction: vi.fn() }))

const TOKEN = "t".repeat(43)
const KEY = "22222222-2222-4222-8222-222222222222"

function screen(state: ClaimFormState, pending = false) {
  return renderToStaticMarkup(
    <ClaimScreen
      state={state}
      pending={pending}
      token={TOKEN}
      idempotencyKey={KEY}
      productName="Card"
      amountAgorot={47200}
    />
  )
}

describe("ExistingAccountLogin", () => {
  it("links to the login with the join link as next, without a heading", () => {
    const html = renderToStaticMarkup(<ExistingAccountLogin token={TOKEN} />)
    expect(html).toContain(joinCopy.existingAccount)
    expect(html).toContain(joinCopy.existingAccountLogin)
    expect(html).toContain(`href="/login?next=%2Fjoin%2F${TOKEN}"`)
    expect(html).not.toMatch(/<h1/)
    expect(claimLoginHref(TOKEN)).toBe(`/login?next=%2Fjoin%2F${TOKEN}`)
  })
})

describe("ClaimJoin", () => {
  it("asks to confirm: product, amount, the note and the button, with the token and key", () => {
    const html = renderToStaticMarkup(
      <ClaimJoin
        token={TOKEN}
        idempotencyKey={KEY}
        productName="Card"
        amountAgorot={47200}
      />
    )
    expect(html).toContain("Card")
    expect(html).toContain("472 ₪")
    expect(html).toContain(joinCopy.claimNote)
    expect(html).toContain(joinCopy.claimSubmit)
    expect(html).toContain(`name="token" value="${TOKEN}"`)
    expect(html).toContain(`name="idempotencyKey" value="${KEY}"`)
    expect(html).not.toMatch(/<h1/)
  })

  it("shows the pending label while sending", () => {
    const html = screen(null, true)
    expect(html).toContain(joinCopy.claimPending)
    expect(html).toContain('aria-busy="true"')
  })

  it("offers sign-out back to the join link for another account", () => {
    const html = screen({ status: "other_account" })
    expect(html).toContain(joinCopy.otherAccount)
    expect(html).toContain(shellCopy.signOut)
    expect(html).toContain(`name="next" value="/join/${TOKEN}"`)
    expect(html).not.toContain(joinCopy.claimSubmit)
  })

  it.each([
    [
      { status: "conflict", reason: "bind_conflict" },
      joinCopy.conflicts.bind_conflict,
    ],
    [{ status: "expired" }, errorMessage("LINK_EXPIRED")],
    [{ status: "used" }, joinCopy.used],
  ] as const)("shows the %j screen instead of the button", (state, text) => {
    const html = screen(state)
    expect(html).toContain(text)
    expect(html).not.toContain(joinCopy.claimSubmit)
  })

  it("keeps the button with an error", () => {
    const html = screen({ status: "error", code: "SERVER_ERROR" })
    expect(html).toContain(errorMessage("SERVER_ERROR"))
    expect(html).toContain(joinCopy.claimSubmit)
  })
})

describe("contact link", () => {
  const HREF = "https://wa.me/972544256456"

  it("links the contact phrase of a conflict to WhatsApp", () => {
    const html = renderToStaticMarkup(
      <ClaimScreen
        state={{ status: "conflict", reason: "bind_conflict" }}
        pending={false}
        token={TOKEN}
        idempotencyKey={KEY}
        productName="Card"
        amountAgorot={47200}
        contactHref={HREF}
      />
    )
    expect(html).toContain(`href="${HREF}"`)
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain(`>${joinCopy.contactPhrase}</a>`)
  })

  it("keeps plain text without published business details", () => {
    const html = screen({ status: "conflict", reason: "bind_conflict" })
    expect(html).toContain(joinCopy.conflicts.bind_conflict)
    expect(html).not.toContain("<a ")
  })
})
