// Story 6.1: `npm run prod:grants` runs describe("grants") of
// supabase/tests/grants.test.ts against the PRODUCTION project, on a
// read-only session (DB_TARGET=prod: supabase/tests/support/db.ts). The
// dev-only describe ("grants check catches a mistake", DDL in a rollback)
// is skipped there. The prod guards run first, before Vitest starts.

import { spawnSync } from "node:child_process"

import { loadProdConfig } from "./prod-env.mjs"

loadProdConfig()

const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--project",
    "db",
    "supabase/tests/grants.test.ts",
  ],
  // Both markers: supabase/tests/support/db.ts refuses DB_TARGET=prod
  // without PROD_GRANTS_RUN=1, so no other test:db run reaches production.
  {
    stdio: "inherit",
    env: { ...process.env, DB_TARGET: "prod", PROD_GRANTS_RUN: "1" },
  }
)
process.exit(result.status ?? 1)
