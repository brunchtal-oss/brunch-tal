// setupFiles of the `db` Vitest project: runs before every database test
// file. Loads .env.local, checks DEV_DATABASE_URL before any connection, and
// after the file runs its cleanups and closes the pool. Under
// `npm run prod:grants` (story 6.1) it checks PROD_DATABASE_URL from
// .env.prod.local instead (read by db.ts into an object, not process.env).

import { existsSync } from "node:fs"

import { afterAll } from "vitest"

import { endPool, runCleanups, targetDatabaseUrl } from "./db"

if (existsSync(".env.local")) process.loadEnvFile(".env.local")

// Fails the file with a clear message, without connecting.
targetDatabaseUrl()

afterAll(async () => {
  try {
    await runCleanups()
  } finally {
    await endPool()
  }
})
