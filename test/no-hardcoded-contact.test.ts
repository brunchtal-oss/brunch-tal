import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join, relative, sep } from "node:path"

import { describe, expect, it } from "vitest"

// Story 6.7, T20 (AV2): no business number is written in the code. The
// WhatsApp number and the phone come only from the business details
// (content), and every wa.me link with a number is built by
// lib/content/whatsapp.ts from them; a number-less wa.me/?text= (Tal picks
// whom to send to) is allowed. Scans app/, components/ and lib/, without
// test files and fixtures only: comment lines are scanned too, and an
// example in a comment is an explicit exception below.

const ROOT = join(__dirname, "..")
const DIRS = ["app", "components", "lib"]
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".css"])

// Exceptions, exact text per file, each checked by eye:
// - lib/copy/admin.ts: the example of a phone link in the legal page
//   editor's hint ("[054-0000000](tel:+972540000000)"), a made-up number.
// - lib/phone.ts: the formatter's doc comment, made-up examples of its input
//   and output.
// - components/public/legal-views.tsx: the display format in the comment of
//   displayPhone, with the business's public number (a comment: not shown,
//   not linked). It stays: the number is public and shown on the site
//   (planning session decision 2026-10-30).
const ALLOWED: Record<string, string[]> = {
  "lib/copy/admin.ts": ["054-0000000", "+972540000000"],
  "lib/phone.ts": [
    "+972541234567",
    "054-123-4567",
    "+97231234567",
    "03-123-4567",
  ],
  "components/public/legal-views.tsx": ["054-425-6456"],
}

// An Israeli phone, local (0..., also with the prefix in parentheses:
// "(054)") or international (+972, 972, 00972), with or without dashes and
// spaces: a mobile (5x, 7x) or a landline (2, 3, 4, 8, 9).
const ISRAELI_PHONE =
  /(?<![\w+])(?:(?:\+|00)?972[-\s]?|0|\(0)(?:5\d|7\d|[23489])\)?(?:[-\s]?\d){7}(?!\d)/g
// A 1-700 / 1-800 business number ("1-700-123-456", "1800123456").
const SERVICE_NUMBER = /(?<![\w+])1[-\s]?[78]00(?:[-\s]?\d){6}(?!\d)/g
// A WhatsApp link with a number in it: wa.me/<number>,
// api.whatsapp.com/send?...phone=, whatsapp://send?...phone=.
const WA_ME_NUMBER = /wa\.me\/\d+/g
const WHATSAPP_PHONE =
  /(?:api\.whatsapp\.com\/send|whatsapp:\/\/send)\?(?:[^"'`\s]*&)?phone=/g
const PATTERNS = [ISRAELI_PHONE, SERVICE_NUMBER, WA_ME_NUMBER, WHATSAPP_PHONE]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return name === "node_modules" || name.startsWith("__") ? [] : files(path)
    }
    return [path]
  })
}

function isTestOrFixture(path: string): boolean {
  return (
    /\.test\.[cm]?[jt]sx?$/.test(path) ||
    /(^|\/)(fixtures?|__fixtures__|__mocks__)(\/|$)/.test(path)
  )
}

function hits(text: string): string[] {
  return PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((m) => m[0])
  )
}

type Finding = { path: string; line: number; match: string }

function scan(): { scanned: number; findings: Finding[] } {
  const sources = DIRS.flatMap((dir) => files(join(ROOT, dir)))
    .map((path) => relative(ROOT, path).split(sep).join("/"))
    .filter((path) => EXTENSIONS.has(extname(path)) && !isTestOrFixture(path))
  const findings: Finding[] = []
  for (const path of sources) {
    const lines = readFileSync(join(ROOT, path), "utf8").split(/\r?\n/)
    lines.forEach((text, index) => {
      for (const match of hits(text)) {
        if (ALLOWED[path]?.includes(match)) continue
        findings.push({ path, line: index + 1, match })
      }
    })
  }
  return { scanned: sources.length, findings }
}

describe("no hard-coded contact number", () => {
  it("app/, components/ and lib/ hold no phone number and no WhatsApp link with a number, comments included", () => {
    const { scanned, findings } = scan()
    expect(scanned).toBeGreaterThan(100)
    // Every place found, path:line and the match.
    expect(
      findings.map((f) => `${f.path}:${f.line} ${f.match}`),
      "hard-coded numbers"
    ).toEqual([])
  })

  it("each allowed example is still there and is caught by the patterns (an exception that went away is removed from the list)", () => {
    for (const [path, examples] of Object.entries(ALLOWED)) {
      const source = readFileSync(join(ROOT, path), "utf8")
      for (const example of examples) {
        expect(source, path).toContain(example)
        expect(hits(`"${example}"`), example).toEqual([example])
      }
    }
  })

  it("the patterns catch a number in each format, and leave a number-less link alone", () => {
    for (const text of [
      '"0541234567"',
      '"054-123-4567"',
      '"054 1234567"',
      '"+972541234567"',
      '"972541234567"',
      '"00972541234567"',
      '"03-1234567"',
      '"(054) 123-4567"',
      '"(03)1234567"',
      '"1-700-123-456"',
      '"1800123456"',
      "`https://wa.me/972541234567`",
      '"https://api.whatsapp.com/send?phone=972541234567"',
      '"https://api.whatsapp.com/send?text=hi&phone=972541234567"',
      '"whatsapp://send?phone=972541234567"',
      "// call 054-1234567",
    ]) {
      expect(hits(text).length, text).toBeGreaterThan(0)
    }
    for (const text of [
      "`https://wa.me/?text=${encodeURIComponent(link)}`",
      "`https://wa.me/${digits}`",
      '"https://api.whatsapp.com/send?text=hi"',
      '"2026-10-30"',
      '"17000"',
      '"a1b2c3d4-0541-2345-6789-0123456789ab"',
    ]) {
      expect(hits(text), text).toEqual([])
    }
  })
})
