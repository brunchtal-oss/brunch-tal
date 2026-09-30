import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { SignOutButton } from "@/components/shared/sign-out-button"
import { shellCopy } from "@/lib/copy/shell"

export const metadata: Metadata = {
  title: shellCopy.admin.moreTitle,
}

// "עוד" gathers the admin screens that are not in the tab bar. For now only
// sign-out; each later screen adds its link here.
export default function AdminMorePage() {
  return (
    <>
      <PageHeading>{shellCopy.admin.moreTitle}</PageHeading>
      <SignOutButton className="max-w-xs" />
    </>
  )
}
