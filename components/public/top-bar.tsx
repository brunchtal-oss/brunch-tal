import Link from "next/link"

import { Wordmark } from "@/components/shared/wordmark"
import { shellCopy } from "@/lib/copy/shell"

import { MenuSheet } from "./menu-sheet"

// Public top-bar (user decision 2026-10-04, over DESIGN › top-bar): its own
// colour, primary olive with on-primary text (8.46:1), sticky at the top of
// the screen. The menu button at inline-start, the business name centred as
// the link home, "כניסה לאזור האישי" at inline-end. The two sides take equal
// columns so the name stays centred; at 360px the login label may wrap to
// two lines inside its 44px target.
export function TopBar({ name }: { name: string }) {
  return (
    <header
      data-top-bar=""
      className="sticky top-0 z-30 bg-primary text-primary-foreground"
    >
      <div className="mx-auto grid max-w-[720px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-2.5">
        <div className="justify-self-start">
          <MenuSheet name={name} />
        </div>
        <Wordmark
          href="/"
          name={name}
          className="max-w-[46vw] justify-center text-center leading-[1.1] text-primary-foreground sm:max-w-none"
        />
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center justify-center justify-self-end rounded-[4px] border border-primary-foreground px-2.5 py-1 text-center text-[13px] leading-[1.2] font-semibold text-primary-foreground hover:bg-primary-foreground/10"
        >
          {shellCopy.public.customerLogin}
        </Link>
      </div>
    </header>
  )
}
