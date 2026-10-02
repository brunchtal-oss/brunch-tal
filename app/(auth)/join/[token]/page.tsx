import { randomUUID } from "node:crypto"
import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { cleanToken } from "@/lib/auth/clean-token"
import { getPhotoConsentContent } from "@/lib/content/join-form"
import { joinCopy } from "@/lib/copy/join"
import { errorMessage } from "@/lib/errors"
import { getJoinTokenView } from "@/lib/server/privileged/join"
import { formatLocalDate } from "@/lib/time"

import { JoinForm } from "./join-form"

// Token route (AD-16): no-referrer and no-store headers come from
// next.config.mjs; no third-party resources; the path is not logged.
export const metadata: Metadata = {
  title: joinCopy.title,
  referrer: "no-referrer",
  robots: { index: false, follow: false },
}

export default function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  return (
    <>
      <PageHeading>{joinCopy.title}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{joinCopy.loading}</p>}
      >
        <JoinContent params={params} />
      </Suspense>
    </>
  )
}

async function JoinContent({ params }: { params: Promise<{ token: string }> }) {
  // Invisible marks from a pasted WhatsApp message would read as "expired".
  const token = cleanToken((await params).token)
  // Opening the link only reads its public state; it never consumes it.
  const [view, photoConsent] = await Promise.all([
    getJoinTokenView(token),
    getPhotoConsentContent(),
  ])
  // The photo question is required (CAP-40); without its published wording
  // the form cannot be answered.
  if (!photoConsent) {
    return (
      <Alert>
        <AlertTitle className="whitespace-normal">
          {errorMessage("SERVER_ERROR")}
        </AlertTitle>
      </Alert>
    )
  }
  // One idempotency key per page load (AD-5), sent with every attempt.
  const idempotencyKey = randomUUID()
  // Only the date picker's upper bound; join_complete checks the local today.
  const today = formatLocalDate(new Date())

  return (
    <JoinForm
      token={token}
      idempotencyKey={idempotencyKey}
      linkState={view.state}
      productName={view.productName}
      amountAgorot={view.amountAgorot}
      photoConsent={photoConsent}
      today={today}
    />
  )
}
