import { describe, expect, it, vi } from "vitest"

// next/navigation's redirect() throws to stop rendering; the mock does too.
class RedirectSignal extends Error {
  constructor(public url: string) {
    super(`REDIRECT ${url}`)
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url)
  },
}))

const { default: SessionMorningPage } = await import("./page")

async function redirectTarget(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(RedirectSignal)
  return (error as RedirectSignal).url
}

// Story 4.9: the old session-morning address leads to the work sheet.
describe("/admin/sessions/[id]/day", () => {
  it("redirects to the session's work sheet", async () => {
    const id = "00000000-0000-4000-8000-000000000001"
    expect(
      await redirectTarget(
        SessionMorningPage({ params: Promise.resolve({ id }) })
      )
    ).toBe(`/admin/sessions/${id}/work`)
  })

  it("encodes the id, so it cannot add a path", async () => {
    expect(
      await redirectTarget(
        SessionMorningPage({ params: Promise.resolve({ id: "a/../b" }) })
      )
    ).toBe("/admin/sessions/a%2F..%2Fb/work")
  })
})
