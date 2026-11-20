// Story 6.3: copies the new files of the public bucket (media-public) into
// the private backup repo's media folder, add-only.
//
//   node media.mjs <objects.json> <media-dir> <supabase-url>
//
// objects.json is the bucket listing read from storage.objects over the
// database connection (media-list.sql, as backup_reader). Files are fetched
// by their public URL, so no API key is used. A file is downloaded when it
// is new, when its updated_at changed since the previous manifest, or when
// it is missing locally; the others are skipped. Files of deleted objects
// stay (add-only). <media-dir>/manifest.json is rewritten with the current
// listing. Prints only counts, sizes and file names.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

import { mediaToDownload, publicObjectUrl, safeMediaPath } from "./lib.mjs"

const [objectsJson, mediaDir, supabaseUrl] = process.argv.slice(2)
if (!objectsJson || !mediaDir || !supabaseUrl) {
  console.error(
    "usage: node media.mjs <objects.json> <media-dir> <supabase-url>"
  )
  process.exit(1)
}

const objects = JSON.parse(readFileSync(objectsJson, "utf8"))
const manifestPath = join(mediaDir, "manifest.json")
const previous = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : []

const unsafe = objects.filter(
  (o) => !safeMediaPath(o.name) || o.name === "manifest.json"
)
if (unsafe.length > 0) {
  console.error(
    `✗ unsafe object names: ${unsafe.map((o) => JSON.stringify(o.name)).join(", ")}`
  )
  process.exit(1)
}

const todo = mediaToDownload(objects, previous, (name) =>
  existsSync(join(mediaDir, name))
)

let bytes = 0
const failed = []
for (const object of todo) {
  const target = join(mediaDir, object.name)
  let response
  try {
    response = await fetch(
      publicObjectUrl(supabaseUrl, "media-public", object.name)
    )
  } catch {
    failed.push(`${object.name}: network`)
    continue
  }
  if (!response.ok) {
    failed.push(`${object.name}: HTTP ${response.status}`)
    continue
  }
  const body = Buffer.from(await response.arrayBuffer())
  mkdirSync(dirname(target), { recursive: true })
  // Written next to the target and renamed, so a cut run leaves no half file.
  writeFileSync(`${target}.part`, body)
  renameSync(`${target}.part`, target)
  bytes += body.length
  console.log(`+ ${object.name} (${body.length} bytes)`)
}

if (failed.length > 0) {
  for (const f of failed) console.error(`✗ ${f}`)
  console.error(`✗ ${failed.length} images were not downloaded`)
  process.exit(1)
}

mkdirSync(mediaDir, { recursive: true })
writeFileSync(manifestPath, `${JSON.stringify(objects, null, 2)}\n`)
console.log(
  `media-public: ${objects.length} objects, ${todo.length} downloaded (${bytes} bytes), ${objects.length - todo.length} already kept`
)
