// Dev only (story 1.1 tracer): creates or finds a fictitious customer (or,
// with --admin, a fictitious admin) on the DEV Supabase project and prints a
// one-time password-reset link for localhost and for the home network.
//
//   npm run dev:reset-link            # customer
//   npm run dev:reset-link -- --admin # admin
//
// The account gets a random password that is never printed; the link is the
// only way in. Running it again reuses the same account and revokes the
// previous link. Replaced by the admin "issue link" button in story 2.8.

import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { networkInterfaces } from "node:os"

import { createClient } from "@supabase/supabase-js"

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
const account = asAdmin
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

async function main() {
  const { user, created } = await findOrCreateUser(account.email)

  const row = asAdmin
    ? supabase
        .from("admin_roles")
        .upsert(
          { user_id: user.id },
          { onConflict: "user_id", ignoreDuplicates: true }
        )
    : supabase
        .from("profiles")
        .upsert(
          {
            id: user.id,
            full_name: account.fullName,
            activated_at: new Date().toISOString(),
          },
          { onConflict: "id", ignoreDuplicates: true }
        )
  const { error: rowError } = await row
  if (rowError) throw new Error(`profile/admin row failed: ${rowError.code}`)

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
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
