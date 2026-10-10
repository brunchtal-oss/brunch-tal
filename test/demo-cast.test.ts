import { describe, expect, it } from "vitest"

import {
  ADMIN_BOOKINGS,
  CONFLICT,
  CUSTOMERS,
  LOGIN_CUSTOMER,
  NOTES,
  SELF_BOOKINGS,
  SELF_CANCEL,
  SESSIONS,
  WORK_SHEET,
} from "../scripts/demo-cast.mjs"

// The script of the demo (spec 5.18): E5 is almost full, 10 of 12, and the
// login customer (Maya) keeps one free entry on her card.

type Purchase = { product: string; event?: string }
type Customer = { key: string; purchases: Purchase[] }

const customers = CUSTOMERS as Customer[]
const customerKeys = new Set(customers.map((c) => c.key))
const sessionKeys = new Set(Object.keys(SESSIONS))
const castOf = (key: string) => customers.find((c) => c.key === key)!

// A card has 4 entries (the product in the dev project, spec 5.18; the
// cast does not hold it). A couple's purchase seats two adults.
const CARD_ENTRIES = 4
const seatsOf = (product: string) => (product === "couple" ? 2 : 1)

// The adults booked on a session by the cast: the purchases pinned to it,
// Tal's card bookings and the self bookings, less the self cancel.
function occupancy(event: string) {
  let seats = 0
  for (const customer of customers) {
    for (const purchase of customer.purchases) {
      if (purchase.event === event) seats += seatsOf(purchase.product)
    }
  }
  seats += ADMIN_BOOKINGS.filter(([, e]) => e === event).length
  if (SELF_BOOKINGS.events.includes(event)) seats += 1
  if (SELF_CANCEL.event === event) seats -= 1
  return seats
}

describe("demo cast", () => {
  it("has unique customer keys", () => {
    expect(customerKeys.size).toBe(customers.length)
  })

  it("names only customers and sessions of the cast", () => {
    for (const [who, event] of ADMIN_BOOKINGS) {
      expect(customerKeys).toContain(who)
      expect(sessionKeys).toContain(event)
    }
    for (const note of NOTES) expect(customerKeys).toContain(note.customer)
    expect(customerKeys).toContain(CONFLICT.customer)
    expect(customerKeys).toContain(CONFLICT.phoneOf)
    expect(customerKeys).toContain(SELF_BOOKINGS.customer)
    for (const event of SELF_BOOKINGS.events)
      expect(sessionKeys).toContain(event)
    expect(customerKeys).toContain(SELF_CANCEL.customer)
    expect(sessionKeys).toContain(SELF_CANCEL.event)
    expect(customerKeys).toContain(LOGIN_CUSTOMER)
    expect(sessionKeys).toContain(WORK_SHEET.event)
    for (const customer of customers) {
      for (const purchase of customer.purchases) {
        if (purchase.event) expect(sessionKeys).toContain(purchase.event)
      }
    }
  })

  it("cancels a purchase the customer has for that session", () => {
    const purchases = castOf(SELF_CANCEL.customer).purchases
    expect(purchases.some((p) => p.event === SELF_CANCEL.event)).toBe(true)
  })

  it("fills E5 to 10 of 12", () => {
    // 5 pinned purchases (keren, hadar, avigail, inbal, dana) and 5 card
    // bookings by Tal (noa, yael, roni, tamar, or).
    expect(SESSIONS.E5.capacity).toBe(12)
    expect(occupancy("E5")).toBe(10)
  })

  it("leaves Maya one free entry on her card", () => {
    // Her card pays E0 (Tal) and E2 and E6 (her own booking): 3 of 4. Her
    // E4 entry is a separate single purchase.
    const maya = castOf(LOGIN_CUSTOMER)
    expect(maya.key).toBe(SELF_BOOKINGS.customer)
    expect(maya.purchases.filter((p) => p.product === "card")).toHaveLength(1)
    const cardUses =
      ADMIN_BOOKINGS.filter(([who]) => who === maya.key).length +
      SELF_BOOKINGS.events.length
    expect(cardUses).toBe(3)
    expect(CARD_ENTRIES - cardUses).toBe(1)
  })
})
