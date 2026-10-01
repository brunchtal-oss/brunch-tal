import { readdirSync, readFileSync } from "node:fs"
import { extname, join, relative, sep } from "node:path"

import { describe, expect, it } from "vitest"

// Invisible characters got into files three times in epic 1 (an agent write
// turned \u escapes into the characters themselves, and links copied from
// Hebrew text carried direction marks). Code may contain none of them;
// Markdown may contain only U+200F (RLM), which the Hebrew docs use on
// purpose. Write these characters as escapes in source, never literally.

const ROOT = join(__dirname, "..")

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".turbo",
  "coverage",
  "_bmad",
  ".agents",
  ".claude",
  "agent",
  "photos",
])

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".sql",
  ".md",
  ".toml",
  ".yml",
  ".yaml",
  ".html",
  ".example",
])

// Already applied to the database, so it cannot be edited (AGENTS.md); its
// normalize_phone was replaced by 20260930172341_fix_normalize_phone.sql.
const EXEMPT = new Set([
  "supabase/migrations/20260930171231_create_time_and_phone_helpers.sql",
])

const RLM = 0x200f

function range(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

const INVISIBLE = new Set([
  ...range(0x200b, 0x200f),
  ...range(0x202a, 0x202e),
  ...range(0x2060, 0x2069),
  0xfeff,
])

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) ? [] : listFiles(path)
    }
    if (entry.name.startsWith(".env") && entry.name !== ".env.example") {
      return []
    }
    return TEXT_EXTENSIONS.has(extname(entry.name)) ? [path] : []
  })
}

function findInvisible(text: string, allowRlm: boolean) {
  const found: string[] = []
  const lines = text.split("\n")
  lines.forEach((line, index) => {
    for (const char of line) {
      const code = char.codePointAt(0)!
      if (!INVISIBLE.has(code) || (allowRlm && code === RLM)) continue
      found.push(
        `line ${index + 1}: U+${code.toString(16).toUpperCase().padStart(4, "0")}`
      )
    }
  })
  return found
}

describe("invisible characters", () => {
  it("detects every listed character and allows RLM only in docs", () => {
    const sample = [0x200b, 0x200e, 0x202a, 0x2066, 0xfeff]
      .map((c) => String.fromCodePoint(c))
      .join("")
    expect(findInvisible(sample, false)).toHaveLength(5)
    expect(findInvisible(String.fromCodePoint(RLM), true)).toEqual([])
    expect(findInvisible(String.fromCodePoint(RLM), false)).toHaveLength(1)
  })

  it("no file in the repo contains them", () => {
    const problems = listFiles(ROOT).flatMap((path) => {
      const name = relative(ROOT, path).split(sep).join("/")
      if (EXEMPT.has(name)) return []
      const allowRlm = extname(name) === ".md"
      return findInvisible(readFileSync(path, "utf8"), allowRlm).map(
        (where) => `${name} ${where}`
      )
    })
    expect(problems).toEqual([])
  })
})
