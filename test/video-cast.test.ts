import { describe, expect, it } from "vitest"

import { CAST } from "../scripts/video-cast.mjs"
import { checkCast, deriveWorld } from "../scripts/video-cast-rules.mjs"
import { addDays, planVideoDates } from "../scripts/video-plan.mjs"

// Today's dev products (found by type) and settings.
const PRODUCTS = [
  {
    type: "single",
    units: 1,
    validity_days: null,
    validity_mode: "session",
    party_size: 1,
    eligible_event_kind: "regular",
    active: true,
  },
  {
    type: "couple",
    units: 1,
    validity_days: null,
    validity_mode: "session",
    party_size: 2,
    eligible_event_kind: "couple",
    active: true,
  },
  {
    type: "card",
    units: 4,
    validity_days: 49,
    validity_mode: "days",
    party_size: 1,
    eligible_event_kind: "regular",
    active: true,
  },
  {
    type: "intro",
    units: 1,
    validity_days: null,
    validity_mode: "session",
    party_size: 1,
    eligible_event_kind: "regular",
    active: true,
  },
]
const SETTINGS = {
  last_places_threshold: 4,
  credit_options_count: 2,
  cancel_window_hours: 48,
}

const DAY = "2026-10-22"
const planOf = (day: string) =>
  planVideoDates(new Date(`${day}T12:00:00+02:00`))
// A deep copy of the cast with its plan, to break one rule at a time.
const castOn = (day = DAY) => ({
  ...structuredClone(CAST),
  plan: structuredClone(planOf(day)),
})
const rules = (cast: ReturnType<typeof castOn>, settings = SETTINGS) =>
  checkCast(cast, PRODUCTS, settings).map((e) => e.rule)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const personaOf = (cast: any, key: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cast.personas.find((p: any) => p.key === key)

describe("the video cast", () => {
  // Every weekday, Saturday included, across the end of summer time
  // (2026-10-25) and its start (2027-03-26), and around the year's end.
  const days = [
    ...Array.from({ length: 35 }, (_, i) => addDays("2026-10-10", i)),
    ...Array.from({ length: 14 }, (_, i) => addDays("2026-12-25", i)),
    ...Array.from({ length: 14 }, (_, i) => addDays("2027-03-20", i)),
  ]

  it.each(days)("passes every rule when run on %s", (day) => {
    expect(checkCast(castOn(day), PRODUCTS, SETTINGS)).toEqual([])
  })

  it("reaches the occupancy of the spec", () => {
    const { occupancy } = deriveWorld(castOn(), PRODUCTS)
    expect(occupancy).toMatchObject({
      U1: 8,
      U2: 12,
      U3: 0,
      U4: 9,
      U5: 2,
      U6: 4,
      U7: 1,
      U8: 0,
      F1: 4,
      F2: 2,
      H1: 6,
      H2: 6,
      H3: 6,
      H4: 6,
      HF: 4,
      H0: 1,
    })
  })

  it("leaves Michal one free entry and Orit two", () => {
    const { entitlements } = deriveWorld(castOn(), PRODUCTS)
    const card = (who: string) =>
      entitlements.find((e) => e.owner === who && e.type === "card")!
    expect(card("michal").units - card("michal").entries.length).toBe(1)
    expect(card("orit").units - card("orit").entries.length).toBe(2)
    expect(card("stav").entries.length).toBe(4)
  })
})

describe("a broken cast fails its rule", () => {
  it("guideline 1: a regular session on another weekday", () => {
    const cast = castOn()
    cast.plan.sessions.U3 = "2026-11-03" // a Tuesday
    expect(rules(cast)).toContain("guideline-1")
  })

  it("guideline 1: a couple session not on Friday", () => {
    const cast = castOn()
    cast.plan.sessions.F2 = "2026-10-29" // a Thursday
    expect(rules(cast)).toContain("guideline-1")
  })

  it("guideline 2: two active cards", () => {
    const cast = castOn()
    personaOf(cast, "michal").purchases.push({
      product: "card",
      paid: { daysAgo: 1 },
    })
    expect(rules(cast)).toContain("guideline-2")
  })

  it("guideline 3: a card and a future single entry", () => {
    const cast = castOn()
    personaOf(cast, "efrat").purchases.push({
      product: "single",
      event: "U7",
      paid: { daysAgo: 1 },
    })
    expect(rules(cast)).toContain("guideline-3")
  })

  it("guideline 4: a couple session on top of a card is allowed", () => {
    const cast = castOn()
    expect(
      personaOf(cast, "michal").purchases.map(
        (p: { product: string }) => p.product
      )
    ).toEqual(["card", "couple"])
    expect(rules(cast)).toEqual([])
  })

  it("units: more entries than the card holds", () => {
    const cast = castOn()
    cast.adminBookings.push(["efrat", "U6"])
    expect(rules(cast)).toContain("units")
  })

  it("units: an entry after the card expires has no card", () => {
    const cast = castOn()
    cast.adminBookings.push(["orit", "U7"])
    expect(rules(cast)).toContain("units")
  })

  it("validity: a history entry valid on its real date but not on the temporary one", () => {
    const cast = castOn()
    // Orit's card ends 7 days after today; H1's temporary date is then
    // within it, so push the card's end to the day before.
    personaOf(cast, "orit").purchases[0].paid = { expiresIn: 0 }
    expect(rules(cast)).toContain("validity")
  })

  it("occupancy: U2 not full", () => {
    const cast = castOn()
    cast.adminBookings = cast.adminBookings.filter(
      ([who, event]: string[]) => !(who === "shaked" && event === "U2")
    )
    expect(rules(cast)).toContain("occupancy")
  })

  it("occupancy: U4 outside the last-places threshold", () => {
    const cast = castOn()
    expect(rules(cast, { ...SETTINGS, last_places_threshold: 2 })).toContain(
      "occupancy"
    )
  })

  it("capacity: a session over its capacity", () => {
    const cast = castOn()
    cast.capacity.regular = 10
    expect(rules(cast)).toContain("capacity")
  })

  it("babies: a birth date more than two years back", () => {
    const cast = castOn()
    personaOf(cast, "hila").babies[0].ageDays = 800
    expect(rules(cast)).toContain("babies")
  })

  it("babies: a birth date more than nine months ahead", () => {
    const cast = castOn()
    personaOf(cast, "hila").babies[0].ageDays = -300
    expect(rules(cast)).toContain("babies")
  })

  it("credits: not enough alternatives", () => {
    expect(rules(castOn(), { ...SETTINGS, credit_options_count: 4 })).toContain(
      "credits"
    )
  })

  it("credits: an alternative that does not accept the product", () => {
    const cast = castOn()
    // A session that accepts only the card (event_products).
    Object.assign(cast.sessions.U5, { products: ["card"] })
    expect(rules(cast)).toContain("credits")
  })

  it("contacts: a duplicate phone, or one outside the range", () => {
    const cast = castOn()
    personaOf(cast, "neta").phone = personaOf(cast, "michal").phone
    expect(rules(cast)).toContain("contacts")
    const other = castOn()
    personaOf(other, "neta").phone = "050-1234567"
    expect(rules(other)).toContain("contacts")
  })

  it("contacts: an invalid email", () => {
    const cast = castOn()
    personaOf(cast, "neta").email = "Neta Berger"
    expect(rules(cast)).toContain("contacts")
  })

  it('copy: "טל" in the fictional copy', () => {
    const cast = castOn()
    cast.boardNotes.push({ body: "לשאול את טל על המגשים" })
    expect(rules(cast)).toContain("copy")
  })

  it("waitlist: waiting for a session that is not full", () => {
    const cast = castOn()
    cast.waitlist.push({ who: "neta", event: "U6" })
    expect(rules(cast)).toContain("waitlist")
  })

  it("references: an unknown session", () => {
    const cast = castOn()
    cast.adminBookings.push(["efrat", "U9"])
    expect(rules(cast)).toEqual(["references"])
  })
})
