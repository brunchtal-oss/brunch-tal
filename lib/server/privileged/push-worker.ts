import "server-only"

import webpush from "web-push"

import { callRpc } from "@/lib/rpc"

import { createServiceClient } from "./service-client"

// The push worker (story 5.8, AD-11, AD-12): called by POST /api/jobs/push,
// which pg_cron wakes when a job is ready. Claims jobs (claim_push_jobs,
// 2-minute lease), sends each to every subscription of the recipient that
// did not get it yet, and closes the attempt (finish_push_job). Push never
// touches bookings: a failure only retries the push. Logs hold job ids and
// status codes only, never an endpoint, key or text (AD-22).

const CLAIM_LIMIT = 25
// Vercel's maxDuration is 60 seconds; a new claim starts only before 45.
const RUN_BUDGET_MS = 45_000
// A push service keeps an undelivered message for a day at most: after that
// it is old news (the notification center still has it).
const TTL_SECONDS = 24 * 60 * 60
const SEND_TIMEOUT_MS = 10_000
// Web Push carries about 4KB; a broadcast may be 2000 characters.
export const PUSH_BODY_MAX = 300

export type VapidConfig = {
  subject: string
  publicKey: string
  privateKey: string
}

/**
 * The VAPID details from the server env, or null when one is missing or the
 * subject is not a mailto: or https: URL (web-push would throw on every
 * send, without a status, and burn every job's attempts; the route answers
 * 503 instead).
 */
export function vapidFromEnv(
  env: Record<string, string | undefined> = process.env
): VapidConfig | null {
  const subject = env.VAPID_SUBJECT?.trim() ?? ""
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ?? ""
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() ?? ""
  if (!subject || !publicKey || !privateKey) return null
  if (!/^(mailto:|https:\/\/)\S+$/.test(subject)) return null
  return { subject, publicKey, privateKey }
}

/**
 * The body of the push only, at most PUSH_BODY_MAX characters: cut at the
 * last space before the limit (or at the limit when there is none) and
 * ended with "…". The notification itself keeps the full text.
 */
export function pushBody(body: string, max = PUSH_BODY_MAX): string {
  const chars = Array.from(body)
  if (chars.length <= max) return body
  const head = chars.slice(0, max - 1).join("")
  const space = head.search(/\s\S*$/)
  const cut = space > 0 ? head.slice(0, space) : head
  return `${cut.trimEnd()}…`
}

export type ClaimedSubscription = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export type ClaimedJob = {
  job_id: string
  title: string
  body: string
  target_path: string
  subscriptions: ClaimedSubscription[]
}

/** web-push's sendNotification, or a fake in tests. */
export type SendPush = (
  subscription: webpush.PushSubscription,
  payload: string,
  options: webpush.RequestOptions
) => Promise<{ statusCode: number }>

type Client = Parameters<typeof callRpc>[0]

export type WorkerDeps = {
  client?: Client
  send?: SendPush
  now?: () => number
  budgetMs?: number
}

/**
 * The run's totals: jobs claimed, then by how this attempt ended: sent,
 * failed (an error: retried later or failed for good), skipped (the result
 * could not be recorded; the lease brings the job back).
 */
export type WorkerResult = {
  claimed: number
  sent: number
  failed: number
  skipped: number
}

type Outcome =
  { kind: "delivered" } | { kind: "gone" } | { kind: "error"; code: string }

// 2xx delivered; 404/410 the subscription is gone (deleted); anything else
// (401/403 included: a VAPID problem, not the device) an error, kept.
export function outcomeOf(result: unknown): Outcome {
  const status =
    typeof result === "object" &&
    result !== null &&
    "statusCode" in result &&
    typeof result.statusCode === "number"
      ? result.statusCode
      : null
  if (status === null) return { kind: "error", code: "NETWORK" }
  if (status >= 200 && status < 300) return { kind: "delivered" }
  if (status === 404 || status === 410) return { kind: "gone" }
  return { kind: "error", code: `HTTP_${status}` }
}

async function sendJob(
  job: ClaimedJob,
  vapid: VapidConfig,
  send: SendPush
): Promise<{ delivered: string[]; gone: string[]; error: string }> {
  const payload = JSON.stringify({
    title: job.title,
    body: pushBody(job.body),
    target_path: job.target_path,
  })
  const options: webpush.RequestOptions = {
    TTL: TTL_SECONDS,
    timeout: SEND_TIMEOUT_MS,
    vapidDetails: vapid,
  }
  const outcomes = await Promise.all(
    job.subscriptions.map(async (sub) => {
      let outcome: Outcome
      try {
        outcome = outcomeOf(
          await send(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
            options
          )
        )
      } catch (error) {
        // web-push rejects with WebPushError (statusCode) on a non-2xx
        // answer; anything else is a network or encryption failure.
        outcome = outcomeOf(error)
      }
      return { id: sub.id, outcome }
    })
  )
  const delivered = outcomes
    .filter((o) => o.outcome.kind === "delivered")
    .map((o) => o.id)
  const gone = outcomes
    .filter((o) => o.outcome.kind === "gone")
    .map((o) => o.id)
  const codes = [
    ...new Set(
      outcomes.flatMap((o) =>
        o.outcome.kind === "error" ? [o.outcome.code] : []
      )
    ),
  ]
  return { delivered, gone, error: codes.join(",").slice(0, 200) }
}

const defaultSend: SendPush = (subscription, payload, options) =>
  webpush.sendNotification(subscription, payload, options)

export async function runPushWorker(
  vapid: VapidConfig,
  deps: WorkerDeps = {}
): Promise<WorkerResult> {
  const client = deps.client ?? createServiceClient()
  const send = deps.send ?? defaultSend
  const now = deps.now ?? Date.now
  const deadline = now() + (deps.budgetMs ?? RUN_BUDGET_MS)
  const result: WorkerResult = { claimed: 0, sent: 0, failed: 0, skipped: 0 }

  while (now() < deadline) {
    const claimed = await callRpc(client, "claim_push_jobs", {
      p_limit: CLAIM_LIMIT,
    })
    if (!claimed.ok) break
    const jobs = (claimed.data ?? []) as unknown as ClaimedJob[]
    if (jobs.length === 0) break
    result.claimed += jobs.length

    await Promise.all(
      jobs.map(async (job) => {
        const sent = await sendJob(job, vapid, send)
        const finished = await callRpc(client, "finish_push_job", {
          p_job_id: job.job_id,
          p_delivered: sent.delivered,
          p_gone: sent.gone,
          p_error: sent.error,
        })
        const status = finished.ok
          ? (finished.data as { status?: string } | null)?.status
          : undefined
        if (status === "sent") result.sent += 1
        else if (status === "queued" || status === "failed") {
          result.failed += 1
          console.error("push.job_error", {
            job: job.job_id,
            status,
            codes: sent.error,
          })
        } else result.skipped += 1
      })
    )
    // Fewer than a full batch: nothing else is ready.
    if (jobs.length < CLAIM_LIMIT) break
  }

  return result
}
