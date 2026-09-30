import { describe, expect, it } from "vitest"
import { configDefaults } from "vitest/config"

import config from "../vitest.config.mjs"

// `npm test` (CI, no database) must never pick up supabase/tests; `npm run
// test:db` runs only those, one file at a time.
const DB_DIR = "supabase/tests/**"
const DB_TESTS = "supabase/tests/**/*.test.{ts,tsx}"

function project(name: string) {
  const found = config.test?.projects?.find(
    (p) => typeof p === "object" && "test" in p && p.test?.name === name
  )
  if (!found || typeof found !== "object" || !("test" in found)) {
    throw new Error(`missing vitest project ${name}`)
  }
  return found.test!
}

describe("vitest projects", () => {
  it("unit excludes the database tests", () => {
    expect(project("unit").exclude).toContain(DB_DIR)
  })

  it("db runs only the database tests, serially", () => {
    const db = project("db")
    expect(db.include).toEqual([DB_TESTS])
    expect(db.fileParallelism).toBe(false)
  })

  it("both projects keep the Vitest default excludes", () => {
    for (const name of ["unit", "db"]) {
      expect(project(name).exclude).toEqual(
        expect.arrayContaining([...configDefaults.exclude])
      )
    }
    expect(project("unit").exclude).toContain(".next/**")
  })

  it("an empty db project passes", () => {
    expect(config.test?.passWithNoTests).toBe(true)
  })
})
