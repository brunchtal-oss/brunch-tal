import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import type { Attendee } from "@/components/admin/attendee-row"
import { babyAge } from "@/components/admin/baby-age"

import type { WorkSheet } from "./work-sheet-data"

const callRpc = vi.fn()

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/rpc", () => ({
  callRpc: (...args: unknown[]) => callRpc(...args),
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ session: true }),
}))

const { WorkSheetView } = await import("./work-sheet")
const { WorkSheetHead } = await import("./work-head")
const { AddItemsForm } = await import("./shopping-list")
const { loadWorkSheet } = await import("./load-work-sheet")

const copy = adminCopy.work
const ID = "33333333-3333-4333-8333-333333333333"

const SHEET: WorkSheet = {
  event: {
    id: ID,
    conceptName: "יווני",
    status: "published",
    startsAt: "2026-10-22T07:00:00+00:00",
    endsAt: "2026-10-22T09:00:00+00:00",
  },
  prepDays: [
    { offset: -1, date: "2026-10-21", added: false },
    { offset: 0, date: "2026-10-22", added: false },
  ],
  addableDays: [{ offset: -2, date: "2026-10-20", added: false }],
  dishes: [],
  shopping: [],
}

beforeEach(() => {
  callRpc.mockReset()
})

describe("the work sheet's screens (story 4.9)", () => {
  it("a session without dishes shows the empty-state and its one action", () => {
    const html = renderToStaticMarkup(
      <WorkSheetView sheet={SHEET} attendees={[]} />
    )
    expect(html).toContain(copy.empty)
    // "+ מנה" only inside the empty-state, not also above it.
    expect(html.split(copy.addDish)).toHaveLength(2)
    expect(html).toContain(copy.addDay)
  })

  it("an unknown session loads as null (the page's notFound)", async () => {
    callRpc.mockResolvedValue({ ok: false, code: "NOT_FOUND" })
    await expect(loadWorkSheet(ID)).resolves.toBeNull()
    expect(callRpc).toHaveBeenCalledWith(
      { session: true },
      "admin_get_work_sheet",
      { p_event_id: ID }
    )
    callRpc.mockResolvedValue({ ok: false, code: "SERVER_ERROR" })
    await expect(loadWorkSheet(ID)).rejects.toThrow()
  })
})

const PERSON: Attendee = {
  bookingId: "b",
  partySize: 1,
  pendingJoin: false,
  payerLabel: null,
  name: null,
  phone: null,
  dietaryNotes: null,
  guestDetails: null,
  photoConsent: null,
  personalPhotoConsent: null,
  babies: [],
}

const ATTENDEES: Attendee[] = [
  {
    ...PERSON,
    bookingId: "dana",
    name: "דנה כהן",
    phone: "050-123-4567",
    dietaryNotes: "ללא גלוטן",
    photoConsent: true,
    personalPhotoConsent: false,
    babies: [{ name: "עומר", birthDate: "2026-06-15" }],
  },
  {
    ...PERSON,
    bookingId: "michal",
    name: "מיכל לוי",
    partySize: 2,
    guestDetails: "צמחונית",
    photoConsent: false,
    personalPhotoConsent: true,
  },
  {
    ...PERSON,
    bookingId: "ruth",
    name: "רות",
    photoConsent: false,
    personalPhotoConsent: false,
  },
  { ...PERSON, bookingId: "pending", pendingJoin: true, payerLabel: "Noa" },
]

const count = (html: string, text: string) => html.split(text).length - 1

// The part of the markup from one text to the next.
const between = (html: string, from: string, to?: string) =>
  html.slice(html.indexOf(from), to ? html.indexOf(to) : undefined)

describe("the work sheet's sections (story 4.10, round 2)", () => {
  it("in order: dishes with print and + יום הכנה, the registrants table, shopping", () => {
    const html = renderToStaticMarkup(
      <WorkSheetView
        sheet={{
          ...SHEET,
          shopping: [
            { id: "s1", body: "פטה כבשים", quantity: "1 ק״ג", bought: true },
            { id: "s2", body: "לימונים", quantity: null, bought: false },
          ],
        }}
        attendees={ATTENDEES}
      />
    )
    // "מנות" with the phone's "הדפסה", then "+ יום הכנה".
    const order = [
      copy.dishes,
      copy.print,
      copy.addDay,
      copy.attendees(4),
      `>${copy.shopping}<`,
    ].map((text) => html.indexOf(text))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // No separate diet section: diet is a column of the one table.
    expect(count(html, "<table")).toBe(1)
    expect(count(html, `>${copy.diet}<`)).toBe(1)
  })

  it("the registrants table: name with the babies under it, consent, diet; no phone and no ×2", () => {
    const html = renderToStaticMarkup(
      <WorkSheetView sheet={SHEET} attendees={ATTENDEES} />
    )
    const table = between(html, copy.attendees(4), `>${copy.shopping}<`)
    // Three columns: no babies column.
    expect(count(table, '<th scope="col"')).toBe(3)
    for (const head of [copy.colName, copy.colConsent, copy.diet]) {
      expect(table).toContain(`>${head}<`)
    }
    expect(table).not.toContain(">תינוקות<")
    // The baby, small, inside the mother's row head.
    const from = table.indexOf(">דנה כהן<")
    const dana = table.slice(from, table.indexOf("</th>", from))
    expect(dana).toContain(
      adminCopy.sessions.babyLine("עומר", babyAge("2026-06-15", "2026-10-22"))
    )
    expect(dana).toContain("text-[13px]")
    // Story 2.13: short marks, the declined ones in the warning style, each
    // named in full words.
    const photo = adminCopy.photoConsents
    expect(count(table, ">אווירה ✓<")).toBe(1)
    expect(count(table, ">אווירה ✗<")).toBe(2)
    expect(count(table, ">אישיות ✓<")).toBe(1)
    expect(count(table, ">אישיות ✗<")).toBe(2)
    expect(
      count(table, `<span class="sr-only">${photo.personal.no}</span>`)
    ).toBe(2)
    expect(
      count(table, `<span class="sr-only">${photo.atmosphere.yes}</span>`)
    ).toBe(1)
    // The visible mark is hidden from a screen reader (not an image).
    expect(table).toContain('aria-hidden="true" class="whitespace-nowrap')
    expect(table).not.toContain('role="img"')
    expect(table).toMatch(
      /class="[^"]*font-semibold text-warning[^"]*">אווירה ✗</
    )
    expect(table).not.toMatch(/class="[^"]*text-warning[^"]*">אווירה ✓</)
    expect(table).not.toContain("status-chip")
    expect(table).toContain("ללא גלוטן")
    expect(table).toContain(adminCopy.sessions.companion("צמחונית"))
    expect(table).toContain(adminCopy.sessions.pendingJoin)
    expect(table).not.toContain("050-123-4567")
    expect(table).not.toContain(adminCopy.sessions.couple)
    // Ruth's row: a consent cell and an empty diet cell.
    const ruth = between(table, ">רות<", adminCopy.sessions.pendingJoin)
    expect(ruth).toMatch(/<td class="[^"]*"><\/td><\/tr>/)
  })

  it("an empty list blocks WhatsApp with the reason", () => {
    const html = renderToStaticMarkup(
      <WorkSheetView sheet={SHEET} attendees={[{ ...PERSON, name: "רות" }]} />
    )
    expect(html).toContain(copy.attendees(1))
    expect(html).toContain(copy.noShopping)
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain(copy.whatsappEmpty)
    expect(html).not.toContain("wa.me")
    expect(html).toContain(`>${copy.addItem}<`)
  })

  it("+ פריט's window: one text box with its hint, no quantity field", () => {
    const html = renderToStaticMarkup(
      <AddItemsForm
        eventId={ID}
        pending={false}
        run={vi.fn()}
        onAdded={vi.fn()}
      />
    )
    expect(count(html, "<textarea")).toBe(1)
    expect(count(html, "<input")).toBe(0)
    expect(html).toContain(copy.itemLines)
    expect(html).toContain(copy.itemLinesHint)
    expect(html).not.toContain("כמות")
    // No problem yet: the alert is there, empty.
    expect(html).toMatch(/role="alert"[^>]*><\/p>/)
  })

  it("+ פריט's window: a problem is an alert in the error tone", () => {
    const tooMany = renderToStaticMarkup(
      <AddItemsForm
        eventId={ID}
        pending={false}
        run={vi.fn()}
        onAdded={vi.fn()}
        initialText={Array.from({ length: 101 }, (_, i) => `x${i}`).join("\n")}
      />
    )
    expect(tooMany).toMatch(
      new RegExp(
        `role="alert" class="[^"]*text-error[^"]*">${copy.itemsTooMany(100)}<`
      )
    )
    expect(tooMany).toContain('aria-invalid="true"')
    expect(tooMany).toMatch(/aria-disabled="true"[^>]*>הוספה</)
    // "הוספה" pressed with nothing written.
    const empty = renderToStaticMarkup(
      <AddItemsForm
        eventId={ID}
        pending={false}
        run={vi.fn()}
        onAdded={vi.fn()}
        initialTried
      />
    )
    expect(empty).toContain(`>${copy.itemsProblemEmpty}<`)
  })

  it("a bought item stays in its place struck through; WhatsApp carries the rest", () => {
    const html = renderToStaticMarkup(
      <WorkSheetView
        sheet={{
          ...SHEET,
          shopping: [
            { id: "s1", body: "פטה כבשים", quantity: "1 ק״ג", bought: true },
            { id: "s2", body: "לימונים", quantity: null, bought: false },
          ],
        }}
        attendees={[]}
      />
    )
    expect(html).toMatch(/line-through[^>]*><bdi>פטה כבשים · 1 ק״ג/)
    expect(html.indexOf("פטה כבשים")).toBeLessThan(html.indexOf("לימונים"))
    expect(html).toContain('href="https://wa.me/?text=')
  })
})

describe("the prep days of round 2 (story 4.10)", () => {
  const withAdded: WorkSheet = {
    ...SHEET,
    prepDays: [
      { offset: -2, date: "2026-10-20", added: true },
      ...SHEET.prepDays,
    ],
    addableDays: [
      { offset: -4, date: "2026-10-18", added: false },
      { offset: -3, date: "2026-10-19", added: false },
    ],
    dishes: [
      {
        id: "d1",
        name: "שקשוקה",
        tasks: [{ id: "t1", dayOffset: -2, body: "להזמין פטה", done: false }],
      },
    ],
  }

  it("only an added day has an X and a move button; its heading is the date only", () => {
    const html = renderToStaticMarkup(
      <WorkSheetView sheet={withAdded} attendees={[]} />
    )
    // Twice: next to the day's heading in the dish card (phone) and in the
    // table's column head (desktop). No days row.
    expect(count(html, `aria-label="${copy.removeDayNamed("ג׳ 20.10")}"`)).toBe(
      2
    )
    expect(count(html, `aria-label="${copy.moveDayNamed("ג׳ 20.10")}"`)).toBe(2)
    expect(html).not.toContain(`>${copy.days}<`)
    const card = between(html, "<article", "</article>")
    expect(card).toContain(copy.removeDayNamed("ג׳ 20.10"))
    expect(html).not.toContain(copy.removeDayNamed("ד׳ 21.10"))
    expect(html).not.toContain(copy.removeDayNamed("ה׳ 22.10"))
    expect(html).not.toContain(copy.moveDayNamed("ד׳ 21.10"))
    // A base day keeps its label; the added one has none.
    expect(html).toContain(copy.dayLabel(-1))
    expect(html).not.toContain(copy.dayLabel(-2))
    // No chips.
    expect(html).not.toContain("rounded-full border border-border bg-card")
  })

  it("+ יום הכנה is disabled with the reason only when no day is free; -6 taken with a gap still adds", () => {
    const open = renderToStaticMarkup(
      <WorkSheetView sheet={withAdded} attendees={[]} />
    )
    expect(open).not.toContain(copy.addDayLimit)
    const gap = renderToStaticMarkup(
      <WorkSheetView
        sheet={{
          ...withAdded,
          prepDays: [
            { offset: -6, date: "2026-10-16", added: true },
            ...SHEET.prepDays,
          ],
        }}
        attendees={[]}
      />
    )
    expect(gap).not.toContain(copy.addDayLimit)
    expect(gap).not.toMatch(/aria-disabled="true"[^>]*>\+ יום הכנה</)
    const full = renderToStaticMarkup(
      <WorkSheetView sheet={{ ...withAdded, addableDays: [] }} attendees={[]} />
    )
    expect(full).toContain(copy.addDayLimit)
    expect(full).toMatch(/aria-disabled="true"[^>]*>\+ יום הכנה</)
    expect(open).not.toMatch(/aria-disabled="true"[^>]*>\+ יום הכנה</)
  })

  it("with no free day an added day's date is plain text, not a move button", () => {
    const html = renderToStaticMarkup(
      <WorkSheetView sheet={{ ...withAdded, addableDays: [] }} attendees={[]} />
    )
    expect(html).not.toContain(copy.moveDayNamed("ג׳ 20.10"))
    // The X stays.
    expect(html).toContain(copy.removeDayNamed("ג׳ 20.10"))
  })

  it("in a card the added day's heading is its text only; the controls are outside it", () => {
    const html = renderToStaticMarkup(
      <WorkSheetView sheet={withAdded} attendees={[]} />
    )
    const card = between(html, "<article", "</article>")
    const headings = [...card.matchAll(/<h4[^>]*>(.*?)<\/h4>/g)].map(
      (m) => m[1]
    )
    expect(headings.length).toBeGreaterThan(0)
    for (const heading of headings) {
      expect(heading).not.toContain("<button")
      expect(heading).not.toContain("role=")
    }
    expect(headings[0]).toContain("ג׳ 20.10")
  })

  it("an added day without tasks still shows in every card, with its X", () => {
    const html = renderToStaticMarkup(
      <WorkSheetView
        sheet={{
          ...withAdded,
          dishes: [
            { id: "d1", name: "א", tasks: [] },
            { id: "d2", name: "ב", tasks: [] },
          ],
        }}
        attendees={[]}
      />
    )
    // Two cards and the column head.
    expect(count(html, `aria-label="${copy.removeDayNamed("ג׳ 20.10")}"`)).toBe(
      3
    )
  })

  it("without dishes an added day's X is in a plain days row", () => {
    const html = renderToStaticMarkup(
      <WorkSheetView sheet={{ ...withAdded, dishes: [] }} attendees={[]} />
    )
    expect(html).toContain(`>${copy.days}<`)
    expect(count(html, `aria-label="${copy.removeDayNamed("ג׳ 20.10")}"`)).toBe(
      1
    )
    // No added day, no row.
    const plain = renderToStaticMarkup(
      <WorkSheetView sheet={SHEET} attendees={[]} />
    )
    expect(plain).not.toContain(`>${copy.days}<`)
  })

  it("phone: הדפסה on the line of מנות; + מנה and + יום הכנה the same size just above the first dish; desktop: הדפסה at the end of the tools row", () => {
    const html = renderToStaticMarkup(
      <WorkSheetView sheet={withAdded} attendees={[]} />
    )
    // The heading line: "מנות", then the phone's "הדפסה" (hidden from lg).
    const head = html.slice(
      html.indexOf('id="work-dishes"'),
      html.indexOf("data-work-tools")
    )
    expect(head).toContain(copy.dishes)
    expect(head).toMatch(/data-print-phone="" class="lg:hidden"/)
    expect(head.indexOf(copy.dishes)).toBeLessThan(head.indexOf(copy.print))
    // The tools row ends right before the first dish card.
    const start = html.indexOf("data-work-tools")
    const row = html.slice(start, html.indexOf("<article"))
    expect(row).not.toContain("<h2")
    const dish = row.indexOf(copy.addDish)
    const day = row.indexOf(copy.addDay)
    const print = row.indexOf(copy.print)
    expect(dish).toBeGreaterThan(-1)
    expect(dish).toBeLessThan(day)
    expect(day).toBeLessThan(print)
    // The row's "הדפסה" is the desktop's only, at the inline end.
    expect(row.slice(day, print)).toMatch(
      /data-print-desktop="" class="ms-auto hidden lg:inline"/
    )
    expect(count(html, `${copy.print}</button>`)).toBe(2)
    // "+ מנה" in the row is the phone's only (hidden from lg).
    expect(row.slice(0, dish)).toMatch(/<span class="contents lg:hidden">/)
    // The same size: both carry the shared width and height.
    const button = (at: number) => row.slice(row.lastIndexOf("<button", at), at)
    for (const at of [dish, day]) {
      expect(button(at)).toContain("h-11")
      expect(button(at)).toContain("w-28")
    }
    // No other "+ מנה" above the dishes; the desktop one is after the table.
    expect(count(html, copy.addDish)).toBe(2)
    expect(html.lastIndexOf(copy.addDish)).toBeGreaterThan(
      html.indexOf("<table")
    )
  })

  it("the dishes table is fixed: the dish column has its width, every day column the same (none set)", () => {
    const html = renderToStaticMarkup(
      <WorkSheetView sheet={withAdded} attendees={[]} />
    )
    const table = html.slice(html.indexOf("<table"))
    expect(table).toMatch(/^<table class="[^"]*\btable-fixed\b/)
    const heads = [...table.matchAll(/<th scope="col" class="([^"]*)"/g)].map(
      (m) => m[1]
    )
    expect(heads).toHaveLength(4)
    expect(heads[0]).toContain("w-[28%]")
    // The added day (-2) and the base days: the same classes, no width.
    for (const head of heads.slice(1)) {
      expect(head).not.toMatch(/\bw-/)
    }
    expect(heads[1].replace(" print:hidden", "")).toBe(
      heads[3].replace(" print:hidden", "")
    )
  })

  it("the no-free-day reason is under the buttons row", () => {
    const html = renderToStaticMarkup(
      <WorkSheetView sheet={{ ...withAdded, addableDays: [] }} attendees={[]} />
    )
    expect(html).toContain(
      `order-last basis-full text-[15px] text-muted-foreground">${copy.addDayLimit}<`
    )
  })

  it("an empty sheet keeps its empty-state + מנה and no + מנה in the row", () => {
    const html = renderToStaticMarkup(
      <WorkSheetView sheet={SHEET} attendees={[]} />
    )
    expect(count(html, copy.addDish)).toBe(1)
    expect(html.indexOf(copy.addDish)).toBeGreaterThan(html.indexOf(copy.empty))
  })
})

describe("the work sheet's head (story 4.10, second phone check)", () => {
  it("the link without an underline, בראנץ׳ {קונספט}, then the date and time", () => {
    const html = renderToStaticMarkup(
      <WorkSheetHead
        eventId={ID}
        conceptName="יווני"
        startsAt={SHEET.event.startsAt}
        endsAt={SHEET.event.endsAt}
      />
    )
    const link = html.indexOf(adminCopy.sessions.toDetails)
    const title = html.indexOf(adminCopy.sessions.sessionTitle("יווני"))
    const when = html.indexOf("10:00")
    expect(link).toBeGreaterThan(-1)
    expect(link).toBeLessThan(title)
    expect(title).toBeLessThan(when)
    expect(html).toContain(`href="/admin/sessions/${ID}"`)
    expect(html).toContain("no-underline")
    expect(html).not.toMatch(/class="([^"]* )?underline[ "]/)
    expect(html).toContain("<h1")
  })
})

describe("the work sheet's print markup (story 4.10)", () => {
  it("a day without tasks is not printed; the head carries the title and the count", () => {
    const html = renderToStaticMarkup(
      <WorkSheetView
        sheet={{
          ...SHEET,
          dishes: [
            {
              id: "d1",
              name: "שקשוקה",
              tasks: [{ id: "t1", dayOffset: 0, body: "לבשל", done: false }],
            },
          ],
        }}
        attendees={ATTENDEES}
      />
    )
    expect(html).toMatch(
      /<th[^>]*class="[^"]*print:hidden[^"]*"[^>]*><time dateTime="2026-10-21"/
    )
    expect(html).not.toMatch(
      /<th[^>]*class="[^"]*print:hidden[^"]*"[^>]*><time dateTime="2026-10-22"/
    )
    expect(html).toContain(copy.printTitle("יווני"))
    expect(html).toMatch(/· 4 הרשמות/)
  })

  it("an empty part is not printed; the printed list strikes a bought item", () => {
    const none = renderToStaticMarkup(
      <WorkSheetView sheet={SHEET} attendees={[]} />
    )
    expect(none).not.toContain("data-work-sheet-print")
    expect(none).toMatch(
      /<section aria-labelledby="work-attendees"[^>]*print:hidden/
    )

    const full = renderToStaticMarkup(
      <WorkSheetView
        sheet={{
          ...SHEET,
          shopping: [
            { id: "s1", body: "פטה כבשים", quantity: null, bought: true },
          ],
        }}
        attendees={ATTENDEES}
      />
    )
    expect(full).not.toMatch(
      /<section aria-labelledby="work-attendees"[^>]*print:hidden/
    )
    const printed = between(full, "data-work-sheet-print")
    expect(printed).toMatch(/class="line-through"><span aria-hidden="true">☑ /)
  })
})
