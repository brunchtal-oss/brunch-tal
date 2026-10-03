import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { whatsappShareHref } from "@/components/admin/link-share"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage } from "@/lib/errors"

import {
  LinksList,
  ReplacedPanel,
  canSend,
  rowErrorMessage,
  resultOf,
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

  it("keeps only the latest action's result: a later action replaces the panel", () => {
    const row = { tokenId: "tok-1", paymentId: "pay-1" }
    const data = {
      link: "https://h/join/a",
      linkExpiresAt: "2026-10-05T09:00:00Z",
    }
    expect(resultOf("replace", row, { ok: true, data })).toEqual({
      kind: "replaced",
      replaced: { paymentId: "pay-1", ...data },
    })
    // The next action, on any row, is the one result shown.
    expect(
      resultOf("revoke", { tokenId: "tok-2", paymentId: "pay-2" }, { ok: true })
    ).toEqual({ kind: "revoked" })
    expect(
      resultOf(
        "replace",
        { tokenId: "tok-2", paymentId: "pay-2" },
        { ok: false, code: "LINK_IN_PROGRESS" }
      )
    ).toEqual({ kind: "error", tokenId: "tok-2", code: "LINK_IN_PROGRESS" })
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

describe("send on WhatsApp", () => {
  const send = adminCopy.payments.sendWhatsapp

  it.each([
    ["pending", true, true],
    ["expired", true, true],
    ["pending", false, false],
    ["consumed", true, false],
    ["revoked", true, false],
  ] as const)(
    "a %s row with can_replace %s: %s",
    (status, canReplace, shown) => {
      expect(canSend({ status, canReplace })).toBe(shown)
      const html = renderToStaticMarkup(
        <LinksList
          items={[
            item({ status, canReplace, canRevoke: status === "pending" }),
          ]}
        />
      )
      expect(html.includes(send)).toBe(shown)
    }
  )

  it("shows only the sent notice afterwards, never the link", () => {
    const row = { tokenId: "tok-1", paymentId: "pay-1" }
    expect(
      resultOf("send", row, {
        ok: true,
        data: {
          link: "https://h/join/a",
          linkExpiresAt: "2026-10-05T09:00:00Z",
        },
      })
    ).toEqual({ kind: "sent" })
    // A repeat of the same key has no link: shown like a replacement whose
    // link cannot be shown again.
    expect(
      resultOf("send", row, {
        ok: true,
        data: { link: null, linkExpiresAt: "2026-10-05T09:00:00Z" },
      })
    ).toMatchObject({ kind: "replaced" })
    expect(resultOf("send", row, { ok: false, code: "LINK_USED" })).toEqual({
      kind: "error",
      tokenId: "tok-1",
      code: "LINK_USED",
    })
    expect(copy.sent).toBe("נוצר קישור חדש. הקישור הקודם בוטל")
  })

  it("builds the WhatsApp share like the send button after an approval", () => {
    expect(whatsappShareHref("https://h/join/a b")).toBe(
      "https://wa.me/?text=https%3A%2F%2Fh%2Fjoin%2Fa%20b"
    )
  })
})
