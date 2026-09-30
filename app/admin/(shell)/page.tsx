import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { shellCopy } from "@/lib/copy/shell"

export const metadata: Metadata = {
  title: shellCopy.admin.homeTitle,
}

// Admin home. Its data (tasks, next session) arrives in 4.1.
export default function AdminHomePage() {
  return <PageHeading>{shellCopy.admin.homeTitle}</PageHeading>
}
