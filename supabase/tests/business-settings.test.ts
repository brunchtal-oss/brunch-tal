// Story 2.1: the business_settings row, its checks, and the product and
// payment method seed.

import { describe, expect, it } from "vitest"

import { inRollback, queryError, sql } from "./support/db"

describe("business_settings", () => {
  it("has exactly one row with the seeded defaults", async () => {
    const rows = await sql(`
      select version, default_validity_days, registration_close_days_before,
        registration_close_local_time::text as close_time,
        default_capacity_regular, default_capacity_couple, cancel_window_hours,
        credit_options_count, reminder_lead_hours, admin_expiring_days,
        customer_expiring_days, last_places_threshold, default_prep_days,
        marketing_reminder_schedule, inactivity_months,
        duplicate_payment_window_days
      from public.business_settings`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      default_validity_days: 49,
      registration_close_days_before: 1,
      close_time: "20:00:00",
      default_capacity_regular: 12,
      default_capacity_couple: 14,
      cancel_window_hours: 48,
      credit_options_count: 2,
      reminder_lead_hours: 24,
      admin_expiring_days: 21,
      customer_expiring_days: 10,
      last_places_threshold: 4,
      default_prep_days: [-1, 0],
      inactivity_months: 3,
      duplicate_payment_window_days: 7,
    })
    expect(rows[0].marketing_reminder_schedule).toEqual([
      { weekday: 0, time: "09:00" },
      { weekday: 1, time: "20:00" },
      { weekday: 2, time: "09:00" },
      { weekday: 3, time: "09:00" },
      { weekday: 4, time: "20:00" },
    ])
  })

  it.each([
    ["cancel_window_hours", "-1"],
    ["registration_close_days_before", "-1"],
    ["last_places_threshold", "-1"],
    ["credit_options_count", "-1"],
    ["reminder_lead_hours", "-1"],
    ["admin_expiring_days", "-1"],
    ["customer_expiring_days", "-1"],
    ["duplicate_payment_window_days", "-1"],
    ["default_capacity_regular", "0"],
    ["default_capacity_couple", "0"],
    ["default_validity_days", "0"],
    ["inactivity_months", "0"],
    ["registration_close_local_time", "'02:30'"],
    ["registration_close_local_time", "'00:00'"],
  ])("rejects %s = %s", async (column, value) => {
    await inRollback(async (db) => {
      const error = await queryError(
        db,
        `update public.business_settings set ${column} = ${value}`
      )
      expect(error?.code).toBe("23514")
    })
  })

  it("accepts a closing time of 03:00", async () => {
    await inRollback(async (db) => {
      expect(
        await queryError(
          db,
          "update public.business_settings set registration_close_local_time = '03:00'"
        )
      ).toBeNull()
    })
  })

  it("cannot have a second row", async () => {
    await inRollback(async (db) => {
      expect(
        (
          await queryError(
            db,
            "insert into public.business_settings default values"
          )
        )?.code
      ).toBe("23505")
      expect(
        (
          await queryError(
            db,
            "insert into public.business_settings (id) values (false)"
          )
        )?.code
      ).toBe("23514")
    })
  })
})

describe("seed", () => {
  it("has the four products of the catalog", async () => {
    const rows = await sql(`
      select type, price_agorot, units, validity_mode, validity_days,
        allowed_weekdays, eligible_event_kind, party_size, intro_only,
        post_join_message is not null and post_join_button_label is not null as has_copy
      from public.products
      where name not like 'test\\_%'
      order by price_agorot`)
    expect(rows).toEqual([
      {
        type: "intro",
        price_agorot: 11800,
        units: 1,
        validity_mode: "session",
        validity_days: null,
        allowed_weekdays: null,
        eligible_event_kind: "regular",
        party_size: 1,
        intro_only: true,
        has_copy: true,
      },
      {
        type: "single",
        price_agorot: 12800,
        units: 1,
        validity_mode: "session",
        validity_days: null,
        allowed_weekdays: null,
        eligible_event_kind: "regular",
        party_size: 1,
        intro_only: false,
        has_copy: true,
      },
      {
        type: "couple",
        price_agorot: 25000,
        units: 1,
        validity_mode: "session",
        validity_days: null,
        allowed_weekdays: null,
        eligible_event_kind: "couple",
        party_size: 2,
        intro_only: false,
        has_copy: true,
      },
      {
        type: "card",
        price_agorot: 47200,
        units: 4,
        validity_mode: "days",
        validity_days: 49,
        allowed_weekdays: [1, 4],
        eligible_event_kind: "regular",
        party_size: 1,
        intro_only: false,
        has_copy: true,
      },
    ])
  })

  it("has four visible payment methods in order", async () => {
    const rows = await sql(`
      select name from public.payment_methods
      where not hidden and name not like 'test\\_%'
      order by sort_order`)
    expect(rows.map((row) => row.name)).toEqual([
      "ביט",
      "פייבוקס",
      "העברה בנקאית",
      "מזומן",
    ])
  })
})
