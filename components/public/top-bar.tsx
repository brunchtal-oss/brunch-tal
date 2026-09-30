import Link from "next/link"

import { Wordmark } from "@/components/shared/wordmark"
import { buttonVariants } from "@/components/ui/button"
import { shellCopy } from "@/lib/copy/shell"

// Public top-bar (DESIGN.md › top-bar): background colour, wordmark at
// inline-start, "כניסה לאזור האישי" (button-secondary) at inline-end. The menu
// button and menu-sheet come with the public pages in 5.2.
export function TopBar() {
  return (
    <header className="bg-background">
      <div className="mx-auto flex max-w-[720px] flex-wrap items-center justify-between gap-3 px-6 py-5">
        <Wordmark href="/" />
        <Link
          href="/login"
          className={buttonVariants({
            variant: "outline",
            className:
              "min-h-11 border-foreground bg-transparent px-4 text-[13px] font-semibold",
          })}
        >
          {shellCopy.public.customerLogin}
        </Link>
      </div>
    </header>
  )
}
