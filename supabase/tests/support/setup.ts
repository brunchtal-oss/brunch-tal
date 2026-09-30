// setupFiles of the `db` Vitest project: runs before every database test
// file. Loads .env.local, checks DEV_DATABASE_URL before any connection, and
// after the file runs its cleanups and closes the pool.

import { existsSync } from "node:fs"

import { afterAll } from "vitest"

import { devDatabaseUrl, endPool, runCleanups } from "./db"

if (existsSync(".env.local")) process.loadEnvFile(".env.local")

// Fails the file with a clear message, without connecting.
devDatabaseUrl()

afterAll(async () => {
  try {
    await runCleanups()
  } finally {
    await endPool()
  }
})
