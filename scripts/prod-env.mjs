// Story 6.1: the one guard and connection helper of every prod script
// (prod-migrate, prod-copy-content, prod-admin, prod-check,
// prod-auth-guard-check, prod-grants).
//
// Production values come only from .env.prod.local (git-ignored by `.env*`;
// Next.js never loads this name), read into a plain object: never from
// process.env, and never from .env.local. Before anything connects:
//   - .env.prod.local exists and holds PROD_SUPABASE_URL,
//     PROD_SUPABASE_PUBLISHABLE_KEY, PROD_SUPABASE_SECRET_KEY and
//     PROD_DATABASE_URL (session pooler, port 5432);
//   - the pooler user / host of PROD_DATABASE_URL carries the ref of
//     PROD_SUPABASE_URL;
//   - that ref differs from the dev ref (NEXT_PUBLIC_SUPABASE_URL in
//     .env.local).
// An optional fifth variable, PROD_CRON_SECRET (the same value as Vercel's
// CRON_SECRET and Vault's cron_secret), lets prod-check prove the push
// chain; nothing else reads it.
// No message here ever holds a secret, a connection string, a token or an
// email. The pure helpers are tested in test/prod-env.test.ts.

import { existsSync, readFileSync } from "node:fs"
import { parseEnv } from "node:util"

import { createClient } from "@supabase/supabase-js"
import pg from "pg"

import { devRef } from "./dev-guard.mjs"

export const PROD_ENV_FILE = ".env.prod.local"
export const DEV_ENV_FILE = ".env.local"

// The production origin (Vercel). Vault app_url, Auth Site URL and the
// links prod-admin prints use it until the domain (handover, id 10).
export const PROD_SITE_URL = "https://brunch-at-tals.vercel.app"

export const PROD_KEYS = [
  "PROD_SUPABASE_URL",
  "PROD_SUPABASE_PUBLISHABLE_KEY",
  "PROD_SUPABASE_SECRET_KEY",
  "PROD_DATABASE_URL",
]

export const PAUSED_MESSAGE = "הפרויקט מושהה או לא זמין: Dashboard ← Restore"

export const NOT_FOUND_MESSAGE =
  "ה-pooler לא מצא את הפרויקט: בודקים ב-PROD_DATABASE_URL את מחרוזת ה-Session pooler, את ה-ref (postgres.<ref>) ואת האזור (aws-…-<region>). אם הכול נכון, ייתכן שהפרויקט מושהה: Dashboard ← Restore"

/**
 * The 20-character ref of a hosted Supabase URL, or null.
 *
 * @param {string | undefined} supabaseUrl
 * @returns {string | null}
 */
export function projectRef(supabaseUrl) {
  try {
    return (
      /^([a-z0-9]{20})[.]supabase[.]co$/.exec(
        new URL(supabaseUrl ?? "").hostname
      )?.[1] ?? null
    )
  } catch {
    return null
  }
}

/**
 * The prod ref when PROD_DATABASE_URL's pooler user (postgres.<ref>) or
 * direct host (db.<ref>.supabase.co) carries the ref of PROD_SUPABASE_URL;
 * otherwise null. The same rule as devRef.
 *
 * @param {{ supabaseUrl?: string, databaseUrl?: string }} env
 * @returns {string | null}
 */
export function prodRef(env) {
  return devRef(env)
}

/**
 * Throws (a message without any value) unless both refs exist and differ.
 *
 * @param {string | null | undefined} prod
 * @param {string | null | undefined} dev
 */
export function assertDistinctProjects(prod, dev) {
  if (!prod) {
    throw new Error("PROD_DATABASE_URL לא מכיל את ה-ref של PROD_SUPABASE_URL.")
  }
  if (!dev) {
    throw new Error(
      "אין ב-.env.local כתובת NEXT_PUBLIC_SUPABASE_URL של פרויקט הפיתוח, ולכן אי אפשר לוודא שהפרודקשן הוא פרויקט אחר."
    )
  }
  if (prod === dev) {
    throw new Error(
      "הערכים ב-.env.prod.local מצביעים על פרויקט הפיתוח. הסקריפט רץ רק מול פרויקט הפרודקשן."
    )
  }
}

/**
 * Checks the prod variables (and the dev ref) without connecting.
 * Returns { ok: true, ref } or { ok: false, error } (Hebrew, no value).
 *
 * @param {Record<string, string | undefined> | null} prod the parsed .env.prod.local
 * @param {Record<string, string | undefined> | null} dev the parsed .env.local
 * @returns {{ ok: true, ref: string } | { ok: false, error: string }}
 */
export function checkProdEnv(prod, dev) {
  if (!prod) {
    return {
      ok: false,
      error: `חסר הקובץ ${PROD_ENV_FILE} בתיקיית הפרויקט. יוצרים אותו לפי ה-README (פרק "פרודקשן").`,
    }
  }
  const missing = PROD_KEYS.filter((key) => !(prod[key] ?? "").trim())
  if (missing.length > 0) {
    return {
      ok: false,
      error: `חסרים ב-${PROD_ENV_FILE}: ${missing.join(", ")}`,
    }
  }
  if (!projectRef(prod.PROD_SUPABASE_URL)) {
    return {
      ok: false,
      error:
        "PROD_SUPABASE_URL אינה כתובת של פרויקט Supabase (https://<ref>.supabase.co).",
    }
  }
  if (!["", "/"].includes(new URL(prod.PROD_SUPABASE_URL).pathname)) {
    return {
      ok: false,
      error:
        "PROD_SUPABASE_URL צריכה להסתיים ב-.supabase.co, בלי המשך (למשל בלי /rest/v1/).",
    }
  }
  let parsed
  try {
    parsed = new URL(prod.PROD_DATABASE_URL ?? "")
  } catch {
    return {
      ok: false,
      error:
        "PROD_DATABASE_URL אינה כתובת תקינה. תווים מיוחדים בסיסמה מקודדים (למשל @ כ-%40).",
    }
  }
  if (parsed.port === "6543") {
    return {
      ok: false,
      error:
        "PROD_DATABASE_URL היא של ה-Transaction pooler (6543). צריך את ה-Session pooler (5432).",
    }
  }
  const ref = prodRef({
    supabaseUrl: prod.PROD_SUPABASE_URL,
    databaseUrl: prod.PROD_DATABASE_URL,
  })
  try {
    assertDistinctProjects(ref, projectRef(dev?.NEXT_PUBLIC_SUPABASE_URL))
  } catch (error) {
    return { ok: false, error: /** @type {Error} */ (error).message }
  }
  return { ok: true, ref: /** @type {string} */ (ref) }
}

/**
 * A pg error on connect -> a Hebrew message without host, user or password.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function connectionErrorMessage(error) {
  const { code, message } = /** @type {{ code?: string, message?: string }} */ (
    error ?? {}
  )
  if (
    code === "28P01" ||
    /password authentication failed/i.test(message ?? "")
  ) {
    return "הסיסמה ב-PROD_DATABASE_URL לא התקבלה (סיסמת המסד של פרויקט הפרודקשן)."
  }
  if (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    /tenant or user not found/i.test(message ?? "")
  ) {
    return NOT_FOUND_MESSAGE
  }
  // Timeouts, ECONNREFUSED, a reset connection.
  return PAUSED_MESSAGE
}

/**
 * Replaces each secret (and its percent-decoded form) in text by "***".
 *
 * @param {string} text
 * @param {Array<string | undefined>} secrets
 * @returns {string}
 */
export function redact(text, secrets) {
  let out = String(text)
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue
    const forms = new Set([secret])
    try {
      forms.add(decodeURIComponent(secret))
    } catch {
      // not percent-encoded
    }
    for (const form of forms) out = out.split(form).join("***")
  }
  return out
}

/** The secret parts of a database URL (whole string, password, user). */
export function databaseUrlSecrets(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl)
    return [databaseUrl, parsed.password, parsed.username, parsed.hostname]
  } catch {
    return [databaseUrl]
  }
}

// ---------------------------------------------------------------------------
// I/O (not tested: reads files, connects)
// ---------------------------------------------------------------------------

/** @param {string} message */
export function fail(message) {
  console.error(message)
  process.exit(1)
}

/** The parsed file, or null when it does not exist. Never touches process.env. */
export function readEnvFile(path) {
  if (!existsSync(path)) return null
  return parseEnv(readFileSync(path, "utf8"))
}

/**
 * Reads and checks .env.prod.local and the dev ref; stops (exit 1) with a
 * Hebrew message before any connection.
 */
export function loadProdConfig() {
  const prod = readEnvFile(PROD_ENV_FILE)
  const dev = readEnvFile(DEV_ENV_FILE)
  const checked = checkProdEnv(prod, dev)
  if (!checked.ok) fail(checked.error)
  return {
    ref: checked.ref,
    supabaseUrl: prod.PROD_SUPABASE_URL.trim(),
    publishableKey: prod.PROD_SUPABASE_PUBLISHABLE_KEY.trim(),
    secretKey: prod.PROD_SUPABASE_SECRET_KEY.trim(),
    databaseUrl: prod.PROD_DATABASE_URL.trim(),
    cronSecret: (prod.PROD_CRON_SECRET ?? "").trim() || null,
    dev,
  }
}

/**
 * The dev side (the copy's source, the check's comparison), from the same
 * parsed .env.local: DEV_DATABASE_URL must carry the dev ref (dev-guard).
 */
export function loadDevConfig(dev) {
  const supabaseUrl = dev?.NEXT_PUBLIC_SUPABASE_URL
  const databaseUrl = dev?.DEV_DATABASE_URL
  if (!devRef({ supabaseUrl, databaseUrl })) {
    fail(
      "DEV_DATABASE_URL ב-.env.local חייב להכיל את ה-ref של NEXT_PUBLIC_SUPABASE_URL (פרויקט הפיתוח)."
    )
  }
  return { supabaseUrl, databaseUrl, secretKey: dev?.SUPABASE_SECRET_KEY }
}

function connectionConfig(databaseUrl) {
  const parsed = new URL(databaseUrl)
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) {
    parsed.searchParams.delete(key)
  }
  // TLS without certificate verification, like the dev scripts: the pooler's
  // certificate is signed by Supabase's own CA (deferred-work: one verifying
  // helper for every script).
  return {
    connectionString: parsed.toString(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
  }
}

/**
 * A connected pg client, or exit 1 with the paused / wrong-password message.
 * readOnly: the session is `default_transaction_read_only`.
 *
 * @param {string} databaseUrl
 * @param {{ readOnly?: boolean, label?: string }} [options]
 */
export async function connect(
  databaseUrl,
  { readOnly = false, label = "" } = {}
) {
  const client = new pg.Client(connectionConfig(databaseUrl))
  // An idle client dropped by the pooler must not crash the script.
  client.on("error", () => {})
  try {
    await client.connect()
    // UTC, so timestamps read from dev and prod compare as equal text.
    await client.query("set statement_timeout = '120s'; set timezone = 'UTC'")
    if (readOnly) await client.query("set default_transaction_read_only = on")
  } catch (error) {
    await client.end().catch(() => {})
    fail(
      label
        ? `${label}: ${connectionErrorMessage(error)}`
        : connectionErrorMessage(error)
    )
  }
  return client
}

/** A service-role Supabase client (Auth Admin, Storage); no session. */
export function serviceClient(url, secretKey) {
  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

/** A publishable-key client (a user's own requests); no stored session. */
export function publicClient(url, publishableKey) {
  return createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
