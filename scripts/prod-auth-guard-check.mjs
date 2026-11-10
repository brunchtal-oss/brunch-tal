// Story 6.1 (deferred-work, item (ג)): the auth.users guard
// (private.guard_auth_user_change, trigger guard_identity_change) against
// the real Supabase Auth of the PRODUCTION project.
//
//   node scripts/prod-auth-guard-check.mjs          # dry run: the plan only
//   node scripts/prod-auth-guard-check.mjs --apply  # only after the user's OK
//
// --apply creates a throwaway Auth user (random address on example.com,
// random password, never printed), signs in as her with the publishable
// key and checks that:
//   1. her own email change (auth.updateUser) is refused;
//   2. her own phone change is refused;
//   3. an admin email change without the email_change_pending state
//      (Auth Admin API, the secret key) is refused;
//   4. her email and phone are unchanged afterwards;
// then deletes the user (also when a step fails). One line per step,
// ✓ / ✗; exit 1 when any is ✗.

import { randomBytes } from "node:crypto"

import { fail, loadProdConfig, publicClient, serviceClient } from "./prod-env.mjs"

const apply = process.argv.includes("--apply")
const config = loadProdConfig()

const STEPS = [
  "משתמשת זמנית נוצרת (example.com, סיסמה אקראית)",
  "שינוי מייל עצמי נחסם",
  "שינוי טלפון עצמי נחסם",
  "שינוי מייל באדמין בלי email_change_pending נחסם",
  "המייל והטלפון לא השתנו",
  "המשתמשת הזמנית נמחקת",
]

let failed = 0
function line(ok, text, detail = "") {
  if (!ok) failed += 1
  console.log(`${ok ? "✓" : "✗"} ${text}${detail ? ` (${detail})` : ""}`)
}

const code = (error) => error?.code ?? error?.status ?? "?"

// A step counts only when the trigger refused it: GoTrue turns the raised
// ACCOUNT_CHANGE_BLOCKED into a database error (status 500, "Database
// error ..."). Any other error (phone provider off, SMTP refusing the
// address, a rate limit) proves nothing about the trigger.
function isTriggerRefusal(error) {
  return Boolean(
    error && (error.status === 500 || /database error/i.test(error.message ?? ""))
  )
}

// ✓ for the trigger's refusal; "לא הוכח" (and a failed run) for any other
// error; ✗ when the change was accepted.
function refused(text, error) {
  if (!error) return line(false, text, "התקבל")
  if (isTriggerRefusal(error)) return line(true, text, String(code(error)))
  failed += 1
  console.log(`? ${text}: לא הוכח (${code(error)}, לא שגיאת מסד של ה-trigger)`)
}

async function main() {
  if (!apply) {
    console.log("הרצה יבשה. עם --apply (רק אחרי אישור המשתמשת):")
    for (const step of STEPS) console.log(`  - ${step}`)
    return
  }

  const admin = serviceClient(config.supabaseUrl, config.secretKey)
  const tag = randomBytes(6).toString("hex")
  const email = `guard-check-${tag}@example.com`
  const password = randomBytes(24).toString("base64url")

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createError || !created?.user) {
    fail(`✗ ${STEPS[0]} (${code(createError)})`)
  }
  const userId = created.user.id
  line(true, STEPS[0])

  try {
    const user = publicClient(config.supabaseUrl, config.publishableKey)
    const { error: signInError } = await user.auth.signInWithPassword({ email, password })
    if (signInError) {
      line(false, "התחברות כמשתמשת הזמנית", String(code(signInError)))
    } else {
      const selfEmail = await user.auth.updateUser({ email: `guard-check-${tag}-new@example.com` })
      refused(STEPS[1], selfEmail.error)
      const selfPhone = await user.auth.updateUser({ phone: "+972500000000" })
      refused(STEPS[2], selfPhone.error)
      await user.auth.signOut().catch(() => {})
    }

    const adminEmail = await admin.auth.admin.updateUserById(userId, {
      email: `guard-check-${tag}-admin@example.com`,
    })
    refused(STEPS[3], adminEmail.error)

    const { data: after, error: readError } = await admin.auth.admin.getUserById(userId)
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

  console.log(failed === 0 ? "\nה-guard פועל בפרודקשן." : `\n${failed} בדיקות נכשלו.`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`prod-auth-guard-check נכשל: ${error.message}`)
  process.exit(1)
})
