import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  MAX_SESSIONS,
  previewLine,
  resultItems,
  resultsHeading,
  selectionCap,
} from "./booking-results"

const many = adminCopy.sessions.bookMany

describe("several sessions for one customer", () => {
  it("the copy of the bar, the sheet and the results", () => {
    expect(many.choose(1)).toBe("לרישום למפגש אחד")
    expect(many.choose(3)).toBe("לרישום ל-3 מפגשים")
    expect(many.sheetTitle("רוני")).toBe("רישום של רוני")
    expect(many.confirm).toBe("לאשר את הרישום")
    expect(many.backToList).toBe("חזרה לרשימה")
    expect(MAX_SESSIONS).toBe(20)
  })

  it("the cap: her free entries, never above 20; the line and the counter", () => {
    expect(selectionCap(0)).toBe(0)
    expect(selectionCap(1)).toBe(1)
    expect(selectionCap(20)).toBe(20)
    expect(selectionCap(35)).toBe(20)
    expect(selectionCap(-1)).toBe(0)
    expect(many.freeEntries(0)).toBe("אין לה כניסות פנויות")
    expect(many.freeEntries(1)).toBe("יש לה כניסה פנויה אחת")
    expect(many.freeEntries(4)).toBe("יש לה 4 כניסות פנויות")
    expect(many.selectedCount(1, 1)).toBe("נבחרו 1 מתוך 1")
  })

  it("a date in the sheet: what funds it, or the refusal worded for Tal", () => {
    expect(
      previewLine({
        ok: true,
        source: "entitlement",
        productName: "כרטיסייה",
        expiresOn: "2026-11-19",
        occupied: 3,
        capacity: 12,
      })
    ).toEqual({ ok: true, text: "ינוצל: כניסה מכרטיסייה, בתוקף עד 19.11" })
    expect(
      previewLine({
        ok: true,
        source: "credit",
        productName: "כניסה בודדת",
        expiresOn: null,
        occupied: 3,
        capacity: 12,
      })
    ).toEqual({ ok: true, text: "ינוצל: זיכוי מביטול של כניסה בודדת" })
    expect(
      previewLine({
        ok: false,
        code: "NO_MATCHING_ENTITLEMENT",
        occupied: null,
        capacity: null,
      })
    ).toEqual({ ok: false, text: "ללקוחה אין זכות שמתאימה למפגש הזה" })
  })

  it("the results: 'נרשמה ל-{k} מתוך {n}', each date saved or not with the reason", () => {
    const results = [
      { eventId: "e1", ok: true, code: null },
      { eventId: "e2", ok: false, code: "EVENT_FULL" as const },
      { eventId: "e3", ok: true, code: null },
    ]
    expect(resultsHeading(results)).toBe("נרשמה ל-2 מתוך 3")
    expect(resultItems(results)).toEqual([
      { eventId: "e1", ok: true, status: "נשמר", reason: null },
      {
        eventId: "e2",
        ok: false,
        status: "לא נשמר",
        reason: "המפגש מלא. כדי לרשום אותה צריך קודם להעלות את המכסה",
      },
      { eventId: "e3", ok: true, status: "נשמר", reason: null },
    ])
    expect(resultsHeading([{ ok: true }, { ok: true }, { ok: true }])).toBe(
      "נרשמה ל-3 מתוך 3"
    )
  })
})
