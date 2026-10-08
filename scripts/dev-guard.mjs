// Pure guards shared by the dev scripts (story 5.18): the DEV project check
// and the --email argument of a demo customer. No env, no network; tested in
// test/dev-guard.test.ts.

export const DEMO_DOMAIN = "demo.example.com"

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
 * --email <x@demo.example.com> or --email=<x@demo.example.com>.
 * Returns { email: null } when absent, { email } for a demo customer, or
 * { error } (Hebrew) otherwise.
 *
 * @param {string[]} argv
 * @returns {{ email: string | null, error?: undefined } | { error: string, email?: undefined }}
 */
export function parseEmail(argv) {
  const index = argv.findIndex(
    (arg) => arg === "--email" || arg.startsWith("--email=")
  )
  if (index < 0) return { email: null }
  if (argv.includes("--admin")) return { error: "--email ו---admin לא באים יחד" }
  const raw = argv[index].startsWith("--email=")
    ? argv[index].slice("--email=".length)
    : argv[index + 1]
  const email = (raw ?? "").trim().toLowerCase()
  const [local, domain, ...rest] = email.split("@")
  if (rest.length > 0 || !/^[a-z0-9._-]+$/.test(local) || domain !== DEMO_DOMAIN) {
    return { error: `--email מקבל רק מייל של לקוחת הדגמה (@${DEMO_DOMAIN})` }
  }
  return { email }
}
