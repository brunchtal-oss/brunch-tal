// Story 6.11: the auth.users guard against the real Supabase Auth of the
// DEV project (.env.local). The steps are in scripts/auth-guard-runner.mjs
// (shared with prod-auth-guard-check.mjs).
//
//   node scripts/dev-auth-guard-check.mjs          # dry run: the plan only
//   node scripts/dev-auth-guard-check.mjs --apply  # creates and deletes a
//                                                  # throwaway user
//   node scripts/dev-auth-guard-check.mjs --apply --domain <d>
//
// MX REQUIRED: the throwaway address is on morethanfood.co.il by default
// (or --domain), which must have MX records (nslookup -type=MX <domain>
// before the run); the dry run prints the domain it will use.
//
// Never against production: the project of .env.local must be the one
// DEV_DATABASE_URL points at (the dev guard of every dev script).

import { existsSync } from "node:fs"

import { createClient } from "@supabase/supabase-js"

import { parseDomain, runAuthGuardCheck } from "./auth-guard-runner.mjs"
import { devRef } from "./dev-guard.mjs"

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (existsSync(".env.local")) process.loadEnvFile(".env.local")

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
const secretKey = process.env.SUPABASE_SECRET_KEY
if (!url || !publishableKey || !secretKey) {
  fail(
    "חסרים NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY או SUPABASE_SECRET_KEY ב-.env.local"
  )
}
if (!devRef({ supabaseUrl: url, databaseUrl: process.env.DEV_DATABASE_URL })) {
  fail(
    "DEV_DATABASE_URL ב-.env.local חייב להכיל את ה-ref של NEXT_PUBLIC_SUPABASE_URL (פרויקט הפיתוח)."
  )
}

const apply = process.argv.includes("--apply")
const parsed = parseDomain(process.argv.slice(2))
if ("error" in parsed) fail(parsed.error)

const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}

runAuthGuardCheck({
  label: "פיתוח",
  apply,
  domain: parsed.domain,
  admin: createClient(url, secretKey, options),
  newUserClient: () => createClient(url, publishableKey, options),
})
  .then((failed) => {
    if (failed > 0) process.exitCode = 1
  })
  .catch((error) => {
    console.error(`dev-auth-guard-check נכשל: ${error.message}`)
    process.exit(1)
  })
