import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { customerCopy } from "@/lib/copy/customer"

export const metadata: Metadata = {
  title: customerCopy.sessionsTitle,
}

// Placeholder until the sessions list (E3); the button after a purchase
// already leads here (user decision 2026-10-01).
export default function MeSessionsPage() {
  return (
    <>
      <PageHeading>{customerCopy.sessionsTitle}</PageHeading>
      <p className="text-base text-muted-foreground">
        {customerCopy.sessionsSoon}
      </p>
    </>
  )
}
