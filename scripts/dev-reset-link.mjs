// Dev only (story 1.1 tracer): creates or finds a fictitious customer (or,
// with --admin, a fictitious admin) on the DEV Supabase project and prints a
// one-time password-reset link for localhost and for the home network.
//
//   npm run dev:reset-link            # customer
//   node scripts/dev-reset-link.mjs --admin # admin
//   node scripts/dev-reset-link.mjs --url https://<preview-or-production-host>
//   (PowerShell strips the `--` of `npm run dev:reset-link -- --flag`)
//                                     # also print a link for that deploy
//                                     # (only deploys wired to the DEV project)
//   node scripts/dev-reset-link.mjs --email maya.barak@demo.example.com
//                                     # a demo customer (story 5.18): only an
//                                     # existing user on demo.example.com, on
//                                     # the DEV project; nothing is created
//
// The account gets a random password that is never printed; the link is the
// only way in. Running it again reuses the same account and revokes the
// previous link. Replaced by the admin "issue link" button in story 2.8.

import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { networkInterfaces } from "node:os"

import { createClient } from "@supabase/supabase-js"

import { devRef, parseEmail } from "./dev-guard.mjs"

if (existsSync(".env.local")) process.loadEnvFile(".env.local")

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
if (!url || !secretKey) {
  console.error(
    "חסרים NEXT_PUBLIC_SUPABASE_URL או SUPABASE_SECRET_KEY ב-.env.local"
  )
  process.exit(1)
}

const asAdmin = process.argv.includes("--admin")

// --email <x@demo.example.com> or --email=<x@demo.example.com>: an existing
// demo customer (story 5.18).
const parsedEmail = parseEmail(process.argv.slice(2))
if (parsedEmail.error) {
  console.error(parsedEmail.error)
  process.exit(1)
}
const demoEmail = parsedEmail.email

// --url <base> or --url=<base>: a deployed origin (preview / production).
function parseBaseUrl(argv) {
  const index = argv.findIndex(
    (arg) => arg === "--url" || arg.startsWith("--url=")
  )
  if (index < 0) return null
  const raw = argv[index].startsWith("--url=")
    ? argv[index].slice("--url=".length)
    : argv[index + 1]
  let parsed
  try {
    parsed = new URL(raw ?? "")
  } catch {
    parsed = null
  }
  if (!parsed || !["http:", "https:"].includes(parsed.protocol)) {
    console.error("--url צריך כתובת מלאה, למשל https://example.vercel.app")
    process.exit(1)
  }
  return parsed.origin
}
const baseUrl = parseBaseUrl(process.argv.slice(2))
const account = demoEmail
  ? { email: demoEmail, label: "לקוחת הדגמה", demo: true }
  : asAdmin
  ? { email: "dev-admin@example.com", label: "אדמין בדויה" }
  : {
      email: "dev-customer@example.com",
      label: "לקוחה בדויה",
      fullName: "נועה בדויה",
    }

const supabase = createClient(url, secretKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})

async function findUserByEmail(email) {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (error)
      throw new Error(`listUsers failed: ${error.code ?? error.status}`)
    const user = data.users.find((u) => u.email?.toLowerCase() === email)
    if (user) return user
    if (data.users.length < 1000) return null
  }
}

async function findOrCreateUser(email) {
  const existing = await findUserByEmail(email)
  if (existing) return { user: existing, created: false }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: randomBytes(24).toString("base64url"),
    email_confirm: true,
  })
  if (error) {
    if (error.code === "email_exists") {
      const again = await findUserByEmail(email)
      if (again) return { user: again, created: false }
    }
    throw new Error(`createUser failed: ${error.code ?? error.status}`)
  }
  return { user: data.user, created: true }
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((net) => net && net.family === "IPv4" && !net.internal)
    .map((net) => net.address)
    .filter((address) =>
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)
    )
}

// A demo customer: only an existing user with an activated profile, on the
// DEV project; no user and no profile is created or changed.
async function findDemoUser(email) {
  if (
    !devRef({
      supabaseUrl: url,
      databaseUrl: process.env.DEV_DATABASE_URL,
    })
  ) {
    console.error(
      "--email רץ רק מול פרויקט הפיתוח: DEV_DATABASE_URL ב-.env.local חייב להכיל את ה-ref של NEXT_PUBLIC_SUPABASE_URL."
    )
    process.exit(1)
  }
  const user = await findUserByEmail(email)
  if (!user) {
    console.error(`אין לקוחת הדגמה ${email}. קודם: npm run demo:seed`)
    process.exit(1)
  }
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .not("activated_at", "is", null)
    .maybeSingle()
  if (error) throw new Error(`profile read failed: ${error.code}`)
  if (!profile) {
    console.error(`ל-${email} אין פרופיל פעיל. קודם: npm run demo:seed`)
    process.exit(1)
  }
  return user
}

async function main() {
  const { user, created } = account.demo
    ? { user: await findDemoUser(account.email), created: false }
    : await findOrCreateUser(account.email)

  if (!account.demo) {
    const row = asAdmin
      ? supabase
          .from("admin_roles")
          .upsert(
            { user_id: user.id },
            { onConflict: "user_id", ignoreDuplicates: true }
          )
      : supabase.from("profiles").upsert(
          {
            id: user.id,
            full_name: account.fullName,
            activated_at: new Date().toISOString(),
          },
          { onConflict: "id", ignoreDuplicates: true }
        )
    const { error: rowError } = await row
    if (rowError) throw new Error(`profile/admin row failed: ${rowError.code}`)
  }

  const { data, error } = await supabase.rpc("issue_reset_token", {
    p_user_id: user.id,
  })
  if (error) throw new Error(`issue_reset_token failed: ${error.message}`)

  const port = process.env.PORT ?? "3000"
  const path = `/reset/${data.token}`

  console.log(
    `${account.label}: ${account.email} (${created ? "נוצרה עכשיו" : "קיימת"})`
  )
  console.log(`תוקף הקישור: 48 שעות. קישור קודם בוטל.`)
  console.log("")
  console.log(`במחשב:  http://localhost:${port}${path}`)
  for (const address of lanAddresses()) {
    console.log(`בטלפון: http://${address}:${port}${path}`)
  }
  if (baseUrl) console.log(`בפריסה: ${baseUrl}${path}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
