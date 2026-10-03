import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"
import { errorMessage } from "@/lib/errors"

import {
  LinksList,
  ReplacedPanel,
  rowErrorMessage,
  withReplaced,
  type LinkListItem,
} from "./links-list"

vi.mock("./actions", () => ({
  revokeLinkAction: vi.fn(),
  replaceLinkAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const copy = adminCopy.links

const item = (overrides: Partial<LinkListItem> = {}): LinkListItem => ({
  tokenId: "tok-1",
  paymentId: "pay-1",
  title: copy.rowTitle.pending,
  purchase: "Card · 472 ₪ · אושר 01.10",
  status: "pending",
  statusLabel: copy.status.pending,
  timeAt: "2026-10-05T09:00:00Z",
  timeLine: "time line",
  detail: null,
  canRevoke: true,
  canReplace: true,
  revokeKey: "k1",
  replaceKey: "k2",
  ...overrides,
})

describe("LinksList", () => {
  it("shows the empty state", () => {
    const html = renderToStaticMarkup(<LinksList items={[]} />)
    expect(html).toContain(copy.empty)
  })

  it("shows a row with its status, details and both actions", () => {
    const html = renderToStaticMarkup(
      <LinksList
        items={[item({ detail: { text: "stuck detail", attention: true } })]}
      />
    )
    for (const text of [
      copy.rowTitle.pending,
      "472 ₪",
      copy.status.pending,
      "time line",
      "stuck detail",
      copy.revoke,
      copy.replace,
    ]) {
      expect(html).toContain(text)
    }
  })

  it("shows no action a row does not allow, and never a link to copy", () => {
    const html = renderToStaticMarkup(
      <LinksList
        items={[
          item({
            status: "consumed",
            title: "Dana",
            statusLabel: copy.status.consumed,
            canRevoke: false,
            canReplace: false,
          }),
        ]}
      />
    )
    expect(html).toContain("Dana")
    expect(html).not.toContain(copy.revoke)
    expect(html).not.toContain(copy.replace)
    expect(html).not.toContain(adminCopy.payments.copyLink)
  })
})

describe("replacement links", () => {
  const entry = (
    paymentId: string,
    link: string | null = "https://h/join/x"
  ) => ({
    paymentId,
    link,
    linkExpiresAt: "2026-10-05T09:00:00Z",
  })

  it("keeps the replacement of every payment; only a new one of the same payment takes its place", () => {
    const first = withReplaced([], entry("pay-1", "https://h/join/a"))
    const both = withReplaced(first, entry("pay-2", "https://h/join/b"))
    expect(both.map((e) => e.link)).toEqual([
      "https://h/join/b",
      "https://h/join/a",
    ])
    const again = withReplaced(both, entry("pay-1", "https://h/join/c"))
    expect(again.map((e) => e.link)).toEqual([
      "https://h/join/c",
      "https://h/join/b",
    ])
  })

  it("shows the notice, the validity line and the send buttons", () => {
    const html = renderToStaticMarkup(
      <ReplacedPanel replaced={entry("pay-1")} />
    )
    expect(html).toContain(copy.replaced)
    expect(html).toContain(adminCopy.payments.linkValidUntil)
    // Monday 05.10 at 12:00 in Jerusalem.
    expect(html).toContain("05.10 · 12:00")
    expect(html).toContain(adminCopy.payments.sendWhatsapp)
    expect(html).toContain(adminCopy.payments.copyLink)
  })

  it("explains a repeat without the link", () => {
    const html = renderToStaticMarkup(
      <ReplacedPanel replaced={entry("pay-1", null)} />
    )
    expect(html).toContain(adminCopy.payments.linkNotShown)
    expect(html).not.toContain(adminCopy.payments.sendWhatsapp)
  })
})

describe("rowErrorMessage", () => {
  it("words LINK_USED as a link the customer already used", () => {
    expect(rowErrorMessage("LINK_USED")).toBe(copy.linkUsed)
    expect(rowErrorMessage("LINK_USED")).not.toBe(errorMessage("LINK_USED"))
  })

  it("keeps the shared wording of other codes", () => {
    expect(rowErrorMessage("LINK_IN_PROGRESS")).toBe(
      errorMessage("LINK_IN_PROGRESS")
    )
  })
})
