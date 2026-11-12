import { Suspense } from "react"
import type { Metadata } from "next"

import { resendVerificationAction } from "@/app/(auth)/verify-email/actions"
import { EmailVerificationBanner } from "@/components/shared/email-verification-banner"
import { PageHeading } from "@/components/shared/page-heading"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"

import { Home } from "./home"

export const metadata: Metadata = {
  title: shellCopy.customer.homeTitle,
}

// Rendered inside the layout's <Suspense> customer gate. Sign-out is in the
// top-bar and the unread count on its bell (story 5.7): home has no
// notifications section.
export default function MePage() {
  return (
    <>
      <PageHeading>
        <Suspense fallback={shellCopy.customer.greeting("")}>
          <Greeting />
        </Suspense>
      </PageHeading>
      {/* Story 6.11: above the home's sections while her email is not
          verified. */}
      <Suspense fallback={null}>
        <EmailVerificationBanner resend={resendVerificationAction} />
      </Suspense>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <Home />
      </Suspense>
    </>
  )
}

async function Greeting() {
  const supabase = await createClient()
  // RLS returns only the signed-in customer's own profile row.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .maybeSingle()

  return shellCopy.customer.greeting(profile?.full_name ?? "")
}
