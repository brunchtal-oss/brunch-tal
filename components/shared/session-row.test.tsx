import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

import { SessionRow, SessionRowList } from "./session-row"
import { StatusChip } from "./status-chip"

// 12.10.2026 10:30 in Jerusalem.
const STARTS = "2026-10-12T07:30:00Z"

const base = {
  href: "/me/sessions/s1",
  conceptName: "אמהות בחל״ד",
  startsAt: STARTS,
}

function visible(html: string): string {
  return html.replace(/<span class="sr-only">[^<]*<\/span>/g, "")
}

describe("SessionRow", () => {
  it("one link: the photo square, בראנץ׳, the name and the weekday and date", () => {
    const html = renderToStaticMarkup(<SessionRow {...base} />)
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain(`href="${base.href}"`)
    expect(html).toContain("size-[84px]")
    expect(html).toContain(customerCopy.brunch)
    expect(html).toContain(base.conceptName)
    expect(visible(html)).toContain("יום שני 12.10")
    expect(html).toContain("<h2")
  })

  it("never shows or says the time", () => {
    const html = renderToStaticMarkup(
      <SessionRow
        {...base}
        statusText={customerCopy.availability.full}
        status={
          <StatusChip tone="expired">
            {customerCopy.availability.full}
          </StatusChip>
        }
      />
    )
    expect(html).not.toContain("10:30")
    expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(/\d{2}:\d{2}/)
    // The accessible name: the title, the date and the status.
    expect(html).toContain(
      `<span class="sr-only">, יום שני, 12 באוקטובר, ${customerCopy.availability.full}</span>`
    )
  })

  it("without a photo: the muted square, never an empty frame", () => {
    const html = renderToStaticMarkup(<SessionRow {...base} photo={null} />)
    expect(html).toContain("bg-muted")
    expect(html).not.toContain("<img")
  })

  it("the status-chip sits under the date", () => {
    const html = renderToStaticMarkup(
      <SessionRow
        {...base}
        statusText={customerCopy.booked}
        status={<StatusChip tone="success">{customerCopy.booked}</StatusChip>}
      />
    )
    expect(html.indexOf("12.10</time>")).toBeLessThan(
      html.lastIndexOf(customerCopy.booked)
    )
  })

  it("the list draws a rule between the rows and around them", () => {
    const html = renderToStaticMarkup(
      <SessionRowList>
        <li>a</li>
      </SessionRowList>
    )
    expect(html).toContain("divide-y")
    expect(html).toContain("border-y")
  })
})
