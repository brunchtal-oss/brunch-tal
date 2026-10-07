import { describe, expect, it } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  linksHref,
  toAttentionItem,
  toAttentionItems,
  toExpiringCard,
  totalsView,
  upcomingRowText,
  type AttentionKind,
  type AttentionRow,
} from "./home-items"

const copy = adminCopy.home

// 12.10.2026 10:00 in Jerusalem.
const SINCE = "2026-10-12T07:00:00Z"
const EVENT = "11111111-1111-4111-8111-111111111111"
const PAY = "22222222-2222-4222-8222-222222222222"
const PAY_UNBOUND = "33333333-3333-4333-8333-333333333333"

const ROWS: Record<AttentionKind, AttentionRow> = {
  link_conflict: {
    kind: "link_conflict",
    id: "t1",
    customer_label: "Dana",
    since: SINCE,
    payment_id: PAY,
    conflict_reason: "two_accounts",
    product_name: "כרטיסייה",
    amount_agorot: 47200,
    paid_on: "2026-10-10",
  },
  link_stuck: {
    kind: "link_stuck",
    id: "t2",
    customer_label: null,
    since: SINCE,
    payment_id: PAY,
    product_name: "כרטיסייה",
    amount_agorot: 47200,
    paid_on: "2026-10-10",
  },
  purchase_without_link: {
    kind: "purchase_without_link",
    id: PAY_UNBOUND,
    customer_label: "  ",
    since: SINCE,
    product_name: "כרטיסייה",
    amount_agorot: 47200,
    paid_on: "2026-10-10",
  },
  paid_without_place: {
    kind: "paid_without_place",
    id: "e1",
    customer_label: "Noa",
    since: SINCE,
    product_name: "כניסה בודדת",
    amount_agorot: 12800,
    paid_on: "2026-10-10",
    event_id: EVENT,
    concept_name: "שישי מיוחד",
    starts_at: "2026-10-16T07:00:00Z",
  },
  pinned_seat_held: {
    kind: "pinned_seat_held",
    id: "b1",
    customer_label: "Noa",
    since: SINCE,
    event_id: EVENT,
    concept_name: "שישי מיוחד",
    starts_at: "2026-10-16T07:00:00Z",
  },
  media_stuck: {
    kind: "media_stuck",
    id: "m1",
    customer_label: null,
    since: SINCE,
  },
  accessibility_unpublished: {
    kind: "accessibility_unpublished",
    id: "accessibility",
    customer_label: null,
    since: SINCE,
  },
  push_failed: {
    kind: "push_failed",
    id: "push_failed",
    customer_label: null,
    since: SINCE,
    count: 3,
  },
}

describe("toAttentionItem", () => {
  it("maps every kind to a title, a detail, a chip and a destination", () => {
    const expected: Record<
      AttentionKind,
      {
        href: string
        title: string
        detail: string
        chip: string
        tone: string
      }
    > = {
      link_conflict: {
        href: `/admin/links?payment=${PAY}`,
        title: "ההצטרפות של Dana נעצרה",
        detail:
          "המייל והטלפון שייכים לשתי לקוחות שונות. צריך לברר איתה ולהפיק קישור חדש",
        chip: "התנגשות",
        tone: "error",
      },
      link_stuck: {
        href: `/admin/links?payment=${PAY}`,
        title: "לקוחה חדשה לא סיימה להצטרף",
        detail: "התחילה ולא סיימה. פתיחה חוזרת של אותו קישור תמשיך מאותה נקודה",
        chip: "תקוע",
        tone: "warning",
      },
      purchase_without_link: {
        href: `/admin/links?payment=${PAY_UNBOUND}`,
        title: "ללקוחה חדשה אין קישור הצטרפות בתוקף",
        detail:
          "הקישור פג או בוטל לפני שהצטרפה. אפשר להפיק קישור חדש בלי תשלום נוסף",
        chip: "פג תוקף",
        tone: "expired",
      },
      paid_without_place: {
        href: `/admin/sessions/${EVENT}`,
        title: "Noa שילמה ואין לה מקום",
        detail:
          "שילמה לבראנץ׳ שישי מיוחד 16.10 והמפגש היה מלא. צריך למצוא מקום או להחליט על החזר",
        chip: "צריך מקום",
        tone: "warning",
      },
      pinned_seat_held: {
        href: `/admin/sessions/${EVENT}`,
        title: "מקום שמור למי שלא הצטרפה (Noa)",
        detail:
          "הרכישה לא נוספה לחשבון, והמקום בבראנץ׳ שישי מיוחד 16.10 תפוס. אפשר לשחרר בעמוד המפגש",
        chip: "תופס מקום",
        tone: "warning",
      },
      media_stuck: {
        href: "/admin/content",
        title: "תמונה לא פורסמה עד הסוף",
        detail: "הפרסום נעצר באמצע. כדי לסיים, פרסמי שוב את העמוד בתוכן האתר",
        chip: "תקוע",
        tone: "warning",
      },
      accessibility_unpublished: {
        href: "/admin/content/accessibility",
        title: "הצהרת הנגישות עוד לא פורסמה",
        detail: "זה עמוד חובה באתר. צריך למלא את שדות החובה ולפרסם",
        chip: "לא פורסם",
        tone: "warning",
      },
      push_failed: {
        href: "/admin/notifications",
        title: "3 התראות פוש לא נשלחו השבוע",
        detail:
          "ההתראות עצמן נשמרו במרכז ההתראות. אם זה חוזר, צריך לבדוק את הגדרות הפוש של האתר",
        chip: "לא נשלח",
        tone: "warning",
      },
    }
    for (const kind of Object.keys(copy.items) as AttentionKind[]) {
      const item = toAttentionItem(ROWS[kind])
      const want = expected[kind]
      // formatAgorot may use a narrow no-break space; compare loosely.
      const norm = (s: string | null | undefined) =>
        (s ?? "").replace(/\s/g, " ")
      expect(item.href, kind).toBe(want.href)
      expect(item.title, kind).toBe(want.title)
      expect(norm(item.detail), kind).toBe(norm(want.detail))
      expect(item.chip, kind).toEqual({ tone: want.tone, label: want.chip })
      expect(item.meta, kind).toBe("מאז 12.10")
      expect(item.metaAt, kind).toBe("2026-10-12")
    }
  })

  it("a conflict's title and detail follow its reason; an unknown reason reads as bind_conflict", () => {
    const reasons = copy.items.link_conflict.reasons
    const cases: [string, keyof typeof reasons][] = [
      ["two_accounts", "two_accounts"],
      ["not_activated", "not_activated"],
      ["phone_taken", "phone_taken"],
      ["too_many_attempts", "too_many_attempts"],
      ["bind_conflict", "bind_conflict"],
      ["something_new", "bind_conflict"],
    ]
    for (const [reason, as] of cases) {
      const item = toAttentionItem({
        ...ROWS.link_conflict,
        conflict_reason: reason,
      })
      expect(item.title, reason).toBe(reasons[as].title("Dana"))
      expect(item.detail, reason).toBe(reasons[as].detail)
    }
    expect(reasons.too_many_attempts.title("Dana")).toBe(
      "ההצטרפות של Dana ננעלה"
    )
    expect(reasons.bind_conflict.title("Dana")).toBe(
      "הרכישה של Dana לא נוספה לחשבון שלה"
    )
  })

  it("a link item without a payment id goes to the full links screen", () => {
    expect(
      toAttentionItem({ ...ROWS.link_stuck, payment_id: undefined }).href
    ).toBe("/admin/links")
    expect(linksHref(PAY)).toBe(`/admin/links?payment=${PAY}`)
  })

  it("skips a kind this screen does not know", () => {
    const rows = [
      ROWS.media_stuck,
      { ...ROWS.media_stuck, kind: "choice_pending" as AttentionKind },
    ]
    expect(toAttentionItems(rows).map((i) => i.key)).toEqual(["media_stuck:m1"])
  })
})

describe("home rows", () => {
  it("an upcoming session: concept, day and places", () => {
    expect(
      upcomingRowText({
        event_id: EVENT,
        concept_name: "שישי מיוחד",
        kind: "regular",
        starts_at: "2026-10-16T07:00:00Z",
        ends_at: "2026-10-16T11:00:00Z",
        occupied: 10,
        capacity: 12,
      })
    ).toBe("בראנץ׳ שישי מיוחד · יום שישי 16.10 · 10/12")
  })

  it("an expiring card: the name (or a new customer), free entries and the date", () => {
    expect(
      toExpiringCard({
        entitlement_id: "c1",
        customer_id: "11111111-1111-4111-8111-111111111111",
        customer_label: "Orna",
        product_name: "כרטיסייה",
        available: 2,
        expires_on: "2026-10-30",
        days_left: 20,
      })
    ).toEqual({
      key: "c1",
      title: "Orna",
      href: "/admin/customers/11111111-1111-4111-8111-111111111111",
      entries: "2 כניסות שלא נרשמה אליהן",
      until: "בתוקף עד 30.10",
    })
    expect(
      toExpiringCard({
        entitlement_id: "c2",
        customer_id: null,
        customer_label: null,
        product_name: null,
        available: 1,
        expires_on: "2026-10-30",
        days_left: 20,
      })
    ).toMatchObject({ title: copy.newCustomer, href: null })
  })

  it("the totals: the month of the period and the amounts from the server", () => {
    const view = totalsView({
      period_start: "2026-10-01",
      period_end: "2026-10-06",
      approved_count: 14,
      approved_agorot: 342000,
      net_agorot: 342000,
    })
    expect(view.period).toBe("אוקטובר 2026 · עד היום")
    expect(view.approvedLabel).toBe("תשלומים שאושרו (14)")
    expect(view.net.replace(/\s/g, " ")).toBe("3,420 ₪")
  })
})

describe("adminCopy.home", () => {
  it("the counter line is singular for one item", () => {
    expect(copy.attentionCount(1)).toBe("דבר אחד מחכה לך")
    expect(copy.attentionCount(2)).toBe("2 דברים מחכים לך")
  })

  it('never says "רווח" or "הכנסה"', () => {
    const texts: string[] = []
    const walk = (value: unknown) => {
      if (typeof value === "string") texts.push(value)
      else if (typeof value === "function") texts.push(value.toString())
      else if (value && typeof value === "object")
        Object.values(value).forEach(walk)
    }
    walk(copy)
    expect(texts.length).toBeGreaterThan(20)
    for (const text of texts) {
      expect(text).not.toMatch(/רווח|הכנס/)
    }
  })
})

describe("push_failed", () => {
  it("one failure reads in the singular", () => {
    expect(toAttentionItem({ ...ROWS.push_failed, count: 1 }).title).toBe(
      "התראת פוש אחת לא נשלחה השבוע"
    )
  })
})
