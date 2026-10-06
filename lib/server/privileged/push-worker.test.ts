import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  outcomeOf,
  pushBody,
  runPushWorker,
  vapidFromEnv,
  type ClaimedJob,
  type SendPush,
} from "./push-worker"

vi.mock("./service-client", () => ({
  createServiceClient: () => {
    throw new Error("tests pass their own client")
  },
}))

const VAPID = {
  subject: "mailto:a@example.test",
  publicKey: "pub",
  privateKey: "priv",
}

function job(id: string, subs: string[], body = "גוף"): ClaimedJob {
  return {
    job_id: id,
    title: "כותרת",
    body,
    target_path: "/me/bookings",
    subscriptions: subs.map((s) => ({
      id: s,
      endpoint: `https://push.example.test/${s}`,
      p256dh: "p",
      auth: "a",
    })),
  }
}

// A fake Supabase client: claim returns the given batches in order, then
// []; finish answers with `finishStatus(jobId)`.
function fakeClient(
  batches: ClaimedJob[][],
  finishStatus: (args: Record<string, unknown>) => string = (args) =>
    args.p_error ? "queued" : "sent"
) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const queue = [...batches]
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      if (fn === "claim_push_jobs")
        return { data: queue.shift() ?? [], error: null }
      return { data: { status: finishStatus(args) }, error: null }
    }),
  }
  return { client: client as never, calls }
}

function finishes(calls: Array<{ fn: string; args: Record<string, unknown> }>) {
  return calls.filter((c) => c.fn === "finish_push_job").map((c) => c.args)
}

class FakeWebPushError extends Error {
  constructor(public statusCode: number) {
    super(`Received unexpected response code ${statusCode}`)
  }
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("pushBody", () => {
  it("keeps a short body", () => {
    expect(pushBody("שלום לך")).toBe("שלום לך")
    expect(pushBody("א".repeat(300))).toBe("א".repeat(300))
  })

  it("cuts a 2000-character broadcast at a word boundary, at most 300 with …", () => {
    const body = Array.from({ length: 400 }, (_, i) => `מילה${i}`).join(" ")
    expect(body.length).toBeGreaterThan(2000)
    const cut = pushBody(body)
    expect(Array.from(cut).length).toBeLessThanOrEqual(300)
    expect(cut.endsWith("…")).toBe(true)
    // Ends with a whole word.
    const words = cut.slice(0, -1).split(" ")
    expect(body.split(" ")).toContain(words[words.length - 1])
    expect(body.startsWith(cut.slice(0, -1))).toBe(true)
  })

  it("cuts a body without spaces at the limit", () => {
    const cut = pushBody("x".repeat(2000))
    expect(cut).toBe(`${"x".repeat(299)}…`)
  })

  it("counts characters, not UTF-16 units", () => {
    const cut = pushBody("😀".repeat(400))
    expect(Array.from(cut)).toHaveLength(300)
  })
})

describe("outcomeOf", () => {
  it.each([
    [{ statusCode: 201 }, { kind: "delivered" }],
    [new FakeWebPushError(410), { kind: "gone" }],
    [new FakeWebPushError(404), { kind: "gone" }],
    [new FakeWebPushError(403), { kind: "error", code: "HTTP_403" }],
    [new FakeWebPushError(401), { kind: "error", code: "HTTP_401" }],
    [new FakeWebPushError(500), { kind: "error", code: "HTTP_500" }],
    [
      new Error("socket hang up https://push.example.test/x"),
      { kind: "error", code: "NETWORK" },
    ],
  ])("%o -> %o", (input, expected) => {
    expect(outcomeOf(input)).toEqual(expected)
  })
})

describe("vapidFromEnv", () => {
  it("needs all three values", () => {
    expect(
      vapidFromEnv({
        VAPID_SUBJECT: " mailto:a@example.test ",
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
      })
    ).toEqual(VAPID)
    expect(
      vapidFromEnv({
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
      })
    ).toBeNull()
  })

  it.each(["you@example.test", "http://example.test", "mailto:", "https://"])(
    "an invalid subject %j -> null (the route answers 503)",
    (subject) => {
      expect(
        vapidFromEnv({
          VAPID_SUBJECT: subject,
          NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub",
          VAPID_PRIVATE_KEY: "priv",
        })
      ).toBeNull()
    }
  )

  it("accepts an https: subject", () => {
    expect(
      vapidFromEnv({
        VAPID_SUBJECT: "https://example.test",
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
      })
    ).toMatchObject({ subject: "https://example.test" })
  })
})

describe("runPushWorker", () => {
  it("sends to every subscription with the payload contract and a 24-hour TTL", async () => {
    const { client, calls } = fakeClient([[job("j1", ["s1", "s2"])]])
    const send = vi.fn<SendPush>(async () => ({ statusCode: 201 }))
    const result = await runPushWorker(VAPID, { client, send })

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0, skipped: 0 })
    expect(send).toHaveBeenCalledTimes(2)
    const [subscription, payload, options] = send.mock.calls[0]
    expect(subscription).toEqual({
      endpoint: "https://push.example.test/s1",
      keys: { p256dh: "p", auth: "a" },
    })
    expect(JSON.parse(payload)).toEqual({
      title: "כותרת",
      body: "גוף",
      target_path: "/me/bookings",
    })
    expect(options).toMatchObject({ TTL: 86400, vapidDetails: VAPID })
    expect(finishes(calls)).toEqual([
      { p_job_id: "j1", p_delivered: ["s1", "s2"], p_gone: [], p_error: "" },
    ])
    expect(calls[0]).toEqual({ fn: "claim_push_jobs", args: { p_limit: 25 } })
  })

  it("a 500 on one subscription: the other is delivered, the job has an error", async () => {
    const { client, calls } = fakeClient([[job("j1", ["s1", "s2"])]])
    const send = vi.fn<SendPush>(async (sub) => {
      if (sub.endpoint.endsWith("s2")) throw new FakeWebPushError(500)
      return { statusCode: 201 }
    })
    const result = await runPushWorker(VAPID, { client, send })
    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1, skipped: 0 })
    expect(finishes(calls)).toEqual([
      { p_job_id: "j1", p_delivered: ["s1"], p_gone: [], p_error: "HTTP_500" },
    ])
  })

  it("410 and 404 are gone, 403 is an error that keeps the subscription", async () => {
    const { client, calls } = fakeClient([[job("j1", ["s1", "s2", "s3"])]])
    const codes: Record<string, number> = { s1: 410, s2: 404, s3: 403 }
    const send = vi.fn<SendPush>(async (sub) => {
      throw new FakeWebPushError(codes[sub.endpoint.split("/").pop()!])
    })
    await runPushWorker(VAPID, { client, send })
    expect(finishes(calls)).toEqual([
      {
        p_job_id: "j1",
        p_delivered: [],
        p_gone: ["s1", "s2"],
        p_error: "HTTP_403",
      },
    ])
  })

  it("only gone subscriptions: no error, so the job is sent", async () => {
    const { client, calls } = fakeClient([[job("j1", ["s1"])]])
    const send = vi.fn<SendPush>(async () => {
      throw new FakeWebPushError(410)
    })
    const result = await runPushWorker(VAPID, { client, send })
    expect(finishes(calls)[0]).toMatchObject({ p_gone: ["s1"], p_error: "" })
    expect(result.sent).toBe(1)
  })

  it("the error never carries the endpoint or the message", async () => {
    const { client, calls } = fakeClient([[job("j1", ["s1"])]])
    const send = vi.fn<SendPush>(async () => {
      throw new Error("connect ECONNREFUSED https://push.example.test/s1")
    })
    await runPushWorker(VAPID, { client, send })
    expect(finishes(calls)[0].p_error).toBe("NETWORK")
  })

  it("a long body is cut in the push only", async () => {
    const long = "מילה ".repeat(400).trim()
    const { client } = fakeClient([[job("j1", ["s1"], long)]])
    const send = vi.fn<SendPush>(async () => ({ statusCode: 201 }))
    await runPushWorker(VAPID, { client, send })
    const body = JSON.parse(send.mock.calls[0][1]).body as string
    expect(Array.from(body).length).toBeLessThanOrEqual(300)
    expect(body.endsWith("…")).toBe(true)
  })

  it("claims again after a full batch, stops on an empty one", async () => {
    const full = Array.from({ length: 25 }, (_, i) => job(`j${i}`, ["s"]))
    const { client, calls } = fakeClient([full, [job("last", ["s"])]])
    const send = vi.fn<SendPush>(async () => ({ statusCode: 201 }))
    const result = await runPushWorker(VAPID, { client, send })
    expect(result.claimed).toBe(26)
    expect(calls.filter((c) => c.fn === "claim_push_jobs")).toHaveLength(2)
  })

  it("stops claiming after the time budget", async () => {
    const full = Array.from({ length: 25 }, (_, i) => job(`j${i}`, ["s"]))
    const { client, calls } = fakeClient([full, full])
    let t = 0
    const now = () => (t += 30_000)
    const send = vi.fn<SendPush>(async () => ({ statusCode: 201 }))
    await runPushWorker(VAPID, { client, send, now, budgetMs: 45_000 })
    expect(calls.filter((c) => c.fn === "claim_push_jobs")).toHaveLength(1)
  })

  it("a failed claim ends the run quietly", async () => {
    const client = {
      rpc: vi.fn(async () => ({ data: null, error: { code: "XX000" } })),
    }
    const send = vi.fn<SendPush>()
    const result = await runPushWorker(VAPID, { client: client as never, send })
    expect(result).toEqual({ claimed: 0, sent: 0, failed: 0, skipped: 0 })
    expect(send).not.toHaveBeenCalled()
  })

  it("a finish that is not recorded counts as skipped", async () => {
    const { client } = fakeClient([[job("j1", ["s1"])]], () => "skipped")
    const send = vi.fn<SendPush>(async () => ({ statusCode: 201 }))
    const result = await runPushWorker(VAPID, { client, send })
    expect(result).toEqual({ claimed: 1, sent: 0, failed: 0, skipped: 1 })
  })
})
