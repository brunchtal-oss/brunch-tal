import Link from "next/link"
import { GlobeIcon, LogOutIcon } from "lucide-react"

import { signOutAction } from "@/lib/auth/sign-out"
import { shellCopy } from "@/lib/copy/shell"
import { cn } from "@/lib/utils"

import { Wordmark } from "./wordmark"

// The top-bar of /me and /admin (story 5.7; DESIGN › top-bar, user
// decisions 2026-10-04 and 2026-10-06): the same olive band as the public
// bar (primary with on-primary text, 8.46:1), sticky at the top of the
// screen. The business name links to the surface's home at inline-start;
// at inline-end the bell (`bell`, streamed in by the layout) and sign-out,
// each a 44×44 icon button with its own name. The admin bar alone has
// "מעבר לאתר" before the bell, to / in the same tab (user decision
// 2026-10-06). This is the only sign-out in
// both surfaces. app/globals.css gives [data-top-bar] its scroll-padding and
// an on-primary focus ring.
export function AppTopBar({
  home,
  bell,
  wide = false,
}: {
  home: "/me" | "/admin"
  bell: React.ReactNode
  // The admin bar spans the whole width above the side-nav from lg.
  wide?: boolean
}) {
  return (
    <header
      data-top-bar=""
      className="sticky top-0 z-30 bg-primary text-primary-foreground"
    >
      <div
        className={cn(
          "mx-auto flex h-16 max-w-[720px] items-center justify-between gap-3 ps-6 pe-3",
          wide && "lg:max-w-none lg:ps-6 lg:pe-6"
        )}
      >
        <Wordmark
          href={home}
          className="min-w-0 leading-[1.1] text-primary-foreground"
        />
        <div className="flex shrink-0 items-center gap-1">
          {home === "/admin" && (
            <Link
              href="/"
              aria-label={shellCopy.toSite}
              className="inline-flex size-11 items-center justify-center rounded-[4px] text-primary-foreground hover:bg-primary-foreground/10"
            >
              <GlobeIcon aria-hidden strokeWidth={1.5} className="size-6" />
            </Link>
          )}
          {bell}
          <form action={signOutAction}>
            <button
              type="submit"
              aria-label={shellCopy.signOut}
              className="inline-flex size-11 items-center justify-center rounded-[4px] text-primary-foreground hover:bg-primary-foreground/10"
            >
              <LogOutIcon
                aria-hidden
                strokeWidth={1.5}
                className="size-6 rtl:-scale-x-100"
              />
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
