import { randomUUID } from "node:crypto"
import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { cleanToken } from "@/lib/auth/clean-token"
import { toSessionRole, type SessionRole } from "@/lib/auth/destination"
import type { ConflictReason } from "@/lib/auth/join-link-state"
import { getWhatsappHref } from "@/lib/content/business-details"
import { getPhotoConsentContent } from "@/lib/content/join-form"
import { getPublishedPageSlugs } from "@/lib/content/pages"
import { joinCopy } from "@/lib/copy/join"
import { errorMessage } from "@/lib/errors"
import { callRpc } from "@/lib/rpc"
import { getJoinTokenView } from "@/lib/server/privileged/join"
import { createClient } from "@/lib/supabase/server"
import { formatLocalDate } from "@/lib/time"

import { ClaimJoin, ClaimScreen, ExistingAccountLogin } from "./claim-join"
import { JoinForm } from "./join-form"
import { existingAccountScreen, type FormLinkState } from "./join-view"

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
  // The heading belongs to the link state (the existing-account screens have
  // none), so it is rendered inside the content.
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{joinCopy.loading}</p>}
    >
      <JoinContent params={params} />
    </Suspense>
  )
}

// The session's role, or null for a guest (or a failed lookup: the login
// screen is shown).
// The user id (claims.sub) stays on the server: it is only compared with
// the link's bound account.
async function currentSession(): Promise<{
  role: SessionRole
  userId: string | null
} | null> {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) return null
  const result = await callRpc(supabase, "get_my_session_role")
  if (!result.ok) return null
  const sub = claims.claims.sub
  return {
    role: toSessionRole(result.data),
    userId: typeof sub === "string" && sub ? sub : null,
  }
}

async function JoinContent({ params }: { params: Promise<{ token: string }> }) {
  // Invisible marks from a pasted WhatsApp message would read as "expired".
  const token = cleanToken((await params).token)
  // Opening the link only reads its public state; it never consumes it.
  const [view, contactHref] = await Promise.all([
    getJoinTokenView(token),
    getWhatsappHref(),
  ])

  // The details matched an existing account (story 2.3): log in to it, then
  // confirm. Nothing is bound until the confirm button is pressed.
  if (view.state === "awaiting_login") {
    const session = await currentSession()
    const screen = existingAccountScreen(
      session?.role ?? null,
      session?.userId != null &&
        view.boundUserId != null &&
        session.userId === view.boundUserId
    )
    if (screen === "login") {
      // "Back to form": the same form as an active link, empty.
      return (
        <ExistingAccountLogin
          token={token}
          form={
            <>
              <PageHeading>{joinCopy.title}</PageHeading>
              <JoinFormContent
                token={token}
                linkState="active"
                conflictReason={null}
                contactHref={contactHref}
                productName={view.productName}
                amountAgorot={view.amountAgorot}
              />
            </>
          }
        />
      )
    }
    if (screen === "other_account") {
      return (
        <ClaimScreen
          state={{ status: "other_account" }}
          pending={false}
          token={token}
          idempotencyKey=""
          productName={null}
          amountAgorot={null}
        />
      )
    }
    return (
      <ClaimJoin
        token={token}
        idempotencyKey={randomUUID()}
        productName={view.productName}
        amountAgorot={view.amountAgorot}
        contactHref={contactHref}
      />
    )
  }

  return (
    <>
      <PageHeading>{joinCopy.title}</PageHeading>
      <JoinFormContent
        token={token}
        linkState={view.state}
        conflictReason={view.conflictReason}
        contactHref={contactHref}
        productName={view.productName}
        amountAgorot={view.amountAgorot}
      />
    </>
  )
}

async function JoinFormContent({
  token,
  linkState,
  conflictReason,
  contactHref,
  productName,
  amountAgorot,
}: {
  token: string
  linkState: FormLinkState
  conflictReason: ConflictReason | null
  contactHref: string | null
  productName: string | null
  amountAgorot: number | null
}) {
  const [photoConsent, legalSlugs] = await Promise.all([
    getPhotoConsentContent(),
    getPublishedPageSlugs(["privacy"]),
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
      linkState={linkState}
      conflictReason={conflictReason}
      contactHref={contactHref}
      productName={productName}
      amountAgorot={amountAgorot}
      photoConsent={photoConsent}
      today={today}
      privacyHref={legalSlugs.includes("privacy") ? "/privacy" : null}
    />
  )
}
