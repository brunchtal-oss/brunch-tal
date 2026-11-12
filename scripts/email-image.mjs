// Story 6.11 (user decision 2026-11-12): the image at the top of the system
// emails. One small JPEG (about 1120x520, under 200 KB; a crop of the home
// hero made outside the repo) goes to the public bucket media-public at
// email/header.jpg (the script uploads it), and Vault email_image_url holds
// its public URL (the script prints the SQL Editor line and the user runs
// it: the script's database role may not write Vault, 42501 on dev);
// private.email_html reads that value at send time and leaves the image
// out when it is missing. The file itself never enters the repo: the
// scripts take --file <path>.
//
// Shared by dev-email-image.mjs and prod-email-image.mjs. The pure helpers
// are tested in test/email-image.test.ts. No message prints a key, a
// connection string or the Vault value's secret parts (the URL is public).

import { existsSync, readFileSync, statSync } from "node:fs"

export const EMAIL_IMAGE_BUCKET = "media-public"
export const EMAIL_IMAGE_PATH = "email/header.jpg"
export const EMAIL_IMAGE_SECRET = "email_image_url"
export const MAX_EMAIL_IMAGE_BYTES = 200 * 1024

/**
 * The public URL of the email image on a project.
 *
 * @param {string} supabaseUrl
 * @returns {string}
 */
export function emailImageUrl(supabaseUrl) {
  const base = String(supabaseUrl ?? "").replace(/\/+$/, "")
  return `${base}/storage/v1/object/public/${EMAIL_IMAGE_BUCKET}/${EMAIL_IMAGE_PATH}`
}

/**
 * The value after --file, or null.
 *
 * @param {string[]} argv
 * @returns {string | null}
 */
export function fileArg(argv) {
  const at = argv.indexOf("--file")
  const value = at >= 0 ? argv[at + 1] : undefined
  return value && !value.startsWith("--") ? value : null
}

/**
 * Checks the file's bytes: a JPEG (FF D8 FF), not empty, at most 200 KB.
 * Returns { ok: true } or { ok: false, error } (Hebrew).
 *
 * @param {Uint8Array} bytes
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function checkImageBytes(bytes) {
  if (!bytes || bytes.length === 0) {
    return { ok: false, error: "הקובץ ריק." }
  }
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
    return { ok: false, error: "הקובץ אינו JPEG." }
  }
  if (bytes.length > MAX_EMAIL_IMAGE_BYTES) {
    return {
      ok: false,
      error: `הקובץ גדול מדי למייל (${Math.round(bytes.length / 1024)}KB; עד 200KB).`,
    }
  }
  return { ok: true }
}

/**
 * Reads --file and checks it; exits 1 with a Hebrew message when wrong.
 *
 * @param {string[]} argv
 * @returns {{ path: string, bytes: Buffer }}
 */
export function readImageArg(argv) {
  const path = fileArg(argv)
  if (!path) {
    console.error("חסר --file <נתיב לקובץ ה-JPEG הקטן> (הקובץ לא נשמר ב-repo).")
    process.exit(1)
  }
  if (!existsSync(path) || !statSync(path).isFile()) {
    console.error("הקובץ לא נמצא.")
    process.exit(1)
  }
  const bytes = readFileSync(path)
  const checked = checkImageBytes(bytes)
  if (!checked.ok) {
    console.error(checked.error)
    process.exit(1)
  }
  return { path, bytes }
}

/**
 * Whether the bucket exists and is public. Never throws.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} service
 * @returns {Promise<"public" | "private" | "missing">}
 */
export async function bucketState(service) {
  const { data, error } = await service.storage.getBucket(EMAIL_IMAGE_BUCKET)
  if (error || !data) return "missing"
  return data.public ? "public" : "private"
}

/**
 * The one SQL Editor line that sets Vault email_image_url (the URL is
 * public, not a secret). The script's database role has no Vault write
 * privilege (42501 on dev, 2026-11-12), so the user runs it, as with
 * site_url.
 *
 * @param {string} url
 * @param {boolean} exists whether the secret already exists
 * @returns {string}
 */
export function vaultLine(url, exists) {
  const value = String(url).replaceAll("'", "''")
  return exists
    ? `select vault.update_secret((select id from vault.secrets where name = '${EMAIL_IMAGE_SECRET}'), '${value}');`
    : `select vault.create_secret('${value}', '${EMAIL_IMAGE_SECRET}');`
}

/**
 * Whether Vault already holds email_image_url (a read, as prod-check does);
 * null when the role may not read it either.
 *
 * @param {import("pg").Client} db
 * @returns {Promise<boolean | null>}
 */
export async function vaultHasImage(db) {
  try {
    const { rows } = await db.query(
      "select exists (select 1 from vault.secrets where name = $1) as has",
      [EMAIL_IMAGE_SECRET]
    )
    return rows[0]?.has === true
  } catch {
    return null
  }
}

/**
 * The SQL Editor instruction lines (Hebrew lead + the line(s)).
 *
 * @param {string} url
 * @param {boolean | null} exists
 * @returns {string[]}
 */
export function vaultInstructions(url, exists) {
  const lead =
    "שלב אחרון, ב-SQL Editor של אותו פרויקט (שאילתה חדשה וריקה; זו כתובת ציבורית, לא סוד):"
  if (exists === null) {
    return [
      lead,
      "אם email_image_url עוד לא קיים ב-Vault:",
      vaultLine(url, false),
      "אם הוא כבר קיים:",
      vaultLine(url, true),
    ]
  }
  return [lead, vaultLine(url, exists)]
}

/**
 * Uploads the image (upsert), then reads the URL back over HTTP. Returns
 * the URL. Vault is set by the user (vaultLine).
 *
 * @param {{ service: import("@supabase/supabase-js").SupabaseClient,
 *   supabaseUrl: string, bytes: Buffer }} args
 */
export async function uploadEmailImage({ service, supabaseUrl, bytes }) {
  const { error: uploadError } = await service.storage
    .from(EMAIL_IMAGE_BUCKET)
    .upload(EMAIL_IMAGE_PATH, bytes, {
      upsert: true,
      contentType: "image/jpeg",
      cacheControl: "3600",
    })
  if (uploadError) {
    throw new Error(`ההעלאה נכשלה (${uploadError.message ?? "שגיאה"}).`)
  }

  const url = emailImageUrl(supabaseUrl)
  const response = await fetch(url, { method: "HEAD" })
  if (!response.ok) {
    throw new Error(
      `הקובץ הועלה אבל הכתובת הציבורית מחזירה ${response.status}.`
    )
  }
  return url
}
