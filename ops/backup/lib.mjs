// Story 6.3: the pure helpers of the external backup (no file, no network,
// no process.env). The shell scripts reach them through tool.mjs; the unit
// tests are test/backup-*.test.ts.
//
// Nothing here returns a secret: messages carry only table names, file
// names, sizes and row counts.

/** Release tag prefix and media folder per backup target. */
export const TARGETS = {
  prod: { prefix: "db-", mediaDir: "media" },
  dev: { prefix: "dev-db-", mediaDir: "media-dev" },
}

/**
 * The settings of a target, or throws for anything but "prod" / "dev".
 *
 * @param {string | undefined} target
 */
export function targetConfig(target) {
  const config = TARGETS[/** @type {"prod" | "dev"} */ (target ?? "")]
  if (!config) throw new Error(`unknown target "${target}" (prod or dev)`)
  return config
}

// ---------------------------------------------------------------------------
// Database URL -> libpq environment (the password never reaches a command line)
// ---------------------------------------------------------------------------

/**
 * libpq variables for a session pooler URL with user backup_reader.<ref>.
 * Returns { env, ref, secrets } or throws a message without any value.
 *
 * @param {string | undefined} databaseUrl
 */
export function pgEnvFromUrl(databaseUrl) {
  let parsed
  try {
    parsed = new URL(databaseUrl ?? "")
  } catch {
    throw new Error(
      "BACKUP_DB_URL is not a valid URL (percent-encode special characters in the password)"
    )
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new Error("BACKUP_DB_URL must start with postgresql://")
  }
  const user = decodeURIComponent(parsed.username)
  const ref = /^backup_reader\.([a-z0-9]{20})$/.exec(user)?.[1]
  if (!ref) {
    throw new Error(
      "BACKUP_DB_URL user must be backup_reader.<project-ref> (session pooler)"
    )
  }
  if (parsed.port === "6543") {
    throw new Error(
      "BACKUP_DB_URL is the transaction pooler (6543); use the session pooler (5432)"
    )
  }
  const password = decodeURIComponent(parsed.password)
  if (!password) throw new Error("BACKUP_DB_URL has no password")
  return {
    ref,
    env: {
      PGHOST: parsed.hostname,
      PGPORT: parsed.port || "5432",
      PGUSER: user,
      PGPASSWORD: password,
      PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)) || "postgres",
      PGSSLMODE: "require",
    },
    secrets: [
      String(databaseUrl),
      password,
      parsed.password,
      user,
      parsed.hostname,
    ],
  }
}

/**
 * Replaces each secret (length >= 4) in text by "***".
 *
 * @param {string} text
 * @param {Array<string | undefined>} secrets
 */
export function redact(text, secrets) {
  let out = String(text)
  const sorted = [...new Set(secrets.filter((s) => s && s.length >= 4))].sort(
    (a, b) => String(b).length - String(a).length
  )
  for (const secret of sorted) out = out.split(String(secret)).join("***")
  return out
}

// ---------------------------------------------------------------------------
// The Supabase CLI's dump scripts, run as backup_reader
// ---------------------------------------------------------------------------

/**
 * `supabase db dump --dry-run` prints the exact pg_dump / pg_dumpall script
 * Supabase uses (exclusions and sed filters). It always passes
 * `--role "postgres"`, which needs membership in postgres (write access), and
 * it exports the connection it was given. This keeps the script and drops
 * both, so it runs as the read-only backup_reader with libpq variables from
 * the environment.
 *
 * @param {string} text the CLI's stdout
 * @returns {string}
 */
export function prepareDumpScript(text) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n")
  const start = lines.findIndex((l) =>
    /^(#!\/usr\/bin\/env bash|set -euo pipefail)$/.test(l.trim())
  )
  if (start < 0) throw new Error("dump script: no script in the CLI output")
  const kept = lines
    .slice(start)
    .filter((l) => !/^\s*export PG[A-Z]+=/.test(l))
    .filter((l) => !/^\s*--role "postgres" \\$/.test(l))
  const script = kept.join("\n")
  if (!/\bpg_dump(all)?\b/.test(script)) {
    throw new Error("dump script: no pg_dump / pg_dumpall command")
  }
  if (/--role\b/.test(script.replace(/^\s*#.*$/gm, ""))) {
    throw new Error("dump script: a --role flag is still there")
  }
  return script.endsWith("\n") ? script : `${script}\n`
}

// ---------------------------------------------------------------------------
// Row counts
// ---------------------------------------------------------------------------

/**
 * Tables whose row counts are compared: every public table, auth.users,
 * storage.objects. Not cron.job: `supabase db dump` skips the cron schema
 * (proved by the first dev run, 2026-11-20); README restores the jobs.
 */
export function isCountedTable(name) {
  return (
    name.startsWith("public.") ||
    name === "auth.users" ||
    name === "storage.objects"
  )
}

function unquoteIdent(part) {
  return part.startsWith('"') ? part.slice(1, -1).replace(/""/g, '"') : part
}

const COPY_LINE =
  /^COPY ("(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)\.("(?:[^"]|"")+"|[a-z_][a-z0-9_$]*)(?: \(.*\))? FROM stdin;$/

/**
 * A line-by-line counter of the rows in a `pg_dump --data-only --use-copy`
 * file: one data line per row between `COPY ... FROM stdin;` and `\.`
 * (COPY text format escapes newlines inside values). Counting the dump
 * itself, not the live database, keeps the numbers consistent with what was
 * backed up.
 */
export function createCopyCounter() {
  /** @type {Record<string, number>} */
  const counts = {}
  let current = /** @type {string | null} */ (null)
  return {
    /** @param {string} line */
    push(line) {
      if (current) {
        if (line === "\\.") current = null
        else counts[current] += 1
        return
      }
      const match = COPY_LINE.exec(line)
      if (match) {
        current = `${unquoteIdent(match[1])}.${unquoteIdent(match[2])}`
        counts[current] = counts[current] ?? 0
      }
    },
    /** Counted tables only, sorted by name. */
    result() {
      if (current) throw new Error(`data dump ends inside COPY ${current}`)
      return Object.fromEntries(
        Object.entries(counts)
          .filter(([name]) => isCountedTable(name))
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      )
    },
  }
}

/** Counts of a whole data dump given as text (tests, small files). */
export function countCopyRows(text) {
  const counter = createCopyCounter()
  for (const line of String(text).replace(/\r\n/g, "\n").split("\n")) {
    counter.push(line)
  }
  return counter.result()
}

/**
 * The number of jobs in a cron.sql made by cron-dump.sql: one statement per
 * job, each starting a line with `select cron.schedule(` (a command with a
 * line break only continues its statement).
 *
 * @param {string} text
 */
export function countCronJobs(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((l) => l.startsWith("select cron.schedule(")).length
}

/**
 * Compares expected (the backup's counts) with actual (the restored
 * database). Every table on either side must match.
 *
 * @param {Record<string, number>} expected
 * @param {Record<string, number>} actual
 * @returns {{ ok: boolean, lines: string[], mismatched: string[] }}
 */
export function compareCounts(expected, actual) {
  const names = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .filter(isCountedTable)
    .sort()
  const lines = []
  const mismatched = []
  for (const name of names) {
    const e = expected[name]
    const a = actual[name]
    const ok = e !== undefined && a !== undefined && Number(e) === Number(a)
    if (!ok) mismatched.push(name)
    lines.push(
      `${ok ? "✓" : "✗"} ${name}: backup ${e ?? "missing"}, restored ${a ?? "missing"}`
    )
  }
  if (names.length === 0) {
    mismatched.push("(no tables)")
    lines.push("✗ no tables to compare")
  }
  return { ok: mismatched.length === 0, lines, mismatched }
}

/**
 * Live counts (counts.sql, read right after the dump) next to the dump's
 * own counts: a live table missing from the dump fails the backup; a
 * different number is only reported (rows written during the dump).
 *
 * @param {Record<string, number>} dump
 * @param {Record<string, number>} live
 */
export function checkDumpAgainstLive(dump, live) {
  const missing = Object.keys(live)
    .filter(isCountedTable)
    .filter((name) => dump[name] === undefined)
    .sort()
  const differ = Object.keys(live)
    .filter((name) => dump[name] !== undefined)
    .filter((name) => Number(dump[name]) !== Number(live[name]))
    .sort()
  return { missing, differ }
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/**
 * The daily Release tags to delete: of the tags `<prefix>YYYY-MM-DD`, keep
 * the newest `daily` and, for each of the newest `months` months that have
 * a backup, the first backup of that month. Other tags are never touched.
 *
 * @param {string[]} tags
 * @param {{ prefix: string, daily?: number, months?: number }} options
 * @returns {string[]} tags to delete, oldest first
 */
export function releasesToDelete(tags, { prefix, daily = 30, months = 12 }) {
  const dated = datedTags(tags, prefix)
  const keep = new Set(daily > 0 ? dated.slice(-daily).map((t) => t.tag) : [])
  /** @type {Map<string, string>} */
  const firstOfMonth = new Map()
  for (const t of dated) {
    const month = t.date.slice(0, 7)
    if (!firstOfMonth.has(month)) firstOfMonth.set(month, t.tag)
  }
  const recentMonths =
    months > 0 ? [...firstOfMonth.keys()].sort().slice(-months) : []
  for (const month of recentMonths) {
    keep.add(/** @type {string} */ (firstOfMonth.get(month)))
  }
  return dated.filter((t) => !keep.has(t.tag)).map((t) => t.tag)
}

/** The newest `<prefix>YYYY-MM-DD` tag, or null. */
export function latestRelease(tags, prefix) {
  const dated = datedTags(tags, prefix)
  return dated.length > 0 ? dated[dated.length - 1].tag : null
}

/** The `<prefix>YYYY-MM-DD` tags with their dates, oldest first. */
function datedTags(tags, prefix) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(`^${escaped}(\\d{4}-\\d{2}-\\d{2})$`)
  return [...new Set(tags)]
    .map((tag) => ({ tag, date: pattern.exec(tag)?.[1] ?? "" }))
    .filter((t) => t.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/**
 * A storage object name that is safe as a relative path under the media
 * folder (no "..", no absolute path, no backslash), or null.
 *
 * @param {string} name
 */
export function safeMediaPath(name) {
  if (typeof name !== "string" || name.length === 0 || name.length > 512) {
    return null
  }
  if (name.startsWith("/") || name.includes("\\") || name.includes("\0")) {
    return null
  }
  const parts = name.split("/")
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null
  if (/^[a-zA-Z]:/.test(name)) return null
  return name
}

/**
 * The objects to download: new names, or names whose updated_at changed
 * since the previous manifest. A name whose file is missing locally is
 * downloaded again.
 *
 * @param {Array<{ name: string, updated_at?: string | null }>} objects
 * @param {Array<{ name: string, updated_at?: string | null }>} previous
 * @param {(name: string) => boolean} fileExists
 */
export function mediaToDownload(objects, previous, fileExists) {
  const before = new Map(previous.map((o) => [o.name, o.updated_at ?? null]))
  return objects.filter(
    (o) =>
      !fileExists(o.name) ||
      !before.has(o.name) ||
      before.get(o.name) !== (o.updated_at ?? null)
  )
}

/** The public URL of one object (names keep their "/"; each part encoded). */
export function publicObjectUrl(baseUrl, bucket, name) {
  const path = name.split("/").map(encodeURIComponent).join("/")
  return `${baseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${path}`
}

const MIME_BY_EXT = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml",
}

/** The object's stored mimetype, else one from its extension. */
export function contentTypeOf(object) {
  if (object.mimetype) return object.mimetype
  const ext = /\.([a-z0-9]+)$/i.exec(object.name)?.[1]?.toLowerCase() ?? ""
  return (
    MIME_BY_EXT[/** @type {keyof typeof MIME_BY_EXT} */ (ext)] ??
    "application/octet-stream"
  )
}

// ---------------------------------------------------------------------------
// psql errors without data
// ---------------------------------------------------------------------------

/**
 * The ERROR lines of a psql log, with values masked: a failed COPY or
 * constraint prints row data in DETAIL / CONTEXT lines and quoted values,
 * and none of that may reach the Actions log.
 *
 * @param {string} log
 * @param {number} [max]
 */
export function safeErrorLines(log, max = 5) {
  return String(log)
    .split(/\r?\n/)
    .filter((l) => /\b(ERROR|FATAL):/.test(l))
    .map((l) => {
      const at = /\b(ERROR|FATAL):/.exec(l)
      const start = at ? at.index + at[0].length : 0
      const masked = l
        .slice(start)
        .replace(/\(.*?\)=\(.*?\)/g, "(***)=(***)")
        .replace(/'[^']*'/g, "'***'")
        // Every double-quoted segment is masked, except a plain identifier
        // right after an object keyword (constraint "users_pkey").
        .replace(/(\b\w+ )?"[^"]*"/g, (match, before) =>
          before &&
          SAFE_IDENT_BEFORE.test(before) &&
          SAFE_IDENT.test(match.slice(before.length))
            ? match
            : `${before ?? ""}"***"`
        )
      return `${l.slice(0, start)}${masked}`.slice(0, 200)
    })
    .slice(0, max)
}

const SAFE_IDENT_BEFORE =
  /^(constraint|relation|table|column|schema|function|type|index|sequence|extension|trigger|policy) $/i
const SAFE_IDENT = /^"[a-z_][a-z0-9_$.]*"$/
