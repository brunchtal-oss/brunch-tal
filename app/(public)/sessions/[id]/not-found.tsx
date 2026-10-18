import Link from "next/link"

import { PublicPageHeading } from "@/components/public/public-page"
import { buttonClass } from "@/components/shared/button-class"
import { shellCopy } from "@/lib/copy/shell"

const copy = shellCopy.public.sessionNotFound

// /sessions/[id] when notFound() runs (story 3.17): a deleted session, one
// that is not published or has started, or a wrong link. The page's heading
// in the public pages' style, one line on why, and the way back to the
// sessions.
export default function SessionNotFound() {
  return (
    <div className="pb-12">
      <PublicPageHeading>{copy.title}</PublicPageHeading>
      <div className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-6 px-6 pt-4 text-center">
        <p className="text-[17px] leading-[1.65] text-balance text-muted-foreground">
          {copy.body}
        </p>
        <Link
          href="/sessions"
          className={buttonClass({
            size: "lg",
            className: "h-12 rounded-lg px-6 text-base font-semibold",
          })}
        >
          {copy.toSessions}
        </Link>
      </div>
    </div>
  )
}
