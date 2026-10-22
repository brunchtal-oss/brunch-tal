// Pure guards shared by the dev scripts (stories 5.18, 5.22): the DEV project
// check and the --email argument of a filming persona. No env, no network;
// tested in test/dev-guard.test.ts.

// The old demo domain (story 5.18); its scripts go with story 5.22 (D7).
export const DEMO_DOMAIN = "demo.example.com"

// The fictional world of the explainer videos (story 5.22): every Auth user
// on this domain, the filming admin included, belongs to it.
export const VIDEO_DOMAIN = "video.example.com"

/**
 * True for an email on the video domain (exactly, case-insensitive).
 *
 * @param {unknown} email
 * @returns {boolean}
 */
export function isVideoEmail(email) {
  if (typeof email !== "string") return false
  const parts = email.trim().toLowerCase().split("@")
  return (
    parts.length === 2 &&
    /^[a-z0-9._-]+$/.test(parts[0]) &&
    parts[1] === VIDEO_DOMAIN
  )
}

/**
 * The project ref when DEV_DATABASE_URL points at the same project as
 * NEXT_PUBLIC_SUPABASE_URL (the same check as supabase/tests/support/db.ts);
 * otherwise null.
 *
 * @param {{ supabaseUrl?: string, databaseUrl?: string }} env
 * @returns {string | null}
 */
export function devRef({ supabaseUrl, databaseUrl }) {
  let ref
  try {
    ref = /^([a-z0-9]{20})[.]supabase[.]co$/.exec(
      new URL(supabaseUrl ?? "").hostname
    )?.[1]
  } catch {
    ref = undefined
  }
  if (!ref || !databaseUrl) return null
  let parsed
  try {
    parsed = new URL(databaseUrl)
  } catch {
    return null
  }
  const matches =
    parsed.username === `postgres.${ref}` ||
    parsed.hostname === `db.${ref}.supabase.co`
  return matches ? ref : null
}

/**
 * --email <x@video.example.com> or --email=<x@video.example.com>.
 * Returns { email: null } when absent, { email } for a filming persona, or
 * { error } (Hebrew) otherwise. `refused` lists emails it never accepts (the
 * filming logins, whose password is VIDEO_LOGIN_PASSWORD).
 *
 * @param {string[]} argv
 * @param {string[]} [refused]
 * @returns {{ email: string | null, error?: undefined } | { error: string, email?: undefined }}
 */
export function parseEmail(argv, refused = []) {
  const index = argv.findIndex(
    (arg) => arg === "--email" || arg.startsWith("--email=")
  )
  if (index < 0) return { email: null }
  if (argv.includes("--admin")) return { error: "--email ו---admin לא באים יחד" }
  const raw = argv[index].startsWith("--email=")
    ? argv[index].slice("--email=".length)
    : argv[index + 1]
  const email = (raw ?? "").trim().toLowerCase()
  if (!isVideoEmail(email)) {
    return { error: `--email מקבל רק מייל של דמות מהסרטונים (@${VIDEO_DOMAIN})` }
  }
  if (refused.map((e) => e.toLowerCase()).includes(email)) {
    return {
      error:
        "זו כניסת צילום, והסיסמה שלה היא VIDEO_LOGIN_PASSWORD. קישור איפוס היה מחליף אותה, ולכן הוא לא מופק.",
    }
  }
  return { email }
}
