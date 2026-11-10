import { describe, expect, it } from "vitest"

import {
  assertDistinctProjects,
  checkProdEnv,
  connectionErrorMessage,
  databaseUrlSecrets,
  NOT_FOUND_MESSAGE,
  PAUSED_MESSAGE,
  prodRef,
  projectRef,
  redact,
} from "../scripts/prod-env.mjs"

// Story 6.1: the guards every prod script runs before it connects.
const PROD = "prodprodprodprodprod"
const DEV = "devdevdevdevdevdevde"
const SECRET_PW = "Sup3rS3cretPassw0rd"
const SECRET_KEY = "sb_secret_abcdefghijklmnop"
const PUBLISHABLE = "sb_publishable_qrstuvwxyz"

const poolerUrl = (ref: string, port = 5432) =>
  `postgresql://postgres.${ref}:${SECRET_PW}@aws-0-eu-central-1.pooler.supabase.com:${port}/postgres`

function prodEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    PROD_SUPABASE_URL: `https://${PROD}.supabase.co`,
    PROD_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
    PROD_SUPABASE_SECRET_KEY: SECRET_KEY,
    PROD_DATABASE_URL: poolerUrl(PROD),
    ...overrides,
  }
}
const devEnv = { NEXT_PUBLIC_SUPABASE_URL: `https://${DEV}.supabase.co` }

function expectNoSecret(text: string) {
  for (const secret of [SECRET_PW, SECRET_KEY, PUBLISHABLE, "postgresql://"]) {
    expect(text).not.toContain(secret)
  }
}

describe("projectRef / prodRef", () => {
  it("reads the ref of a hosted URL only", () => {
    expect(projectRef(`https://${PROD}.supabase.co`)).toBe(PROD)
    expect(projectRef("http://127.0.0.1:54321")).toBeNull()
    expect(projectRef("not a url")).toBeNull()
    expect(projectRef(undefined)).toBeNull()
  })

  it("accepts the pooler user or the direct host of the same project", () => {
    const supabaseUrl = `https://${PROD}.supabase.co`
    expect(prodRef({ supabaseUrl, databaseUrl: poolerUrl(PROD) })).toBe(PROD)
    expect(
      prodRef({
        supabaseUrl,
        databaseUrl: `postgresql://postgres:pw@db.${PROD}.supabase.co:5432/postgres`,
      })
    ).toBe(PROD)
  })

  it("refuses a database URL of another project, or the ref only in the password", () => {
    const supabaseUrl = `https://${PROD}.supabase.co`
    expect(prodRef({ supabaseUrl, databaseUrl: poolerUrl(DEV) })).toBeNull()
    expect(
      prodRef({
        supabaseUrl,
        databaseUrl: `postgresql://postgres.${DEV}:${PROD}@aws-0.pooler.supabase.com:5432/postgres`,
      })
    ).toBeNull()
  })
})

describe("assertDistinctProjects", () => {
  it("passes for two different refs", () => {
    expect(() => assertDistinctProjects(PROD, DEV)).not.toThrow()
  })

  it("refuses the same ref, a missing prod ref and a missing dev ref", () => {
    expect(() => assertDistinctProjects(DEV, DEV)).toThrow(/פרויקט הפיתוח/)
    expect(() => assertDistinctProjects(null, DEV)).toThrow(/PROD_DATABASE_URL/)
    expect(() => assertDistinctProjects(PROD, null)).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/
    )
  })
})

describe("checkProdEnv", () => {
  it("refuses a PROD_SUPABASE_URL with a path (the Data API URL)", () => {
    const result = checkProdEnv(
      prodEnv({ PROD_SUPABASE_URL: `https://${PROD}.supabase.co/rest/v1/` }),
      devEnv
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("/rest/v1/")
  })

  it("accepts a complete prod file of another project", () => {
    expect(checkProdEnv(prodEnv(), devEnv)).toEqual({ ok: true, ref: PROD })
  })

  it("refuses a missing file", () => {
    const result = checkProdEnv(null, devEnv)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain(".env.prod.local")
  })

  it("refuses missing variables and names them", () => {
    const result = checkProdEnv(
      prodEnv({ PROD_SUPABASE_SECRET_KEY: undefined, PROD_DATABASE_URL: "  " }),
      devEnv
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("PROD_SUPABASE_SECRET_KEY")
      expect(result.error).toContain("PROD_DATABASE_URL")
      expect(result.error).not.toContain("PROD_SUPABASE_URL,")
    }
  })

  it("refuses the dev project (same ref on both sides)", () => {
    const result = checkProdEnv(
      prodEnv({
        PROD_SUPABASE_URL: `https://${DEV}.supabase.co`,
        PROD_DATABASE_URL: poolerUrl(DEV),
      }),
      devEnv
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/פרויקט הפיתוח/)
  })

  it("refuses a database URL whose ref differs from PROD_SUPABASE_URL", () => {
    const result = checkProdEnv(
      prodEnv({ PROD_DATABASE_URL: poolerUrl(DEV) }),
      devEnv
    )
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain("PROD_DATABASE_URL")
  })

  it("refuses when the dev ref is unknown", () => {
    const result = checkProdEnv(prodEnv(), {})
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain(".env.local")
  })

  it("refuses the transaction pooler and an invalid URL", () => {
    const tx = checkProdEnv(
      prodEnv({ PROD_DATABASE_URL: poolerUrl(PROD, 6543) }),
      devEnv
    )
    expect(tx.ok).toBe(false)
    expect(!tx.ok && tx.error).toContain("5432")
    const invalid = checkProdEnv(
      prodEnv({ PROD_DATABASE_URL: `postgres.${PROD}:${SECRET_PW}@@` }),
      devEnv
    )
    expect(invalid.ok).toBe(false)
  })

  it("never puts a secret in an error message", () => {
    const cases = [
      checkProdEnv(
        prodEnv({ PROD_SUPABASE_URL: "https://example.com" }),
        devEnv
      ),
      checkProdEnv(prodEnv({ PROD_DATABASE_URL: poolerUrl(DEV) }), devEnv),
      checkProdEnv(
        prodEnv({ PROD_DATABASE_URL: poolerUrl(PROD, 6543) }),
        devEnv
      ),
      checkProdEnv(
        prodEnv({ PROD_DATABASE_URL: `x${SECRET_PW}::not a url` }),
        devEnv
      ),
      checkProdEnv(prodEnv(), {}),
      checkProdEnv(
        prodEnv({
          PROD_SUPABASE_URL: `https://${DEV}.supabase.co`,
          PROD_DATABASE_URL: poolerUrl(DEV),
        }),
        devEnv
      ),
    ]
    for (const result of cases) {
      expect(result.ok).toBe(false)
      if (!result.ok) expectNoSecret(result.error)
    }
  })
})

describe("connectionErrorMessage / redact", () => {
  it("maps a wrong password, a project the pooler does not find and a paused one, without echoing the error", () => {
    const wrong = connectionErrorMessage({
      code: "28P01",
      message: `password authentication failed for user "postgres.${PROD}"`,
    })
    expect(wrong).toContain("PROD_DATABASE_URL")
    expect(wrong).not.toContain(PROD)
    expect(
      connectionErrorMessage({
        code: "XX000",
        message: "Tenant or user not found",
      })
    ).toBe(NOT_FOUND_MESSAGE)
    for (const code of ["ENOTFOUND", "EAI_AGAIN"]) {
      expect(
        connectionErrorMessage({
          code,
          message: `getaddrinfo ${code} aws-0.pooler.supabase.com`,
        })
      ).toBe(NOT_FOUND_MESSAGE)
    }
    expect(NOT_FOUND_MESSAGE).toContain("PROD_DATABASE_URL")
    expect(NOT_FOUND_MESSAGE).not.toContain("pooler.supabase.com")
    for (const code of ["ETIMEDOUT", "ECONNREFUSED"]) {
      expect(connectionErrorMessage({ code, message: code })).toBe(
        PAUSED_MESSAGE
      )
    }
    expect(
      connectionErrorMessage(
        new Error("Connection terminated due to connection timeout")
      )
    ).toBe(PAUSED_MESSAGE)
  })

  it("removes the URL, the password and the user from CLI output", () => {
    const url = poolerUrl(PROD).replace(SECRET_PW, "p%40ss" + SECRET_PW)
    const output = `failed to connect to ${url}: password p@ss${SECRET_PW} for postgres.${PROD}`
    const clean = redact(output, databaseUrlSecrets(url))
    expect(clean).not.toContain(SECRET_PW)
    expect(clean).not.toContain(`postgres.${PROD}`)
    expect(clean).not.toContain("pooler.supabase.com")
  })
})
