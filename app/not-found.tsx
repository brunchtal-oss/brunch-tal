import type { Metadata } from "next"
import Link from "next/link"

import { buttonClass } from "@/components/shared/button-class"
import { PageHeading } from "@/components/shared/page-heading"
import { PlateMark } from "@/components/shared/plate-mark"
import { SkipLink } from "@/components/shared/skip-link"
import { Wordmark } from "@/components/shared/wordmark"
import { getBusinessName } from "@/lib/content/business-details"
import { shellCopy } from "@/lib/copy/shell"

const copy = shellCopy.public.notFound

// Next adds the noindex of a 404 itself.
export const metadata: Metadata = { title: copy.title }

// Any address that matches no page (fix-search-ready), status 404. Outside
// the public shell, like /offline: the business name on top, the empty
// plate, the h1, one line on why, and the two ways on: the sessions (the
// primary action, as on /sessions/[id]'s not-found) and the home page.
export default async function NotFound() {
  const name = await getBusinessName()
  return (
    <div className="flex min-h-svh flex-col">
      <SkipLink />
      <header className="mx-auto w-full max-w-[720px] px-6 pt-3">
        <Wordmark href="/" name={name} />
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center px-6 pt-16 pb-10 text-center"
      >
        <PlateMark />
        <PageHeading className="mt-8 text-[34px] leading-[1.15] text-balance">
          {copy.title}
        </PageHeading>
        <p className="mt-3 text-[17px] leading-[1.65] text-balance text-muted-foreground">
          {copy.body}
        </p>
        <Link
          href="/sessions"
          className={buttonClass({
            size: "lg",
            className: "mt-8 h-12 rounded-lg px-6 text-base font-semibold",
          })}
        >
          {copy.toSessions}
        </Link>
        <Link
          href="/"
          className="mt-3 inline-flex min-h-11 items-center text-[15px] underline decoration-1 underline-offset-[3px]"
        >
          {copy.toHome}
        </Link>
      </main>
    </div>
  )
}
