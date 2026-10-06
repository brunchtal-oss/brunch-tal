import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { PageHeading } from "@/components/shared/page-heading"
import { shellCopy } from "@/lib/copy/shell"
import { adminMoreNav } from "@/lib/nav"

export const metadata: Metadata = {
  title: shellCopy.admin.moreTitle,
}

// "עוד" gathers the admin screens that are not in the tab bar, one row each
// (lib/nav.ts › adminMoreNav); sign-out is in the top-bar. The site is RTL
// only, so the chevron points to the inline end.

export default function AdminMorePage() {
  return (
    <>
      <PageHeading>{shellCopy.admin.moreTitle}</PageHeading>
      <ul className="flex flex-col">
        {adminMoreNav.map((row) => (
          <li key={row.href} className="border-b border-border">
            <Link
              href={row.href}
              className="flex min-h-12 items-center justify-between gap-3 py-3 text-base font-semibold"
            >
              {row.label}
              <ChevronLeftIcon
                aria-hidden
                strokeWidth={1.5}
                className="size-5 shrink-0 text-muted-foreground"
              />
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}
