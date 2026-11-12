// The shared runner of the auth.users guard check (story 6.1 (ג), story
// 6.11): private.guard_auth_user_change (trigger guard_identity_change)
// against the real Supabase Auth of one project. Called by
// scripts/prod-auth-guard-check.mjs and scripts/dev-auth-guard-check.mjs,
// which load their own project's keys.
//
// MX REQUIRED: the throwaway address must be on a domain that has MX
// records, or Auth refuses it (email_address_invalid) before the database
// and the self email change is "לא הוכח". The default is the business
// domain; check its MX (nslookup -type=MX <domain>) before every run, and
// pass --domain <d> for another domain with MX.
//
// With apply it creates a throwaway Auth user (a random address on that
// domain; random password, never printed), signs in as her
// with the publishable key and checks that:
//   1. her own email change (auth.updateUser) is refused;
//   2. her own phone change is refused;
//   3. an admin email change without the email_change_pending state
//      (Auth Admin API, the secret key) is refused;
//   4. her email and phone are unchanged afterwards;
// then deletes the user (also when a step fails). No email is sent: the
// user is created confirmed and Confirm email is off, so Auth changes the
// address directly (and the trigger refuses it). One line per step,
// ✓ / ✗; exit code 1 when any is ✗ or not proven.

import { randomBytes } from "node:crypto"

// The default domain: the business domain. Not the send. subdomain, which
// is a CNAME to Resend and may have no MX. Its MX is checked before a run.
export const DEFAULT_DOMAIN = "morethanfood.co.il"

export const STEPS = [
  "משתמשת זמנית נוצרת (כתובת אקראית, סיסמה אקראית)",
  "שינוי מייל עצמי נחסם",
  "שינוי טלפון עצמי נחסם",
  "שינוי מייל באדמין בלי email_change_pending נחסם",
  "המייל והטלפון לא השתנו",
  "המשתמשת הזמנית נמחקת",
]

/**
 * --domain <d> or --domain=<d>; the default otherwise. Returns { domain }
 * or { error } (Hebrew).
 *
 * @param {string[]} argv
 * @returns {{ domain: string } | { error: string }}
 */
export function parseDomain(argv) {
  const index = argv.findIndex(
    (arg) => arg === "--domain" || arg.startsWith("--domain=")
  )
  if (index < 0) return { domain: DEFAULT_DOMAIN }
  const value = argv[index].startsWith("--domain=")
    ? argv[index].slice("--domain=".length)
    : argv[index + 1]
  const domain = (value ?? "").trim().toLowerCase()
  if (!/^(?=.{3,200}$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)) {
    return {
      error:
        "--domain צריך להיות שם דומיין עם רשומת MX (למשל morethanfood.co.il).",
    }
  }
  return { domain }
}

const code = (error) => error?.code ?? error?.status ?? "?"

// A step counts only when the trigger refused it: GoTrue turns the raised
// ACCOUNT_CHANGE_BLOCKED into a database error (status 500, "Database
// error ..."). Any other error (phone provider off, the address refused,
// a rate limit) proves nothing about the trigger.
export function isTriggerRefusal(error) {
  return Boolean(
    error &&
    (error.status === 500 || /database error/i.test(error.message ?? ""))
  )
}

/**
 * @param {{
 *   label: string,
 *   apply: boolean,
 *   domain: string,
 *   admin: import("@supabase/supabase-js").SupabaseClient,
 *   newUserClient: () => import("@supabase/supabase-js").SupabaseClient,
 *   log?: (line: string) => void,
 * }} options
 * @returns {Promise<number>} the number of failed or unproven steps
 */
export async function runAuthGuardCheck({
  label,
  apply,
  domain,
  admin,
  newUserClient,
  log = console.log,
}) {
  if (!apply) {
    log(`הרצה יבשה (${label}). הדומיין של הכתובת הזמנית: ${domain}`)
    log(`  לפני --apply בודקים שיש לו MX: nslookup -type=MX ${domain}`)
    log("עם --apply (רק אחרי אישור המשתמשת):")
    for (const step of STEPS) log(`  - ${step}`)
    return 0
  }

  let failed = 0
  const line = (ok, text, detail = "") => {
    if (!ok) failed += 1
    log(`${ok ? "✓" : "✗"} ${text}${detail ? ` (${detail})` : ""}`)
  }
  // ✓ for the trigger's refusal; "לא הוכח" (a failed run) for any other
  // error; ✗ when the change was accepted.
  const refused = (text, error) => {
    if (!error) return line(false, text, "התקבל")
    if (isTriggerRefusal(error)) return line(true, text, String(code(error)))
    failed += 1
    log(`? ${text}: לא הוכח (${code(error)}, לא שגיאת מסד של ה-trigger)`)
  }

  const tag = randomBytes(6).toString("hex")
  const email = `guard-check-${tag}@${domain}`
  const password = randomBytes(24).toString("base64url")

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
  if (createError || !created?.user) {
    line(false, STEPS[0], String(code(createError)))
    return failed
  }
  const userId = created.user.id
  line(true, STEPS[0])

  try {
    const user = newUserClient()
    const { error: signInError } = await user.auth.signInWithPassword({
      email,
      password,
    })
    if (signInError) {
      line(false, "התחברות כמשתמשת הזמנית", String(code(signInError)))
    } else {
      const selfEmail = await user.auth.updateUser({
        email: `guard-check-${tag}-new@${domain}`,
      })
      refused(STEPS[1], selfEmail.error)
      const selfPhone = await user.auth.updateUser({ phone: "+972500000000" })
      refused(STEPS[2], selfPhone.error)
      await user.auth.signOut().catch(() => {})
    }

    const adminEmail = await admin.auth.admin.updateUserById(userId, {
      email: `guard-check-${tag}-admin@${domain}`,
    })
    refused(STEPS[3], adminEmail.error)

    const { data: after, error: readError } =
      await admin.auth.admin.getUserById(userId)
    line(
      !readError &&
        after?.user?.email === email &&
        !after?.user?.phone &&
        !after?.user?.new_email &&
        !after?.user?.new_phone,
      STEPS[4]
    )
  } finally {
    const { error } = await admin.auth.admin.deleteUser(userId)
    line(!error, STEPS[5], error ? String(code(error)) : "")
  }

  log(
    failed === 0
      ? `\nה-guard פועל (${label}).`
      : `\n${failed} בדיקות נכשלו או לא הוכחו.`
  )
  return failed
}
