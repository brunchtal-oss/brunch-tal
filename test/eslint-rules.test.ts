import { fileURLToPath } from "node:url"

import { ESLint } from "eslint"
import { beforeAll, describe, expect, it } from "vitest"

// Exercises the architecture rules in eslint.config.mjs against fake file
// paths (the files do not need to exist).
const ROOT = fileURLToPath(new URL("../", import.meta.url))
const RULES = new Set(["no-restricted-syntax", "no-restricted-imports"])

let eslint: ESLint

// The first lintText cold-loads the Next and typescript-eslint configs; do it
// here with a generous timeout instead of inside the first test.
beforeAll(async () => {
  eslint = new ESLint({ cwd: ROOT })
  await eslint.lintText("", { filePath: ROOT + "lib/warmup.ts" })
}, 60_000)

async function violations(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: ROOT + filePath })
  return result.messages
    .filter((m) => m.ruleId && RULES.has(m.ruleId))
    .map((m) => m.ruleId)
}

const CLIENT = '"use client"\n'
const PRIVILEGED_IMPORT =
  'import { getResetTokenView } from "@/lib/server/privileged/reset"\nexport const x = getResetTokenView\n'

describe("use client never imports lib/server", () => {
  it.each([
    ['import { a } from "@/lib/server/thing"\nexport const b = a'],
    ['import { a } from "../../lib/server/thing"\nexport const b = a'],
    ['export const load = () => import("@/lib/server/thing")'],
    ['export { a } from "@/lib/server/thing"'],
    ['export * from "../lib/server/thing"'],
  ])("%s", async (code) => {
    expect(
      await violations("components/auth/widget.tsx", CLIENT + code)
    ).toContain("no-restricted-syntax")
  })

  it("catches a relative path from inside lib", async () => {
    expect(
      await violations(
        "lib/auth/client-helper.ts",
        CLIENT + 'import { a } from "../server/thing"\nexport const b = a'
      )
    ).toContain("no-restricted-syntax")
  })

  it("ignores package subpaths such as react-dom/server", async () => {
    expect(
      await violations(
        "components/auth/widget.tsx",
        CLIENT +
          'import { renderToString } from "react-dom/server"\nexport const r = renderToString'
      )
    ).toEqual([])
  })

  it("allows the same import without the directive", async () => {
    expect(
      await violations(
        "app/me/data.ts",
        'import { a } from "@/lib/server/thing"\nexport const b = a'
      )
    ).toEqual([])
  })
})

describe("lib/server/privileged import boundary", () => {
  it.each([
    "lib/server/privileged/join.ts",
    "app/(auth)/login/actions.ts",
    "app/api/jobs/push/route.ts",
    "app/(auth)/reset/[token]/page.tsx",
    "app/(auth)/join/[token]/page.tsx",
  ])("allowed in %s", async (file) => {
    expect(await violations(file, PRIVILEGED_IMPORT)).toEqual([])
  })

  it.each([
    "app/me/page.tsx",
    "lib/auth/require-customer.ts",
    "app/(auth)/reset/[token]/reset-view.ts",
    "components/auth/password-input.tsx",
  ])("forbidden in %s", async (file) => {
    expect(await violations(file, PRIVILEGED_IMPORT)).toContain(
      "no-restricted-imports"
    )
  })

  it("forbids a dynamic import()", async () => {
    expect(
      await violations(
        "app/me/y.ts",
        'export const load = () => import("@/lib/server/privileged/reset")'
      )
    ).toContain("no-restricted-syntax")
  })

  it("allows a dynamic import() in a Server Action", async () => {
    expect(
      await violations(
        "app/(auth)/login/actions.ts",
        'export const load = () => import("@/lib/server/privileged/reset")'
      )
    ).toEqual([])
  })

  it("does not exempt other pages named reset or join", async () => {
    for (const file of [
      "app/admin/reset/x/page.tsx",
      "app/admin/join/x/page.tsx",
    ]) {
      expect(await violations(file, PRIVILEGED_IMPORT)).toContain(
        "no-restricted-imports"
      )
    }
  })

  it.each([
    ["lib/server/reset-helper.ts", "./privileged/reset"],
    ["lib/server/foo/bar.ts", "../privileged/reset"],
  ])("forbids %s importing %s", async (file, source) => {
    expect(
      await violations(
        file,
        `import { a } from "${source}"
export const b = a`
      )
    ).toContain("no-restricted-imports")
  })

  it("forbids a relative path too", async () => {
    expect(
      await violations(
        "lib/auth/x.ts",
        'import { a } from "../server/privileged/reset"\nexport const b = a'
      )
    ).toContain("no-restricted-imports")
  })
})

describe("direct table writes", () => {
  it.each(["insert", "update", "delete", "upsert"])(
    'forbids .from("bookings").%s',
    async (method) => {
      expect(
        await violations(
          "app/me/actions.ts",
          `export const f = (s: any) => s.from("bookings").${method}({})`
        )
      ).toContain("no-restricted-syntax")
    }
  )

  it.each([
    'export const f = (s: any) => s.from("profiles").update({})',
    'export const f = (s: any) => s.from("babies").insert({})',
    'import { createHash } from "node:crypto"\nexport const h = createHash("sha256").update("x").digest("hex")',
    'export const f = (m: Map<string, number>) => m.delete("k")',
    'export const f = (s: any) => s.storage.from("avatars").update("p", {})',
  ])("allows %s", async (code) => {
    expect(await violations("app/me/actions.ts", code)).toEqual([])
  })

  it("exempts helpers under supabase/tests", async () => {
    expect(
      await violations(
        "supabase/tests/helpers/seed.ts",
        'export const f = (s: any) => s.from("bookings").insert({})'
      )
    ).toEqual([])
  })

  it("exempts test files", async () => {
    expect(
      await violations(
        "app/me/actions.test.ts",
        'export const f = (s: any) => s.from("bookings").insert({})'
      )
    ).toEqual([])
  })
})

describe("RTL classes", () => {
  // Whole snippets, so this file's own string literals do not trip the rule.
  it.each([
    'export const C = () => <div className="ml-2" />',
    'export const C = () => <div className="text-left" />',
    "export const cls = (x: string) => `p-2 ${x}` + `-left`",
  ])("forbids %s", async (code) => {
    expect(await violations("app/me/card.tsx", code)).toContain(
      "no-restricted-syntax"
    )
  })

  it("allows logical classes", async () => {
    expect(
      await violations(
        "app/me/card.tsx",
        'export const C = () => <div className="ms-2 text-start" />'
      )
    ).toEqual([])
  })

  it("skips components/ui", async () => {
    expect(
      await violations(
        "components/ui/thing.tsx",
        'export const C = () => <div className="ml-2 text-left" />'
      )
    ).toEqual([])
  })

  it("still applies the other rules in components/ui", async () => {
    expect(
      await violations(
        "components/ui/thing.tsx",
        CLIENT + 'import { a } from "@/lib/server/thing"\nexport const b = a'
      )
    ).toContain("no-restricted-syntax")
  })

  it("still applies in test files", async () => {
    expect(
      await violations(
        "app/me/card.test.tsx",
        'export const C = () => <div className="ml-2" />'
      )
    ).toContain("no-restricted-syntax")
  })
})

describe("money", () => {
  it.each([
    'parseFloat("1.5")',
    'Number.parseFloat("1.5")',
    'globalThis.parseFloat("1.5")',
  ])("forbids %s in lib/money.ts", async (call) => {
    expect(
      await violations("lib/money.ts", `export const n = ${call}`)
    ).toContain("no-restricted-syntax")
  })

  it("does not restrict parseFloat elsewhere", async () => {
    expect(
      await violations("lib/other.ts", 'export const n = parseFloat("1.5")')
    ).toEqual([])
  })
})
