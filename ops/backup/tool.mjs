// Story 6.3: the command-line side of lib.mjs, called by backup.sh and
// drill.sh. Every subcommand prints only file names, sizes, table names and
// row counts; the database URL is read from the environment, never from
// argv.
//
//   node tool.mjs pg-env <env-file> <ref-file>   BACKUP_DB_URL -> libpq vars file (docker --env-file) + project ref; prints ::add-mask:: lines
//   node tool.mjs prepare-dump <cli-out> <script>
//   node tool.mjs count-dump <data.sql> <live.json> <objects.json> <tag> <out.json> [<cron.sql>]
//   node tool.mjs cron-jobs <counts.json>         the backup's cron_jobs (empty for an older backup)
//   node tool.mjs compare <counts.json> <restored.json>
//   node tool.mjs retention <prefix>             tags on stdin -> tags to delete
//   node tool.mjs latest <prefix>                tags on stdin -> newest tag
//   node tool.mjs errors                         a log on stdin -> masked ERROR lines
//   node tool.mjs media-verify <base-url> <objects.json> <media-dir> <counts.json>

import {
  createReadStream,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"

import {
  checkDumpAgainstLive,
  compareCounts,
  countCronJobs,
  createCopyCounter,
  latestRelease,
  pgEnvFromUrl,
  prepareDumpScript,
  publicObjectUrl,
  redact,
  releasesToDelete,
  safeErrorLines,
  safeMediaPath,
} from "./lib.mjs"

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

async function readStdin() {
  let text = ""
  for await (const chunk of process.stdin) text += chunk
  return text
}

function urlSecrets() {
  try {
    return pgEnvFromUrl(process.env.BACKUP_DB_URL).secrets
  } catch {
    return [process.env.BACKUP_DB_URL]
  }
}

const commands = {
  "pg-env"(out, refOut) {
    let parsed
    try {
      parsed = pgEnvFromUrl(process.env.BACKUP_DB_URL)
    } catch (error) {
      fail(/** @type {Error} */ (error).message)
    }
    const { env, ref } = /** @type {NonNullable<typeof parsed>} */ (parsed)
    for (const value of [env.PGPASSWORD, env.PGHOST, env.PGUSER]) {
      if (/[\r\n]/.test(value)) fail("BACKUP_DB_URL holds a line break")
      console.log(`::add-mask::${value}`)
    }
    writeFileSync(
      out,
      Object.entries(env)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
      { mode: 0o600 }
    )
    writeFileSync(refOut, `${ref}\n`)
  },

  "prepare-dump"(input, out) {
    writeFileSync(out, prepareDumpScript(readFileSync(input, "utf8")))
  },

  async "count-dump"(dataSql, liveJson, objectsJson, tag, out, cronSql) {
    const counter = createCopyCounter()
    const lines = createInterface({
      input: createReadStream(dataSql, { encoding: "utf8" }),
      crlfDelay: Infinity,
    })
    for await (const line of lines) counter.push(line)
    const tables = counter.result()
    const live = readJson(liveJson)
    const { missing, differ } = checkDumpAgainstLive(tables, live)
    if (missing.length > 0) {
      fail(`tables missing from the data dump: ${missing.join(", ")}`)
    }
    for (const name of differ) {
      console.log(
        `! ${name}: dump ${tables[name]}, live ${live[name]} (rows written during the dump)`
      )
    }
    const objects = readJson(objectsJson)
    // The scheduled jobs are not in the dump (cron-dump.sql -> cron.sql),
    // so their count is its own field, outside `tables`.
    const cronJobs = cronSql
      ? countCronJobs(readFileSync(cronSql, "utf8"))
      : undefined
    writeFileSync(
      out,
      `${JSON.stringify(
        {
          tag,
          created_at: new Date().toISOString(),
          tables,
          media_public_objects: objects.length,
          ...(cronJobs === undefined ? {} : { cron_jobs: cronJobs }),
        },
        null,
        2
      )}\n`
    )
    const rows = Object.values(tables).reduce((a, b) => a + b, 0)
    console.log(
      `counts: ${Object.keys(tables).length} tables, ${rows} rows, ${objects.length} public images`
    )
  },

  // The backup's job count, or nothing (exit 0) for an older backup.
  "cron-jobs"(countsJson) {
    const { cron_jobs: n } = readJson(countsJson)
    if (Number.isInteger(n)) console.log(n)
  },

  compare(countsJson, restoredJson) {
    const { tables } = readJson(countsJson)
    const result = compareCounts(tables, readJson(restoredJson))
    for (const line of result.lines) console.log(line)
    if (!result.ok) {
      fail(`row counts differ: ${result.mismatched.join(", ")}`)
    }
    console.log(`✓ all ${result.lines.length} tables match`)
  },

  async retention(prefix) {
    const tags = (await readStdin()).split(/\s+/).filter(Boolean)
    for (const tag of releasesToDelete(tags, { prefix })) console.log(tag)
  },

  async latest(prefix) {
    const tags = (await readStdin()).split(/\s+/).filter(Boolean)
    const tag = latestRelease(tags, prefix)
    if (!tag) fail(`no release ${prefix}YYYY-MM-DD`)
    console.log(tag)
  },

  async errors() {
    const lines = safeErrorLines(await readStdin(), 8)
    for (const line of lines) console.error(redact(line, urlSecrets()))
  },

  async "media-verify"(baseUrl, objectsJson, mediaDir, countsJson) {
    const objects = readJson(objectsJson)
    const expected = readJson(countsJson).media_public_objects
    const problems = []
    if (objects.length !== expected) {
      problems.push(
        `restored storage.objects has ${objects.length} public images, the backup ${expected}`
      )
    }
    let served = 0
    for (const object of objects) {
      const path = safeMediaPath(object.name)
      if (!path || !existsSync(join(mediaDir, path))) {
        problems.push(`no file in ${mediaDir}/: ${object.name}`)
        continue
      }
      const response = await fetch(
        publicObjectUrl(baseUrl, "media-public", object.name)
      )
      await response.arrayBuffer().catch(() => {})
      if (response.status === 200) served += 1
      else problems.push(`${object.name}: HTTP ${response.status}`)
    }
    console.log(
      `${problems.length === 0 ? "✓" : "✗"} images: ${served}/${objects.length} served by the restored storage (backup: ${expected})`
    )
    if (problems.length > 0) {
      for (const p of problems.slice(0, 20)) console.log(`  ${p}`)
      fail("image check failed")
    }
  },
}

const [name, ...args] = process.argv.slice(2)
const command = commands[/** @type {keyof typeof commands} */ (name)]
if (!command) fail(`unknown command "${name ?? ""}"`)
try {
  await command(...args)
} catch (error) {
  fail(redact(/** @type {Error} */ (error).message, urlSecrets()))
}
