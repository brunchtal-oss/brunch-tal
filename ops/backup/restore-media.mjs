// Story 6.3: uploads a backup's image folder into the public bucket
// (media-public) of a target project, after the database was restored there.
//
//   node restore-media.mjs --dir <media-dir> [--objects <objects.json>]
//                          [--env-file <file>] [--apply]
//
// The target comes only from the env file (default .env.restore.local, which
// .gitignore already covers as `.env*`): RESTORE_SUPABASE_URL
// (https://<ref>.supabase.co) and RESTORE_SUPABASE_SECRET_KEY (the target's
// sb_secret_ key, or the local stack's service key in the drill). Neither is
// ever printed. The object list is <media-dir>/manifest.json, or --objects
// (the drill passes the restored storage.objects listing). Without --apply
// it is a dry run: it prints how many files would be uploaded. Existing
// objects are overwritten (x-upsert), so a rerun reaches the same state.
// It refuses the dev project (NEXT_PUBLIC_SUPABASE_URL in .env.local), which
// is never a restore target, and the current production project
// (PROD_SUPABASE_URL in .env.prod.local). For a real restore, pass
// --objects from media-list.sql run on the restored database: the folder's
// manifest.json is the newest bucket listing, not the restored backup's.

import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { parseEnv } from "node:util"

import { contentTypeOf, redact, safeMediaPath } from "./lib.mjs"

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(1)
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}

const dir = arg("--dir")
if (!dir) fail("--dir <media-dir> is required")
const envFile = arg("--env-file") ?? ".env.restore.local"
const apply = process.argv.includes("--apply")
if (!existsSync(envFile)) {
  fail(`missing ${envFile} (RESTORE_SUPABASE_URL, RESTORE_SUPABASE_SECRET_KEY)`)
}
const env = parseEnv(readFileSync(envFile, "utf8"))
const url = (env.RESTORE_SUPABASE_URL ?? "").trim().replace(/\/+$/, "")
const key = (env.RESTORE_SUPABASE_SECRET_KEY ?? "").trim()
if (!url || !key) {
  fail(`${envFile} needs RESTORE_SUPABASE_URL and RESTORE_SUPABASE_SECRET_KEY`)
}
let host
try {
  host = new URL(url).host
} catch {
  fail("RESTORE_SUPABASE_URL is not a URL")
}
if (existsSync(".env.local")) {
  const dev = parseEnv(readFileSync(".env.local", "utf8"))
  try {
    if (new URL(dev.NEXT_PUBLIC_SUPABASE_URL ?? "").host === host) {
      fail(
        "RESTORE_SUPABASE_URL is the dev project; it is never a restore target"
      )
    }
  } catch {
    // no dev URL in .env.local
  }
}
// Nor the current production project: only the ref of PROD_SUPABASE_URL is
// read from .env.prod.local (through the site repo's scripts/prod-env.mjs),
// and nothing of it is printed.
if (existsSync(".env.prod.local")) {
  let isProd = false
  try {
    const { readEnvFile, projectRef } = await import(
      pathToFileURL(resolve("scripts/prod-env.mjs")).href
    )
    const prodRef = projectRef(
      readEnvFile(".env.prod.local")?.PROD_SUPABASE_URL
    )
    isProd = Boolean(prodRef) && prodRef === projectRef(url)
  } catch {
    fail(
      "found .env.prod.local but could not read it with scripts/prod-env.mjs; run from the site repo root"
    )
  }
  if (isProd) {
    fail(
      "RESTORE_SUPABASE_URL is the current production project (.env.prod.local); restore into a new project"
    )
  }
}

const objectsFile = arg("--objects") ?? join(dir, "manifest.json")
if (!existsSync(objectsFile)) fail(`missing ${objectsFile}`)
const objects = JSON.parse(readFileSync(objectsFile, "utf8"))
const missing = objects.filter((o) => {
  const path = safeMediaPath(o.name)
  return !path || !existsSync(join(dir, path))
})
if (missing.length > 0) {
  for (const o of missing.slice(0, 20)) console.error(`  no file: ${o.name}`)
  fail(`${missing.length} of ${objects.length} images have no file in ${dir}`)
}

if (!apply) {
  console.log(
    `dry run: ${objects.length} images from ${dir} would be uploaded to media-public. Add --apply to upload.`
  )
  process.exit(0)
}

let uploaded = 0
const failed = []
for (const object of objects) {
  const path = object.name.split("/").map(encodeURIComponent).join("/")
  try {
    const response = await fetch(
      `${url}/storage/v1/object/media-public/${path}`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "x-upsert": "true",
          "content-type": contentTypeOf(object),
        },
        body: readFileSync(join(dir, object.name)),
      }
    )
    await response.text().catch(() => "")
    if (response.ok) uploaded += 1
    else failed.push(`${object.name}: HTTP ${response.status}`)
  } catch (error) {
    failed.push(
      `${object.name}: ${redact(/** @type {Error} */ (error).message, [key, url])}`
    )
  }
}
console.log(`uploaded ${uploaded}/${objects.length} images to media-public`)
if (failed.length > 0) {
  for (const f of failed.slice(0, 20)) console.error(`  ${f}`)
  fail(`${failed.length} uploads failed`)
}
