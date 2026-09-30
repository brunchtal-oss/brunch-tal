import { randomUUID } from "node:crypto"
import { Suspense } from "react"
import type { Metadata } from "next"

import { authCopy } from "@/lib/copy/auth"
import { getResetTokenView } from "@/lib/server/privileged/reset"

import { ResetForm } from "./reset-form"

// Token route (AD-16): no-referrer and no-store headers come from
// next.config.mjs; no third-party resources; the path is not logged.
export const metadata: Metadata = {
  title: authCopy.reset.title,
  referrer: "no-referrer",
  robots: { index: false, follow: false },
}

export default function ResetPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <h1 className="font-heading text-2xl font-semibold">
        {authCopy.reset.title}
      </h1>
      <Suspense
        fallback={
          <p className="text-muted-foreground">{authCopy.reset.loading}</p>
        }
      >
        <ResetContent params={params} />
      </Suspense>
    </main>
  )
}

async function ResetContent({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  // Opening the link only reads its public state; it never consumes it.
  const state = await getResetTokenView(token)
  // One idempotency key per page load (AD-5), sent with every attempt, so a
  // retry after a lost response completes instead of failing as LINK_USED.
  const idempotencyKey = randomUUID()

  return (
    <ResetForm
      token={token}
      idempotencyKey={idempotencyKey}
      linkState={state}
    />
  )
}
