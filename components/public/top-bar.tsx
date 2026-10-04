import Link from "next/link"

import { Wordmark } from "@/components/shared/wordmark"
import { shellCopy } from "@/lib/copy/shell"

import { MenuSheet } from "./menu-sheet"

// Public top-bar (user decisions 2026-10-04, over DESIGN › top-bar): its own
// colour, primary olive with on-primary text (8.46:1), sticky at the top of
// the screen. The menu button and, right after it with a little air, the
// business name as the link home at inline-start; "כניסה לאזור האישי" at
// inline-end.
export function TopBar({ name }: { name: string }) {
  return (
    <header
      data-top-bar=""
      className="sticky top-0 z-30 bg-primary text-primary-foreground"
    >
      <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <MenuSheet name={name} />
          <Wordmark
            href="/"
            name={name}
            className="min-w-0 leading-[1.1] text-primary-foreground"
          />
        </div>
        <Link
          href="/login"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-[4px] border border-primary-foreground px-2.5 py-1 text-center text-[13px] leading-[1.2] font-semibold text-primary-foreground hover:bg-primary-foreground/10"
        >
          {shellCopy.public.customerLogin}
        </Link>
      </div>
    </header>
  )
}
