// Story 1.3: the pure SQL helpers of AD-8 (time) and AD-9 (phone).
// Timestamps are compared as UTC text, so no JS time zone is involved.

import { describe, expect, it } from "vitest"

import { inRollback, sql } from "./support/db"

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS"Z"'`

// A local wall-clock time in Jerusalem as timestamptz.
const LOCAL = (wall: string) =>
  `'${wall}'::timestamp at time zone 'Asia/Jerusalem'`

async function one<T>(query: string, params: unknown[] = []): Promise<T> {
  const rows = await sql<{ v: T }>(query, params)
  return rows[0].v
}

describe("private.cancel_deadline", () => {
  const deadline = `private.cancel_deadline(48, ${LOCAL("2026-10-26 10:00")})`

  it("is exactly 48 real hours before the start, across the DST change", async () => {
    expect(
      await one(`select to_char(${deadline} at time zone 'UTC', ${UTC}) as v`)
    ).toBe("2026-10-24T08:00:00Z")
  })

  it("allows now() <= deadline and refuses one microsecond later", async () => {
    const rows = await sql<{ at: boolean; after: boolean }>(
      `select ${deadline} <= ${deadline} as at,
              (${deadline} + interval '1 microsecond') <= ${deadline} as after`
    )
    expect(rows[0]).toEqual({ at: true, after: false })
  })

  it("returns null for a null input", async () => {
    expect(
      await one(`select private.cancel_deadline(null, now()) as v`)
    ).toBeNull()
  })
})

describe("private.registration_closes_at", () => {
  it("uses summer time on the day before the DST end", async () => {
    expect(
      await one(
        `select to_char(private.registration_closes_at(${LOCAL("2026-10-25 10:00")}, 1, '20:00') at time zone 'UTC', ${UTC}) as v`
      )
    ).toBe("2026-10-24T17:00:00Z")
  })

  it("uses winter time on the day before the DST start", async () => {
    expect(
      await one(
        `select to_char(private.registration_closes_at(${LOCAL("2026-03-27 10:00")}, 1, '20:00') at time zone 'UTC', ${UTC}) as v`
      )
    ).toBe("2026-03-26T18:00:00Z")
  })
})

describe("private.local_day_end", () => {
  it("is the start of the next local day (49-day validity)", async () => {
    expect(
      await one(
        `select to_char(private.local_day_end('2026-10-01'::date + 49) at time zone 'UTC', ${UTC}) as v`
      )
    ).toBe("2026-11-19T22:00:00Z")
  })

  it("is valid up to, but not at, the end of the day", async () => {
    const rows = await sql<{ before: boolean; at: boolean }>(
      `select '2026-11-19 21:59:59.999999Z'::timestamptz < private.local_day_end('2026-11-19') as before,
              '2026-11-19 22:00:00Z'::timestamptz < private.local_day_end('2026-11-19') as at`
    )
    expect(rows[0]).toEqual({ before: true, at: false })
  })
})

describe("private.local_week_start", () => {
  it.each(["2026-09-30", "2026-09-27", "2026-10-03"])(
    "the week of %s starts on Sunday 2026-09-27",
    async (day) => {
      expect(
        await one(`select private.local_week_start($1::date)::text as v`, [day])
      ).toBe("2026-09-27")
    }
  )
})

describe("private.prep_day", () => {
  it.each([
    [0, "2026-10-01"],
    [-1, "2026-09-30"],
  ])("offset %i of a 00:30 local session is %s", async (offset, expected) => {
    expect(
      await one(
        `select private.prep_day(${LOCAL("2026-10-01 00:30")}, $1)::text as v`,
        [offset]
      )
    ).toBe(expected)
  })
})

describe("private.normalize_phone", () => {
  it.each([
    "054-123 4567",
    "+972 54 123 4567",
    "00972541234567",
    "+972054 123 4567",
    "(054) 123.4567",
    // Invisible and dash characters, written as escapes on purpose.
    "054\u00a01234567", // no-break space
    "054\u200b1234567", // zero-width space
    "\u200e054-1234567\u200f", // LRM ... RLM
    "\u202a054-1234567\u202c", // LRE ... PDF
    "\u2066054-1234567\u2069", // LRI ... PDI
    "054\u20111234567", // non-breaking hyphen
    "054\u22121234567", // minus sign
  ])("%j is +972541234567", async (raw) => {
    expect(await one(`select private.normalize_phone($1) as v`, [raw])).toBe(
      "+972541234567"
    )
  })

  it.each([
    ["03-612 3456", "+97236123456"],
    ["+1 212 555 0100", "+12125550100"],
    ["0044 7700 900123", "+447700900123"],
  ])("%j is %s", async (raw, expected) => {
    expect(await one(`select private.normalize_phone($1) as v`, [raw])).toBe(
      expected
    )
  })

  it.each([
    "",
    "12345",
    "abc",
    "+972 5",
    null,
    "541234567",
    "54+1234567",
    "+0123456789",
    "0141234567",
    "+1234567",
    "054123456",
    "0212345678",
    "05412345678",
    "+97254123456",
  ])("%j is null", async (raw) => {
    expect(
      await one(`select private.normalize_phone($1) as v`, [raw])
    ).toBeNull()
  })
})

describe("helper grants", () => {
  const helpers = [
    "private.local_day_end(date)",
    "private.registration_closes_at(timestamptz, integer, time)",
    "private.cancel_deadline(integer, timestamptz)",
    "private.local_week_start(date)",
    "private.prep_day(timestamptz, integer)",
    "private.normalize_phone(text)",
  ]

  it.each(helpers)(
    "%s is not executable by anon, authenticated or service_role",
    async (signature) => {
      const rows = await sql<{
        anon: boolean
        authenticated: boolean
        service_role: boolean
      }>(
        `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as authenticated,
              has_function_privilege('service_role', $1, 'execute') as service_role`,
        [signature]
      )
      expect(rows[0]).toEqual({
        anon: false,
        authenticated: false,
        service_role: false,
      })
    }
  )

  it("an authenticated call is refused", async () => {
    await expect(
      inRollback(async (db) => {
        await db.query("set local role authenticated")
        await db.query("select private.normalize_phone('0541234567')")
      })
    ).rejects.toMatchObject({ code: "42501" })
  })
})
