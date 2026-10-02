import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { ApprovedLink } from "./payment-form"

vi.mock("./actions", () => ({
  approvePaymentAction: vi.fn(),
  previewPaymentAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const EXPIRES = "2026-10-03T07:42:00+00:00"
const copy = adminCopy.payments

describe("ApprovedLink", () => {
  it("offers WhatsApp and copy for a new link", () => {
    const html = renderToStaticMarkup(
      <ApprovedLink
        link="https://host.example/join/abc"
        linkExpiresAt={EXPIRES}
      />
    )
    expect(html).toContain(copy.success)
    expect(html).toContain(copy.sendWhatsapp)
    expect(html).toContain(copy.copyLink)
    expect(html).not.toContain(copy.linkNotShown)
  })

  it("explains, without send buttons, that a repeat cannot show the link", () => {
    const html = renderToStaticMarkup(
      <ApprovedLink link={null} linkExpiresAt={EXPIRES} />
    )
    expect(html).toContain(copy.linkNotShown)
    expect(html).not.toContain(copy.success)
    expect(html).not.toContain(copy.sendWhatsapp)
    expect(html).not.toContain(copy.copyLink)
    expect(html).toContain(copy.another)
  })
})
