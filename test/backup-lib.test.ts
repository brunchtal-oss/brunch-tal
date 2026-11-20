import { describe, expect, it } from "vitest"

import {
  checkDumpAgainstLive,
  compareCounts,
  contentTypeOf,
  countCopyRows,
  countCronJobs,
  latestRelease,
  mediaToDownload,
  pgEnvFromUrl,
  prepareDumpScript,
  publicObjectUrl,
  redact,
  releasesToDelete,
  safeErrorLines,
  safeMediaPath,
  targetConfig,
} from "../ops/backup/lib.mjs"

// Story 6.3: the pure helpers of the external backup (ops/backup).
const REF = "abcdefghijklmnopqrst"
const PASSWORD = "S3cret@Pass#word"
const HOST = "aws-0-eu-central-1.pooler.supabase.com"
const url = (user = `backup_reader.${REF}`, port = 5432) =>
  `postgresql://${user}:${encodeURIComponent(PASSWORD)}@${HOST}:${port}/postgres`

function messageOf(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    return (error as Error).message
  }
  throw new Error("expected a throw")
}

describe("targetConfig", () => {
  it("prod and dev have their own release prefix and media folder", () => {
    expect(targetConfig("prod")).toEqual({ prefix: "db-", mediaDir: "media" })
    expect(targetConfig("dev")).toEqual({
      prefix: "dev-db-",
      mediaDir: "media-dev",
    })
    expect(() => targetConfig("staging")).toThrow()
    expect(() => targetConfig(undefined)).toThrow()
  })
})

describe("pgEnvFromUrl", () => {
  it("turns the pooler URL into libpq variables and the project ref", () => {
    const { env, ref } = pgEnvFromUrl(url())
    expect(ref).toBe(REF)
    expect(env).toEqual({
      PGHOST: HOST,
      PGPORT: "5432",
      PGUSER: `backup_reader.${REF}`,
      PGPASSWORD: PASSWORD,
      PGDATABASE: "postgres",
      PGSSLMODE: "require",
    })
  })

  it("refuses another user, the transaction pooler, no password, a bad URL", () => {
    expect(() => pgEnvFromUrl(url(`postgres.${REF}`))).toThrow(/backup_reader/)
    expect(() => pgEnvFromUrl(url(undefined, 6543))).toThrow(/5432/)
    expect(() =>
      pgEnvFromUrl(`postgresql://backup_reader.${REF}@${HOST}:5432/postgres`)
    ).toThrow(/password/)
    expect(() => pgEnvFromUrl("not a url")).toThrow()
    expect(() => pgEnvFromUrl(undefined)).toThrow()
  })

  it("never puts the URL, password or host in an error", () => {
    const bad = [
      url(`postgres.${REF}`),
      url(undefined, 6543),
      `https://backup_reader.${REF}:${PASSWORD}@${HOST}/x`,
      `postgresql://backup_reader.${REF}:${encodeURIComponent(PASSWORD)}@${HOST}:54x2/postgres`,
    ]
    for (const value of bad) {
      const message = messageOf(() => pgEnvFromUrl(value))
      expect(message).not.toContain(PASSWORD)
      expect(message).not.toContain(encodeURIComponent(PASSWORD))
      expect(message).not.toContain(HOST)
      expect(message).not.toContain(REF)
    }
  })

  it("lists the secrets redact needs", () => {
    const { secrets } = pgEnvFromUrl(url())
    const text = `connect to ${HOST} as backup_reader.${REF} with ${PASSWORD} (${url()})`
    const out = redact(text, secrets)
    expect(out).not.toContain(PASSWORD)
    expect(out).not.toContain(HOST)
    expect(out).not.toContain(REF)
  })
})

describe("redact", () => {
  it("masks every secret, longest first, and ignores short values", () => {
    expect(redact("a secret-long and secret", ["secret", "secret-long"])).toBe(
      "a *** and ***"
    )
    expect(redact("abc", ["ab", undefined, ""])).toBe("abc")
  })
})

const CLI_OUTPUT = `#!/usr/bin/env bash
set -euo pipefail

export PGHOST="db.invalid"
export PGPORT="5432"
export PGUSER="backup_reader"
export PGPASSWORD=""
export PGDATABASE="postgres"

# Explanation of pg_dump flags:
#   --role  ignored
pg_dump \\
    --data-only \\
    --quote-all-identifier \\
    --role "postgres" \\
    --schema "*" \\
| sed -E 's/^\\\\(un)?restrict .*$/-- &/'

echo "RESET ALL;"
`

describe("prepareDumpScript", () => {
  it("drops the connection exports and the --role flag, keeps the rest", () => {
    const script = prepareDumpScript(`Target: custom\n${CLI_OUTPUT}`)
    expect(script.startsWith("#!/usr/bin/env bash\n")).toBe(true)
    expect(script).not.toMatch(/export PG/)
    expect(script).not.toContain('--role "postgres"')
    expect(script).toContain("--data-only")
    expect(script).toContain('--schema "*"')
    expect(script).toContain('echo "RESET ALL;"')
  })

  it("accepts Windows line endings", () => {
    const script = prepareDumpScript(CLI_OUTPUT.replace(/\n/g, "\r\n"))
    expect(script).not.toContain("\r")
    expect(script).not.toContain('--role "postgres"')
  })

  it("refuses output without a script or with another --role", () => {
    expect(() => prepareDumpScript("Dumping data...\n")).toThrow()
    expect(() => prepareDumpScript("set -euo pipefail\necho hi\n")).toThrow(
      /pg_dump/
    )
    expect(() =>
      prepareDumpScript(
        'set -euo pipefail\npg_dump --role "supabase_admin" --data-only\n'
      )
    ).toThrow(/--role/)
  })
})

const DATA_SQL = [
  "SET session_replication_role = replica;",
  "",
  'COPY "auth"."users" ("id", "email") FROM stdin;',
  "1\ta@example.test",
  "2\tb@example.test",
  "\\.",
  'COPY "auth"."identities" ("id") FROM stdin;',
  "9",
  "\\.",
  'COPY "public"."bookings" ("id", "note") FROM stdin;',
  "1\tline one\\nline two",
  "\\.",
  'COPY "public"."empty_table" ("id") FROM stdin;',
  "\\.",
  "COPY public.plain (id) FROM stdin;",
  "1",
  "\\.",
  'COPY "storage"."objects" ("id") FROM stdin;',
  "1",
  "2",
  "3",
  "\\.",
  'COPY "public"."we""ird" ("id") FROM stdin;',
  "1",
  "\\.",
  "RESET ALL;",
].join("\n")

describe("countCopyRows", () => {
  it("counts the rows of every counted table, empty ones included", () => {
    expect(countCopyRows(DATA_SQL)).toEqual({
      "auth.users": 2,
      "public.bookings": 1,
      "public.empty_table": 0,
      "public.plain": 1,
      'public.we"ird': 1,
      "storage.objects": 3,
    })
  })

  it("refuses a dump cut inside a COPY block", () => {
    expect(() =>
      countCopyRows('COPY "public"."x" ("id") FROM stdin;\n1\n')
    ).toThrow(/public\.x/)
  })
})

describe("compareCounts", () => {
  it("passes when every table matches", () => {
    const counts = { "public.a": 1, "auth.users": 2, "storage.objects": 0 }
    const result = compareCounts(counts, { ...counts })
    expect(result.ok).toBe(true)
    expect(result.mismatched).toEqual([])
    expect(result.lines).toHaveLength(3)
  })

  it("names every table that differs or is missing on either side", () => {
    const result = compareCounts(
      { "public.a": 1, "public.b": 2, "auth.users": 3 },
      { "public.a": 1, "public.b": 5, "public.c": 0 }
    )
    expect(result.ok).toBe(false)
    expect(result.mismatched).toEqual(["auth.users", "public.b", "public.c"])
    expect(result.lines).toContain("✗ public.b: backup 2, restored 5")
    expect(result.lines).toContain("✗ public.c: backup missing, restored 0")
  })

  it("ignores tables outside the counted set and fails on nothing", () => {
    expect(
      compareCounts({ "auth.sessions": 1 }, { "auth.sessions": 2 }).ok
    ).toBe(false)
    expect(
      compareCounts(
        { "public.a": 1, "auth.sessions": 1 },
        { "public.a": 1, "auth.sessions": 2 }
      ).ok
    ).toBe(true)
  })
})

describe("checkDumpAgainstLive", () => {
  it("a live table missing from the dump is missing; a different count only differs", () => {
    expect(
      checkDumpAgainstLive(
        { "public.a": 1, "public.b": 2 },
        { "public.a": 1, "public.b": 3, "public.c": 0, "auth.sessions": 1 }
      )
    ).toEqual({ missing: ["public.c"], differ: ["public.b"] })
  })
})

const days = (prefix: string, from: Date, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(from.getTime() + i * 86_400_000)
    return `${prefix}${d.toISOString().slice(0, 10)}`
  })

describe("releasesToDelete", () => {
  it("keeps everything up to 30 daily backups", () => {
    const tags = days("db-", new Date("2026-11-01T00:00:00Z"), 30)
    expect(releasesToDelete(tags, { prefix: "db-" })).toEqual([])
  })

  it("keeps the last 30 days and the first of each of 12 months", () => {
    // 2025-10-01 .. 2026-12-31: 15 months of daily backups.
    const tags = days("db-", new Date("2025-10-01T00:00:00Z"), 457)
    const deleted = releasesToDelete(tags, { prefix: "db-" })
    const kept = tags.filter((t) => !deleted.includes(t))
    const lastThirty = tags.slice(-30)
    const monthly = [
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
    ].map((m) => `db-${m}-01`)
    expect(kept.sort()).toEqual(
      [...new Set([...monthly, ...lastThirty])].sort()
    )
    expect(kept).not.toContain("db-2025-12-01")
    expect(deleted).toContain("db-2025-10-01")
    expect(deleted).toEqual([...deleted].sort())
  })

  it("keeps the first existing backup of a month, not only the 1st", () => {
    const tags = [
      "db-2026-01-05",
      "db-2026-01-20",
      ...days("db-", new Date("2026-03-01T00:00:00Z"), 31),
    ]
    const deleted = releasesToDelete(tags, { prefix: "db-" })
    expect(deleted).not.toContain("db-2026-01-05")
    expect(deleted).toContain("db-2026-01-20")
    expect(deleted).not.toContain("db-2026-03-01")
  })

  it("never touches other tags or the other target's tags", () => {
    const prod = days("db-", new Date("2026-01-01T00:00:00Z"), 60)
    const dev = days("dev-db-", new Date("2026-01-01T00:00:00Z"), 60)
    const tags = [...prod, ...dev, "v1.0", "db-latest", "db-2026-1-1"]
    const deleted = releasesToDelete(tags, { prefix: "db-" })
    expect(deleted.every((t) => /^db-\d{4}-\d{2}-\d{2}$/.test(t))).toBe(true)
    expect(deleted).toHaveLength(60 - 30 - 1)
    const devDeleted = releasesToDelete(tags, { prefix: "dev-db-" })
    expect(devDeleted.every((t) => t.startsWith("dev-db-"))).toBe(true)
  })
})

describe("latestRelease", () => {
  it("is the newest dated tag of the prefix", () => {
    expect(
      latestRelease(
        ["db-2026-11-02", "db-2026-11-20", "dev-db-2026-11-21", "db-x"],
        "db-"
      )
    ).toBe("db-2026-11-20")
    expect(latestRelease(["dev-db-2026-11-21"], "dev-db-")).toBe(
      "dev-db-2026-11-21"
    )
    expect(latestRelease(["v1"], "db-")).toBeNull()
  })
})

describe("media helpers", () => {
  it("safeMediaPath accepts bucket names and refuses escapes", () => {
    expect(safeMediaPath("abc.jpg")).toBe("abc.jpg")
    expect(safeMediaPath("email/header.jpg")).toBe("email/header.jpg")
    for (const bad of [
      "",
      "../x",
      "a/../b",
      "/etc/passwd",
      "a\\b",
      "a//b",
      "./a",
      "C:x",
    ]) {
      expect(safeMediaPath(bad), bad).toBeNull()
    }
  })

  it("mediaToDownload takes new, changed and locally missing files", () => {
    const objects = [
      { name: "a.jpg", updated_at: "1" },
      { name: "b.jpg", updated_at: "2" },
      { name: "c.jpg", updated_at: "3" },
      { name: "d.jpg", updated_at: "4" },
    ]
    const previous = [
      { name: "a.jpg", updated_at: "1" },
      { name: "b.jpg", updated_at: "1" },
      { name: "d.jpg", updated_at: "4" },
    ]
    const present = new Set(["a.jpg", "b.jpg", "c.jpg"])
    expect(
      mediaToDownload(objects, previous, (n) => present.has(n)).map(
        (o) => o.name
      )
    ).toEqual(["b.jpg", "c.jpg", "d.jpg"])
  })

  it("publicObjectUrl encodes each part and keeps the folders", () => {
    expect(
      publicObjectUrl(
        "https://x.supabase.co/",
        "media-public",
        "email/head er.jpg"
      )
    ).toBe(
      "https://x.supabase.co/storage/v1/object/public/media-public/email/head%20er.jpg"
    )
  })

  it("contentTypeOf prefers the stored mimetype", () => {
    expect(contentTypeOf({ name: "a.jpg", mimetype: "image/webp" })).toBe(
      "image/webp"
    )
    expect(contentTypeOf({ name: "a.JPG" })).toBe("image/jpeg")
    expect(contentTypeOf({ name: "a" })).toBe("application/octet-stream")
  })
})

describe("safeErrorLines", () => {
  it("keeps only ERROR / FATAL lines, without row data", () => {
    const log = [
      'psql:/work/data.sql:120: ERROR:  duplicate key value violates unique constraint "users_pkey"',
      "DETAIL:  Key (email)=(dana@example.test) already exists.",
      'CONTEXT:  COPY users, line 3: "3\tdana@example.test"',
      'psql:/work/data.sql:9: ERROR:  invalid input syntax for type uuid: "secret-row-value"',
      "ERROR:  value 'Dana Levi' is too long, Key (id)=(42) conflicts",
      'FATAL:  password authentication failed for user "backup_reader.abc"',
    ].join("\n")
    const lines = safeErrorLines(log)
    expect(lines).toHaveLength(4)
    const all = lines.join("\n")
    expect(all).toContain('unique constraint "users_pkey"')
    expect(all).not.toContain("dana@example.test")
    expect(all).not.toContain("secret-row-value")
    expect(all).not.toContain("Dana Levi")
    expect(all).not.toContain("(42)")
    expect(all).not.toContain("DETAIL")
    expect(all).not.toContain("CONTEXT")
  })

  it("masks every quoted value, keeping only an identifier after an object keyword", () => {
    const log = [
      'psql:/work/data.sql:7: ERROR:  malformed array literal: "{dana,050-1234567"',
      'ERROR:  value "99999999999" is out of range for type integer',
      'ERROR:  "2026-13-01" out of range: "secret-date"',
      'ERROR:  relation "public.bookings" does not exist',
      'ERROR:  column "Dana Levi" does not exist',
      'psql:/work/x.sql:1: ERROR:  constraint "users_pkey" broken',
    ].join("\n")
    const all = safeErrorLines(log, 10).join("\n")
    for (const value of [
      "dana",
      "050-1234567",
      "99999999999",
      "2026-13-01",
      "secret-date",
      "Dana Levi",
    ]) {
      expect(all, value).not.toContain(value)
    }
    expect(all).toContain('relation "public.bookings"')
    expect(all).toContain('constraint "users_pkey"')
    expect(all).toContain("psql:/work/data.sql:7: ERROR:")
  })

  it("does not count cron.job (the dump skips the cron schema)", () => {
    expect(
      countCopyRows('COPY "cron"."job" ("jobid") FROM stdin;\n1\n2\n\\.\n')
    ).toEqual({})
  })
})

describe("countCronJobs", () => {
  it("counts one cron.schedule statement per job, multi-line commands included", () => {
    const cronSql = [
      "select cron.schedule('a', '* * * * *', 'select 1');",
      "select cron.schedule('b', '0 * * * *', 'select",
      "  2');",
      "",
    ].join("\n")
    expect(countCronJobs(cronSql)).toBe(2)
    expect(countCronJobs("")).toBe(0)
    expect(countCronJobs(cronSql.replace(/\n/g, "\r\n"))).toBe(2)
  })
})
