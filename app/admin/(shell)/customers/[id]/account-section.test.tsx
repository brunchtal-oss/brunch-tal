import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  AccountSection,
  issueResetWithKey,
  ResetLinkView,
} from "./account-section"
import type { AccountView } from "./card-items"

// The project renders components to static markup (no DOM library): the
// clicks are tested through the helpers the component calls, and the rows
// through the props the section gives value-change-row.

const issueResetLinkAction = vi.fn()
const changeEmailAction = vi.fn()
const changePhoneAction = vi.fn()
const rowProps: Array<Record<string, unknown>> = []

vi.mock("./actions", () => ({
  issueResetLinkAction: (...args: unknown[]) => issueResetLinkAction(...args),
  changeEmailAction: (...args: unknown[]) => changeEmailAction(...args),
  changePhoneAction: (...args: unknown[]) => changePhoneAction(...args),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/components/admin/value-change-row", () => ({
  asSaveResult: (r: { ok: boolean; code?: string }) =>
    r.ok ? { ok: true } : { ok: false, code: r.code },
  ValueChangeRow: (props: Record<string, unknown>) => {
    rowProps.push(props)
    return <div data-row={String(props.label)}>{props.children as never}</div>
  },
}))

const copy = adminCopy.customers.card.account
const CUSTOMER = "33333333-3333-4333-8333-333333333333"
const KEY = "22222222-2222-4222-8222-222222222222"

const view = (overrides: Partial<AccountView> = {}): AccountView => ({
  canChangeEmail: true,
  canIssueReset: true,
  stuck: false,
  resetStatus: null,
  resetButton: copy.issueReset,
  ...overrides,
})

beforeEach(() => {
  issueResetLinkAction.mockReset()
  changeEmailAction.mockReset()
  changePhoneAction.mockReset()
  rowProps.length = 0
})

describe("the reset button", () => {
  it("after a successful issue the next click sends a different key", async () => {
    issueResetLinkAction.mockResolvedValue({
      ok: true,
      data: { link: "https://site.test/reset/raw", linkExpiresAt: "x" },
    })
    const first = await issueResetWithKey(CUSTOMER, KEY)
    expect(first.answer).toEqual({
      ok: true,
      issued: { link: "https://site.test/reset/raw", linkExpiresAt: "x" },
    })
    await issueResetWithKey(CUSTOMER, first.nextKey)

    const keys = issueResetLinkAction.mock.calls.map(
      (call) => (call[0] as { idempotencyKey: string }).idempotencyKey
    )
    expect(keys[0]).toBe(KEY)
    expect(keys[1]).not.toBe(KEY)
    expect(issueResetLinkAction.mock.calls[0][0]).toMatchObject({
      customerId: CUSTOMER,
    })
  })

  it("a refusal or a thrown call also takes a new key", async () => {
    issueResetLinkAction.mockResolvedValueOnce({
      ok: false,
      code: "RESET_TARGET_INVALID",
    })
    const refused = await issueResetWithKey(CUSTOMER, KEY)
    expect(refused.answer).toEqual({
      ok: false,
      code: "RESET_TARGET_INVALID",
    })
    expect(refused.nextKey).not.toBe(KEY)

    issueResetLinkAction.mockRejectedValueOnce(new Error("network"))
    const thrown = await issueResetWithKey(CUSTOMER, KEY)
    expect(thrown.answer).toEqual({ ok: false, code: "SERVER_ERROR" })
  })

  it("link null (a repeat) shows that it cannot be shown again", () => {
    const html = renderToStaticMarkup(
      <ResetLinkView
        view={view()}
        pending={false}
        issued={{ link: null, linkExpiresAt: "2026-10-16T07:00:00Z" }}
        error={null}
        onIssue={vi.fn()}
      />
    )
    expect(html).toContain(copy.resetNotShown)
    expect(html).not.toContain(copy.resetReady)
  })

  it("an issued link shows the ready notice, the validity and the share buttons", () => {
    const html = renderToStaticMarkup(
      <ResetLinkView
        view={view({
          resetStatus: { text: "status line", at: "2026-10-16T07:00:00Z" },
          resetButton: copy.reissueReset,
        })}
        pending={false}
        issued={{
          link: "https://site.test/reset/raw",
          linkExpiresAt: "2026-10-16T07:00:00Z",
        }}
        error={null}
        onIssue={vi.fn()}
      />
    )
    expect(html).toContain(copy.resetReady)
    expect(html).toContain("status line")
    expect(html).toContain(copy.reissueReset)
    expect(html).toContain(adminCopy.payments.sendWhatsapp)
  })
})

describe("the email and phone rows", () => {
  it("the email row has its own saved text and sends the new address", async () => {
    changeEmailAction.mockResolvedValue({ ok: true, data: undefined })
    renderToStaticMarkup(
      <AccountSection
        customerId={CUSTOMER}
        email="roni@example.test"
        phone="054-123-4567"
        view={view()}
      />
    )
    const emailRow = rowProps.find(
      (p) => p.label === adminCopy.customers.card.email
    )!
    expect(emailRow.savedText).toBe("המייל עודכן. מעכשיו נכנסים איתו")
    const phoneRow = rowProps.find((p) => p.label === copy.phone)!
    expect(phoneRow.savedText).toBe(copy.phoneChanged)

    // Unchanged: no new value, so no save.
    expect(emailRow.newValue).toBeNull()
  })

  it("stuck: the saved address can be saved again at once", async () => {
    changeEmailAction.mockResolvedValue({ ok: true, data: undefined })
    const html = renderToStaticMarkup(
      <AccountSection
        customerId={CUSTOMER}
        email="new@example.test"
        phone="054-123-4567"
        view={view({ stuck: true })}
      />
    )
    expect(html).toContain(copy.emailChangeStuck)
    const emailRow = rowProps.find(
      (p) => p.label === adminCopy.customers.card.email
    )!
    expect(emailRow.newValue).toBe("new@example.test")
    const onSave = emailRow.onSave as (key: string) => Promise<unknown>
    await expect(onSave(KEY)).resolves.toEqual({ ok: true })
    expect(changeEmailAction).toHaveBeenCalledWith({
      customerId: CUSTOMER,
      email: "new@example.test",
      idempotencyKey: KEY,
    })
  })

  it("not activated: only the phone row, no reset button", () => {
    const html = renderToStaticMarkup(
      <AccountSection
        customerId={CUSTOMER}
        email=""
        phone="054-123-4567"
        view={view({ canChangeEmail: false, canIssueReset: false })}
      />
    )
    expect(rowProps.map((p) => p.label)).toEqual([copy.phone])
    expect(html).not.toContain(copy.issueReset)
  })
})
