import { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  ContactRow,
  ContactRows,
  CardActions,
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
    expect(html).toContain(adminCopy.payments.sendWhatsapp)
  })
})

// The first <button> in a stateless component's element tree.
function findButton(node: ReactNode): ReactElement<{
  onClick: () => void
}> | null {
  if (!isValidElement(node)) return null
  const el = node as ReactElement<{ children?: ReactNode }>
  if (el.type === "button") return el as never
  const kids = el.props.children
  for (const kid of Array.isArray(kids) ? kids : [kids]) {
    const found = findButton(kid)
    if (found) return found
  }
  return null
}

const card = adminCopy.customers.card

describe("a contact row's pencil (fix 9)", () => {
  const row = (open: boolean, onToggle = vi.fn()) => ({
    id: "card-phone",
    label: copy.phone,
    value: "054-123-4567",
    editLabel: copy.editPhone,
    open,
    onToggle,
    children: <input id="account-phone" />,
  })

  it("closed: aria-expanded false, the field not rendered, its box hidden", () => {
    const html = renderToStaticMarkup(<ContactRow {...row(false)} />)
    expect(html).toContain(`aria-label="${copy.editPhone}"`)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls="card-phone-edit"')
    expect(html).toMatch(/id="card-phone-edit" hidden/)
    expect(html).not.toContain("account-phone")
  })

  it("open: aria-expanded true and the field under the row", () => {
    const html = renderToStaticMarkup(<ContactRow {...row(true)} />)
    expect(html).toContain('aria-expanded="true"')
    expect(html).not.toMatch(/id="card-phone-edit" hidden/)
    expect(html).toContain('id="account-phone"')
  })

  it("a click on the pencil toggles (opens, and again closes)", () => {
    const onToggle = vi.fn()
    const button = findButton(ContactRow(row(false, onToggle)))!
    button.props.onClick()
    expect(onToggle).toHaveBeenCalledTimes(1)
    findButton(ContactRow(row(true, onToggle)))!.props.onClick()
    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it("no edit label: no pencil", () => {
    const html = renderToStaticMarkup(
      <ContactRow {...row(false)} editLabel={null} />
    )
    expect(html).not.toContain("<button")
  })
})

describe("the email and phone rows", () => {
  it("closed at first: both pencils, no field", () => {
    const html = renderToStaticMarkup(
      <dl>
        <ContactRows
          customerId={CUSTOMER}
          email="roni@example.test"
          phone="054-123-4567"
          view={view()}
        />
      </dl>
    )
    expect(html).toContain(`aria-label="${copy.editPhone}"`)
    expect(html).toContain(`aria-label="${copy.editEmail}"`)
    expect(html).not.toContain('aria-expanded="true"')
    expect(rowProps).toHaveLength(0)
  })

  it("stuck: the notice, the email field open, and the saved address can be saved again", async () => {
    changeEmailAction.mockResolvedValue({ ok: true, data: undefined })
    const html = renderToStaticMarkup(
      <dl>
        <ContactRows
          customerId={CUSTOMER}
          email="new@example.test"
          phone="054-123-4567"
          view={view({ stuck: true })}
        />
      </dl>
    )
    expect(html).toContain(copy.emailChangeStuck)
    expect(html).toContain('id="account-email"')
    expect(html).toMatch(
      new RegExp(`aria-label="${copy.editEmail}" aria-expanded="true"`)
    )
    const emailRow = rowProps.find((p) => p.label === card.email)!
    expect(emailRow.savedText).toBe("המייל עודכן. מעכשיו נכנסים איתו")
    expect(emailRow.newValue).toBe("new@example.test")
    const onSave = emailRow.onSave as (key: string) => Promise<unknown>
    await expect(onSave(KEY)).resolves.toEqual({ ok: true })
    expect(changeEmailAction).toHaveBeenCalledWith({
      customerId: CUSTOMER,
      email: "new@example.test",
      idempotencyKey: KEY,
    })
  })

  it("not activated: the phone pencil only, no email pencil", () => {
    const html = renderToStaticMarkup(
      <dl>
        <ContactRows
          customerId={CUSTOMER}
          email=""
          phone="054-123-4567"
          view={view({ canChangeEmail: false, canIssueReset: false })}
        />
      </dl>
    )
    expect(html).toContain(`aria-label="${copy.editPhone}"`)
    expect(html).not.toContain(copy.editEmail)
    expect(html).not.toContain(card.email)
  })
})

describe("the card actions", () => {
  it("activated: the reset button beside the slot", () => {
    const html = renderToStaticMarkup(
      <CardActions customerId={CUSTOMER} view={view()}>
        <a href="/book">book</a>
      </CardActions>
    )
    expect(html).toContain(copy.issueReset)
    expect(html).toMatch(/grid-cols-2[^>]*><button[^]*<a href="\/book">/)
  })

  it("not activated: no button row at all", () => {
    const html = renderToStaticMarkup(
      <CardActions
        customerId={CUSTOMER}
        view={view({ canChangeEmail: false, canIssueReset: false })}
      />
    )
    expect(html).toBe("")
  })

  it("the button always reads 'issue a reset link', in button-primary, with no status line", () => {
    const html = renderToStaticMarkup(
      <ResetLinkView
        pending={false}
        issued={null}
        error={null}
        onIssue={vi.fn()}
      >
        <a href="/book">book</a>
      </ResetLinkView>
    )
    expect(html).toContain(copy.issueReset)
    expect(html).toContain("bg-primary")
    expect(html).not.toContain("<time")
  })
})
