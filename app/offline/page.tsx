import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { PlateMark } from "@/components/shared/plate-mark"
import { RetryButton } from "@/components/shared/retry-button"
import { SkipLink } from "@/components/shared/skip-link"
import { Wordmark } from "@/components/shared/wordmark"
import { pwaCopy } from "@/lib/copy/pwa"

const copy = pwaCopy.offline

export const metadata: Metadata = { title: copy.title }

// /offline (story 5.9): fully static (no database, no cookies), outside the
// shells. The service worker stores it at install and shows it when a
// navigation fails for lack of network. The wordmark on top, then the empty
// plate, the h1, why nothing can be done now and a retry.
export default function OfflinePage() {
  return (
    <div className="flex min-h-svh flex-col">
      <SkipLink />
      <header className="mx-auto w-full max-w-[720px] px-6 pt-3">
        <Wordmark href="/" />
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center px-6 pt-16 pb-10 text-center"
      >
        <PlateMark />
        <PageHeading className="mt-8">{copy.title}</PageHeading>
        <p className="mt-3 text-[17px] leading-[1.65] text-muted-foreground">
          {copy.text}
        </p>
        <div className="mt-8">
          <RetryButton>{copy.retry}</RetryButton>
        </div>
      </main>
    </div>
  )
}
