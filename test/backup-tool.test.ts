import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, it } from "vitest"

// Story 6.3: ops/backup/tool.mjs as backup.sh and drill.sh call it (no
// network, temp files only).
const TOOL = join(__dirname, "..", "ops", "backup", "tool.mjs")
const REF = "abcdefghijklmnopqrst"
const PASSWORD = "Tool$ecret#Pw1"
const HOST = "aws-0-eu-central-1.pooler.supabase.com"
const DB_URL = `postgresql://backup_reader.${REF}:${encodeURIComponent(PASSWORD)}@${HOST}:5432/postgres`

const dir = mkdtempSync(join(tmpdir(), "backup-tool-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function run(args: string[], input = "", env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [TOOL, ...args], {
    input,
    encoding: "utf8",
    env: { ...process.env, BACKUP_DB_URL: "", ...env },
  })
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  }
}

function file(name: string, content: string) {
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

const DATA_SQL = [
  'COPY "public"."a" ("id") FROM stdin;',
  "1",
  "2",
  "\\.",
  'COPY "auth"."users" ("id") FROM stdin;',
  "1",
  "\\.",
].join("\n")

describe("tool.mjs errors", () => {
  it("prints no ref, host or password", () => {
    const log = [
      `psql: error: connection to server at "${HOST}" failed: FATAL:  password authentication failed for user "backup_reader.${REF}"`,
      `FATAL:  could not translate host name "${HOST}" to address`,
      `ERROR:  password "${PASSWORD}" rejected for ${HOST}`,
    ].join("\n")
    const { output } = run(["errors"], log, { BACKUP_DB_URL: DB_URL })
    expect(output).toContain("FATAL")
    expect(output).not.toContain(REF)
    expect(output).not.toContain(HOST)
    expect(output).not.toContain(PASSWORD)
  })
})

describe("tool.mjs count-dump and compare", () => {
  const data = file("data.sql", DATA_SQL)
  const objects = file("objects.json", '[{"name":"x.jpg"}]')

  it("fails when the live database has a table the dump lacks", () => {
    const live = file(
      "live-extra.json",
      '{"public.a":2,"public.b":0,"auth.users":1}'
    )
    const out = join(dir, "counts-extra.json")
    const { status, output } = run([
      "count-dump",
      data,
      live,
      objects,
      "db-2026-11-20",
      out,
    ])
    expect(status).not.toBe(0)
    expect(output).toContain("public.b")
  })

  it("writes the counts, then compare passes on equal and fails on different", () => {
    const live = file("live.json", '{"public.a":2,"auth.users":1}')
    const out = join(dir, "counts.json")
    expect(
      run(["count-dump", data, live, objects, "db-2026-11-20", out]).status
    ).toBe(0)
    const counts = JSON.parse(readFileSync(out, "utf8"))
    expect(counts.tag).toBe("db-2026-11-20")
    expect(counts.tables).toEqual({ "auth.users": 1, "public.a": 2 })
    expect(counts.media_public_objects).toBe(1)

    const same = file("restored.json", '{"public.a":2,"auth.users":1}')
    expect(run(["compare", out, same]).status).toBe(0)

    const other = file("restored-other.json", '{"public.a":3,"auth.users":1}')
    const result = run(["compare", out, other])
    expect(result.status).not.toBe(0)
    expect(result.output).toContain("public.a")
  })

  it("records cron_jobs from cron.sql outside tables, and cron-jobs prints it", () => {
    const live = file("live-cron.json", '{"public.a":2,"auth.users":1}')
    const cronSql = file(
      "cron.sql",
      "select cron.schedule('a', '* * * * *', 'select 1');\nselect cron.schedule('b', '0 * * * *', 'select 2');\n"
    )
    const out = join(dir, "counts-cron.json")
    expect(
      run(["count-dump", data, live, objects, "db-2026-11-20", out, cronSql])
        .status
    ).toBe(0)
    const counts = JSON.parse(readFileSync(out, "utf8"))
    expect(counts.cron_jobs).toBe(2)
    expect(counts.tables).toEqual({ "auth.users": 1, "public.a": 2 })
    const printed = run(["cron-jobs", out])
    expect(printed.status).toBe(0)
    expect(printed.output.trim()).toBe("2")
  })

  it("cron-jobs prints nothing for an older backup without cron_jobs", () => {
    const old = file("counts-old.json", '{"tag":"db-2026-11-01","tables":{}}')
    const printed = run(["cron-jobs", old])
    expect(printed.status).toBe(0)
    expect(printed.output.trim()).toBe("")
  })
})
