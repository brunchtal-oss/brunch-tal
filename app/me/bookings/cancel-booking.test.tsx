import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { customerCopy } from "@/lib/copy/customer"

vi.mock("./actions", () => ({ cancelBookingAction: vi.fn() }))

const { PinnedCancelChoice, confirmBlocked } = await import("./cancel-booking")

const copy = customerCopy.cancel

describe("the cancel sheet's choice (story 3.7)", () => {
  it("a pinned booking: both options as radio-cards, none chosen", () => {
    const html = renderToStaticMarkup(
      <PinnedCancelChoice
        bookingId="b1"
        optionsCount={2}
        choice={null}
        onChoose={() => {}}
      />
    )
    expect(html).toContain(copy.returns)
    expect(html).toContain("זיכוי למפגש אחר")
    expect(html).toContain("אפשר להירשם לאחד מ-2 המפגשים המתאימים הבאים")
    expect(html).toContain("החזר כספי")
    expect(html).toContain("בקשת ההחזר תגיע אלינו, ונעדכן כשההחזר יבוצע")
    expect(html.split('type="radio"').length - 1).toBe(2)
    expect(html).not.toContain('checked=""')
  })

  it("'כן, לבטל' is disabled until a pinned booking has a choice; never for a card or a credit", () => {
    expect(confirmBlocked("pinned", null)).toBe(true)
    expect(confirmBlocked("pinned", "credit")).toBe(false)
    expect(confirmBlocked("pinned", "refund")).toBe(false)
    expect(confirmBlocked("card", null)).toBe(false)
    expect(confirmBlocked("credit", null)).toBe(false)
  })
})
