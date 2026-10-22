// Story 5.20 (fix 8): an interrupted database test run still runs its
// pending cleanups, once (supabase/tests/support/db.ts). Pure: no pool is
// created, so it runs in `npm test`. Each test loads a fresh copy of the
// module (its cleanup list and its once-only exit cleanup).

import { afterEach, describe, expect, it, vi } from "vitest"

type DbModule = typeof import("../supabase/tests/support/db")

async function freshDb(): Promise<DbModule> {
  vi.resetModules()
  return import("../supabase/tests/support/db")
}

type Listener = (...args: unknown[]) => void
const EVENTS = ["SIGINT", "SIGTERM", "beforeExit"] as const
const listenersOf = (event: string): Listener[] =>
  process.listeners(event as NodeJS.Signals) as unknown as Listener[]

const before = Object.fromEntries(
  EVENTS.map((event) => [event, listenersOf(event)])
) as Record<(typeof EVENTS)[number], Listener[]>

afterEach(() => {
  vi.restoreAllMocks()
  // Drop the handlers the fresh modules installed.
  for (const event of EVENTS) {
    for (const listener of listenersOf(event)) {
      if (!before[event].includes(listener)) {
        process.removeListener(event as NodeJS.Signals, listener as never)
      }
    }
  }
})

describe("cleanupOnExit", () => {
  it("runs the pending cleanups once, latest first; a failure does not stop the rest", async () => {
    const { cleanupOnExit, onCleanup } = await freshDb()
    const ran: string[] = []
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    onCleanup(async () => {
      ran.push("first")
    })
    onCleanup(async () => {
      throw new Error("boom")
    })
    onCleanup(async () => {
      ran.push("last")
    })
    await cleanupOnExit()
    await cleanupOnExit()
    expect(ran).toEqual(["last", "first"])
    expect(error).toHaveBeenCalledWith("db tests: cleanup on exit failed: boom")
  })

  it("SIGINT runs a pending cleanup, then exits with 130", async () => {
    const { onCleanup } = await freshDb()
    const ran: string[] = []
    onCleanup(async () => {
      ran.push("cleanup")
    })
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never)
    const handler = listenersOf("SIGINT").at(-1) as () => void
    expect(before.SIGINT).not.toContain(handler)
    handler()
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(130))
    expect(ran).toEqual(["cleanup"])
  })
})
