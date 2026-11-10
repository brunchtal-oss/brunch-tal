// Story 6.1: a real admin on the PRODUCTION project (Tal's, the user's).
//
//   node scripts/prod-admin.mjs --email <email> --name "<full name>"
//                                       # dry run: says whether the Auth user
//                                       # exists; writes nothing
//   node scripts/prod-admin.mjs --email <email> --name "<full name>" --apply
//                                       # only after the user's OK
//   --name-file <path> instead of --name: the first line of a UTF-8 text
//   file (a Hebrew name passed through PowerShell or Bash may be garbled;
//   write the file with an editor). The stored name's length is printed
//   before anything is written.
//
// --apply: finds or creates the Auth user (email confirmed, no password),
// sets user_metadata.full_name (the admin home's greeting), adds the
// admin_roles row, and prints one production /reset/<token> link (48 hours;
// a rerun reuses the user and revokes the previous link). It refuses a user
// who already has a customer profile (a customer never silently becomes an
// admin). The admin chooses
// her own password through the link; nobody else ever sees it.
//
// The email comes from the user in the chat and is passed only on the
// command line: it is never written to a file and never printed. The
// output is "created" / "exists" and the link.

import { existsSync, readFileSync } from "node:fs"

import { fail, loadProdConfig, PROD_SITE_URL, serviceClient } from "./prod-env.mjs"

function argValue(argv, name) {
  const index = argv.findIndex((arg) => arg === name || arg.startsWith(`${name}=`))
  if (index < 0) return null
  const raw = argv[index].startsWith(`${name}=`)
    ? argv[index].slice(name.length + 1)
    : argv[index + 1]
  return (raw ?? "").trim() || null
}

const argv = process.argv.slice(2)
const apply = argv.includes("--apply")
const email = argValue(argv, "--email")?.toLowerCase() ?? null
const nameFile = argValue(argv, "--name-file")
if (nameFile && argValue(argv, "--name")) fail("--name ו---name-file לא באים יחד.")
if (nameFile && !existsSync(nameFile)) fail("הקובץ של --name-file לא נמצא.")
// trim() also drops a BOM and the carriage return of a Windows line end.
const name = nameFile
  ? readFileSync(nameFile, "utf8").split(String.fromCharCode(10))[0].trim() || null
  : argValue(argv, "--name")

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.startsWith("--")) {
  fail('צריך --email <מייל> תקין (למשל node scripts/prod-admin.mjs --email <מייל> --name "<שם>").')
}
if (!name || name.startsWith("--") || name.length > 100) {
  fail(
    'צריך --name "<שם מלא>" או --name-file <קובץ> (עד 100 תווים): השם שמופיע בברכה בבית האדמין.'
  )
}
if (name.includes(String.fromCharCode(0xfffd)) || /^[?]+$/.test(name)) {
  fail("השם הגיע משובש (סימני שאלה או תו לא חוקי). כותבים אותו לקובץ ומעבירים --name-file.")
}
if (email.endsWith("@example.com") || email.endsWith("@video.example.com")) {
  fail("מייל בדוי לא נכנס לפרודקשן.")
}

const config = loadProdConfig()
const supabase = serviceClient(config.supabaseUrl, config.secretKey)

async function findUserByEmail(target) {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) fail(`קריאת המשתמשים נכשלה (${error.code ?? error.status}). אם הפרויקט מושהה: Dashboard ← Restore`)
    const user = data.users.find((u) => u.email?.toLowerCase() === target)
    if (user) return user
    if (data.users.length < 1000) return null
  }
}

async function hasProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle()
  if (error) fail(`קריאת הפרופיל נכשלה (${error.code}).`)
  return Boolean(data)
}

async function main() {
  console.log(`השם שיישמר: ${[...name].length} תווים.`)
  const existing = await findUserByEmail(email)
  if (existing && (await hasProfile(existing.id))) {
    fail("למשתמשת הזו יש פרופיל של לקוחה. לקוחה לא הופכת לאדמין בסקריפט הזה.")
  }
  if (!apply) {
    console.log(
      existing
        ? "הרצה יבשה: המשתמשת קיימת. עם --apply יתווסף תפקיד האדמין (אם חסר), יעודכן השם ויודפס קישור חדש."
        : "הרצה יבשה: המשתמשת לא קיימת. עם --apply תיווצר (בלי סיסמה, מייל מאושר), תקבל תפקיד אדמין ויודפס קישור."
    )
    return
  }

  let user = existing
  let created = false
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: name },
    })
    if (error) {
      if (error.code === "email_exists") user = await findUserByEmail(email)
      if (!user) fail(`יצירת המשתמשת נכשלה (${error.code ?? error.status}).`)
    } else {
      user = data.user
      created = true
    }
  }

  if (user.user_metadata?.full_name !== name) {
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      user_metadata: { ...(user.user_metadata ?? {}), full_name: name },
    })
    if (error) fail(`עדכון השם נכשל (${error.code ?? error.status}).`)
  }

  const { error: roleError } = await supabase
    .from("admin_roles")
    .upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true })
  if (roleError) fail(`הוספת תפקיד האדמין נכשלה (${roleError.code}).`)

  const { data, error } = await supabase.rpc("issue_reset_token", { p_user_id: user.id })
  if (error || !data?.token) fail(`הפקת הקישור נכשלה (${error?.code ?? "no token"}).`)

  console.log(created ? "האדמין נוצרה עכשיו." : "האדמין קיימת (קישור קודם בוטל).")
  console.log("תוקף הקישור: 48 שעות. בוחרים בו סיסמה, ואז נכנסים ב-/admin/login.")
  console.log(`${PROD_SITE_URL}/reset/${data.token}`)
}

main().catch((error) => {
  console.error(`prod-admin נכשל: ${error.message}`)
  process.exit(1)
})
