import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import { BalanceCard } from "./balance-card"

describe("BalanceCard", () => {
  it("shows the counts and the validity", () => {
    const html = renderToStaticMarkup(
      <BalanceCard available={4} reserved={1} expiresOn="2026-11-19" />
    )
    expect(html).toContain(customerCopy.available(4))
    expect(html).toContain(customerCopy.reserved(1))
    expect(html).toContain(customerCopy.validUntil)
  })

  it("shows only the note of a card that expired before it was bound", () => {
    const html = renderToStaticMarkup(
      <BalanceCard
        available={4}
        reserved={0}
        expiresOn="2026-09-01"
        expiredNote={<p>{customerCopy.expiredBeforeBound}</p>}
      />
    )
    expect(html).toContain(customerCopy.expiredBeforeBound)
    expect(html).not.toContain(customerCopy.available(4))
    expect(html).not.toContain(customerCopy.reserved(0))
    expect(html).not.toContain(customerCopy.validUntil)
  })
})
