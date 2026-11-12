// Story 6.1 (deferred-work, item (ג)), story 6.11: the auth.users guard
// against the real Supabase Auth of the PRODUCTION project. The steps are
// in scripts/auth-guard-runner.mjs (shared with dev-auth-guard-check.mjs).
//
//   node scripts/prod-auth-guard-check.mjs          # dry run: the plan only
//   node scripts/prod-auth-guard-check.mjs --apply  # only after the user's OK
//   node scripts/prod-auth-guard-check.mjs --apply --domain <d>
//                                                   # another domain with MX
//
// MX REQUIRED: the throwaway address is on morethanfood.co.il by default
// (or --domain); that domain must have MX records, so Auth accepts the
// address and the self email change reaches the trigger (on example.com
// Auth refused the address first, "לא הוכח"). Check before every run:
// nslookup -type=MX <domain>. The dry run prints the domain it will use.

import { parseDomain, runAuthGuardCheck } from "./auth-guard-runner.mjs"
import {
  fail,
  loadProdConfig,
  publicClient,
  serviceClient,
} from "./prod-env.mjs"

const apply = process.argv.includes("--apply")
const parsed = parseDomain(process.argv.slice(2))
if ("error" in parsed) fail(parsed.error)
const config = loadProdConfig()

runAuthGuardCheck({
  label: "פרודקשן",
  apply,
  domain: parsed.domain,
  admin: serviceClient(config.supabaseUrl, config.secretKey),
  newUserClient: () => publicClient(config.supabaseUrl, config.publishableKey),
})
  .then((failed) => {
    if (failed > 0) process.exitCode = 1
  })
  .catch((error) => {
    console.error(`prod-auth-guard-check נכשל: ${error.message}`)
    process.exit(1)
  })
