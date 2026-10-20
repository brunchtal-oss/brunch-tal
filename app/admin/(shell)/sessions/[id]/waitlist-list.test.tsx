import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { WaitlistList } from "./waitlist-list"

const copy = adminCopy.sessions
const CUSTOMER = "77777777-7777-4777-8777-777777777777"

describe("WaitlistList (story 5.6)", () => {
  it("no one waits: nothing", () => {
    expect(renderToStaticMarkup(<WaitlistList waitlist={[]} />)).toBe("")
  })

  it("the heading with the count; her name links to her card, with her join time and the notified mark", () => {
    const html = renderToStaticMarkup(
      <WaitlistList
        waitlist={[
          {
            customerId: CUSTOMER,
            name: "Noa",
            // 12:15 in Jerusalem (summer time).
            joinedAt: "2026-10-05T09:15:00Z",
            notified: true,
          },
          {
            customerId: "c8",
            name: null,
            joinedAt: "2026-10-06T09:15:00Z",
            notified: false,
          },
        ]}
      />
    )
    expect(html).toContain(copy.waitlist.title(2))
    expect(html).toContain(`href="/admin/customers/${CUSTOMER}"`)
    expect(html).toContain("Noa")
    expect(html).toContain(copy.waitlist.joinedAt)
    expect(html).toContain("05.10 12:15")
    expect(html).toContain(copy.detailsRemoved)
    expect(html).not.toContain('href="/admin/customers/c8"')
    expect(html.split(copy.waitlist.notified).length - 1).toBe(1)
  })
})
