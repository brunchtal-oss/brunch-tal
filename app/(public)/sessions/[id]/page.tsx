import { cache, Suspense } from "react"
import type { Metadata, ResolvingMetadata } from "next"
import { notFound } from "next/navigation"
import { connection } from "next/server"

import { JsonLd } from "@/components/public/json-ld"
import {
  PublicSessionAction,
  PublicSessionView,
} from "@/components/public/public-sessions"
import { buttonClass } from "@/components/shared/button-class"
import { PaymentNotice } from "@/components/shared/payment-notice"
import { PurchaseSheet } from "@/components/shared/purchase-sheet"
import { getViewerRole } from "@/lib/auth/viewer-role"
import {
  businessNameOf,
  getBusinessDetails,
  guestWhatsappHref,
} from "@/lib/content/business-details"
import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import { readPaymentOutcome } from "@/lib/payments/payment-outcome"
import { canBuy, NO_PURCHASE } from "@/lib/payments/purchase-options"
import { sessionMetadata } from "@/lib/seo/metadata"
import { buildEventData } from "@/lib/seo/structured-data"
import { siteUrl } from "@/lib/site-url"
import { getPublicSession } from "@/lib/sessions/public"

import { loadGuestPurchaseOptions, startGuestPurchaseAction } from "./actions"

// One read per request, shared by the metadata and the page.
const getSession = cache((id: string) => getPublicSession(id))

// The session's own metadata (sessionMetadata, fix-search-ready); dynamic
// like the page (AD-2).
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
  parent: ResolvingMetadata
): Promise<Metadata> {
  const { id } = await params
  await connection()
  const session = await getSession(id)
  if (!session) return sessionMetadata(null, { openGraph: null, twitter: null })
  const { openGraph, twitter } = await parent
  return sessionMetadata(session, { openGraph, twitter })
}

// One public session (story 5.16, CAP-1, CAP-12): the concept-header, the
// display price when Tal set one, the action (a signed-in customer:
// "להרשמה" to the session in her area; anyone else: contact or log in) and
// the description. Only a published session that has not started; anything
// else is notFound(). Dynamic (AD-2), inside <Suspense>; a read error goes
// to the error boundary.
export default function PublicSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <Suspense
      fallback={
        <p className="mx-auto w-full max-w-[720px] px-6 pt-8 text-center text-muted-foreground">
          {shellCopy.loading}
        </p>
      }
    >
      <SessionContent params={params} searchParams={searchParams} />
    </Suspense>
  )
}

export async function SessionContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  await connection()
  const [session, role, details] = await Promise.all([
    getSession(id),
    getViewerRole(),
    getBusinessDetails(),
  ])
  if (!session) notFound()
  // Online payments (PR B): a guest may buy here only while it is on
  // (kill switch, published purchase terms, public_online_purchase).
  const [options, outcome] = await Promise.all([
    role === null ? loadGuestPurchaseOptions(session.id) : NO_PURCHASE,
    // The outcome of an online payment: only after a real return.
    readPaymentOutcome(query),
  ])
  const contactHref = guestWhatsappHref(details)

  // The session as an Event, only what the page shows (fix-seo-editor). A
  // session the site does not show is notFound() above, so it has none.
  return (
    <div className="pb-12">
      <JsonLd
        data={buildEventData({
          session,
          name: businessNameOf(details),
          details,
          url: siteUrl(),
        })}
      />
      {/* The outcome of an online payment, persistent, at the top. */}
      {outcome && (
        <div className="mx-auto w-full max-w-[720px] px-6 pt-4 empty:hidden">
          <PaymentNotice
            outcome={outcome}
            surface="session"
            contactHref={contactHref}
          />
        </div>
      )}
      <PublicSessionView
        session={session}
        action={
          <div className="flex flex-col gap-4">
            <PublicSessionAction
              sessionId={session.id}
              customer={role === "customer"}
              whatsappHref={contactHref}
              purchase={
                canBuy(options) ? (
                  <PurchaseSheet
                    products={options.products}
                    eventId={session.id}
                    start={startGuestPurchaseAction}
                    contactHref={contactHref}
                    trigger={customerCopy.purchase.buy}
                    triggerClassName={buttonClass({
                      size: "lg",
                      className:
                        "h-12 w-full max-w-xs rounded-[4px] px-6 text-base font-semibold",
                    })}
                  />
                ) : null
              }
            />
          </div>
        }
      />
    </div>
  )
}
