import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, join, relative, sep } from "node:path"

import { describe, expect, it } from "vitest"

// Story 6.7, T21 (SN1): the browser's push permission is asked only after
// the explanation and her tap. Notification.requestPermission is called in
// exactly one place outside the tests: inside enable() of the push card,
// which runs only from the card's buttons (onEnable -> onClick).
// pushManager.subscribe, which can prompt too, is called only inside
// ensureSubscription (lib/push/client.ts), and that only from enable() and
// from push-sync after its "on" check ("on" needs the permission granted:
// lib/push/client.test.ts:33). The browser side (no prompt on load, none
// again after "לא עכשיו") is MA10.

const ROOT = join(__dirname, "..")
const DIRS = ["app", "components", "lib", "public"]
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"])
const CARD = "components/shared/push-card.tsx"
const SYNC = "components/shared/push-sync.tsx"
const CLIENT = "lib/push/client.ts"

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

const SOURCES = DIRS.flatMap((dir) => files(join(ROOT, dir)))
  .map((path) => relative(ROOT, path).split(sep).join("/"))
  .filter(
    (path) => EXTENSIONS.has(extname(path)) && !/\.test\.[jt]sx?$/.test(path)
  )

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
}

// The files with a match of the pattern, once per match.
function callers(pattern: RegExp): string[] {
  return SOURCES.flatMap((path) =>
    [...read(path).matchAll(pattern)].map(() => path)
  )
}

// The body of `async function <name>()`, by matching braces.
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}()`)
  expect(start, `no ${name}()`).toBeGreaterThanOrEqual(0)
  const open = source.indexOf("{", start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++
    if (source[i] === "}") depth--
    if (depth === 0) return source.slice(open, i + 1)
  }
  throw new Error(`unbalanced ${name}()`)
}

describe("the push permission request", () => {
  it("is called once outside the tests, in push-card.tsx inside enable()", () => {
    expect(callers(/requestPermission\s*\(/g)).toEqual([CARD])
    expect(functionBody(read(CARD), "enable")).toMatch(
      /Notification\.requestPermission\(\)/
    )
  })

  it("enable is only declared and wired to the card's buttons (never called or passed elsewhere)", () => {
    const source = read(CARD)
    // Every use of the name enable as an identifier (not "enable" the
    // string, not copy.enable).
    const uses = [...source.matchAll(/(?<![.'"\w])enable\b(?!['"])/g)].map(
      // The whole line of each use.
      (m) =>
        source
          .slice(
            source.lastIndexOf("\n", m.index) + 1,
            source.indexOf("\n", m.index)
          )
          .trim()
    )
    expect(uses).toEqual(["async function enable() {", "onEnable={enable}"])
    const wiring = [...source.matchAll(/\bonEnable\b[^,;\n]*/g)].map((m) =>
      m[0].trim()
    )
    expect(wiring).toEqual([
      "onEnable={enable}",
      "onEnable",
      "onEnable?: () => void",
      "onEnable}",
      "onEnable}",
    ])
    expect(source).toContain("onClick={onEnable}")
    expect(source).toContain("onClick={on ? onTurnOff : onEnable}")
  })

  it("pushManager.subscribe is only in ensureSubscription, called from enable() and from push-sync after its 'on' check", () => {
    expect(callers(/pushManager\.subscribe\s*\(/g)).toEqual([CLIENT])
    expect(functionBody(read(CLIENT), "ensureSubscription")).toMatch(
      /pushManager\.subscribe\(/
    )
    expect(callers(/ensureSubscription\s*\(/g).sort()).toEqual(
      [CLIENT, CARD, SYNC].sort()
    )
    // In the client, the one match is its declaration.
    expect(read(CLIENT)).toContain("export async function ensureSubscription(")
    expect(functionBody(read(CARD), "enable")).toContain(
      "await ensureSubscription()"
    )
    const sync = read(SYNC)
    const guard = sync.indexOf('if (currentPushState() !== "on") return')
    expect(guard).toBeGreaterThanOrEqual(0)
    expect(sync.indexOf("ensureSubscription()")).toBeGreaterThan(guard)
  })
})
