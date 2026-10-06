import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"

import { AllAttentionItems } from "../home/attention-list"

export const metadata: Metadata = {
  title: adminCopy.home.attention,
}

// /admin/attention (story 4.1, user decision 2026-10-06): every "לטיפול"
// item, newest first, from the same source and with the same task-row as
// the home. Rendered inside the admin shell's <Suspense> gate.
export default function AttentionPage() {
  return (
    <>
      <PageHeading>{adminCopy.home.attention}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <AllAttentionItems />
      </Suspense>
    </>
  )
}
