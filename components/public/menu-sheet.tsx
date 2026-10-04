"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { MenuIcon, XIcon } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { shellCopy } from "@/lib/copy/shell"
import { currentPublicHref, publicNav } from "@/lib/nav"
import { cn } from "@/lib/utils"

const copy = shellCopy.public

// The public menu (DESIGN › menu-sheet, EXPERIENCE › menu-sheet): a Sheet
// from inline-start, the menu button's side (story 5.2), min(320px, 85vw), card background over a 40%
// ink scrim (app/globals.css › [data-menu-sheet]). A modal dialog named
// "תפריט": focus starts on the first page, is trapped, and Esc, the X, the
// scrim or choosing a page close it. Focus returns to the menu button, except
// after choosing a page: RouteFocus then moves it to the new page's h1.
export function MenuSheet({ name }: { name: string }) {
  const [open, setOpen] = useState(false)
  const firstLink = useRef<HTMLAnchorElement>(null)
  const navigating = useRef(false)

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) navigating.current = false
        setOpen(next)
      }}
    >
      <SheetTrigger
        aria-label={copy.menu}
        className="inline-flex size-11 items-center justify-center rounded-[4px] text-primary-foreground hover:bg-primary-foreground/10"
      >
        <MenuIcon aria-hidden strokeWidth={1.5} className="size-6" />
      </SheetTrigger>
      <SheetContent
        // shadcn's Sheet names physical sides; in this RTL-only site "right"
        // is inline-start, where the menu button is.
        // eslint-disable-next-line no-restricted-syntax
        side="right"
        showCloseButton={false}
        data-menu-sheet=""
        aria-modal="true"
        initialFocus={firstLink}
        finalFocus={() => !navigating.current}
        className="gap-0 overflow-y-auto bg-card pb-[calc(1rem+env(safe-area-inset-bottom))] data-[side=right]:w-[min(320px,85vw)] data-[side=right]:sm:max-w-none"
      >
        <SheetTitle className="sr-only">{copy.menu}</SheetTitle>
        <div className="flex items-center justify-between gap-3 ps-6 pe-3 pt-3 pb-3">
          <span className="font-heading text-xl leading-none font-light tracking-[0.01em]">
            {name}
          </span>
          <SheetClose
            aria-label={copy.closeMenu}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-foreground hover:bg-muted"
          >
            <XIcon aria-hidden strokeWidth={1.5} className="size-6" />
          </SheetClose>
        </div>
        <MenuLinks
          firstLink={firstLink}
          onChoose={(samePage) => {
            // The page already shown: no navigation, so focus goes back to
            // the menu button (RouteFocus does not run on the same path).
            navigating.current = !samePage
            setOpen(false)
          }}
        />
        <div className="mt-auto px-6 pt-6">
          <Link
            href="/login"
            onClick={() => {
              navigating.current = true
              setOpen(false)
            }}
            className={cn(
              buttonVariants(),
              "h-12 w-full rounded-[4px] px-[22px] text-base font-semibold"
            )}
          >
            {copy.customerLogin}
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// Rendered only while the sheet is open (the popup is unmounted when
// closed), so the pathname is read on the client, after navigation.
function MenuLinks({
  firstLink,
  onChoose,
}: {
  firstLink: React.RefObject<HTMLAnchorElement | null>
  onChoose: (samePage: boolean) => void
}) {
  const pathname = usePathname()
  const current = currentPublicHref(pathname)
  return (
    <nav aria-label={copy.pagesLabel} className="border-t border-border">
      <ul>
        {publicNav.map((item, index) => {
          const isCurrent = item.href === current
          return (
            <li key={item.href} className="border-b border-border">
              <Link
                ref={index === 0 ? firstLink : undefined}
                href={item.href}
                aria-current={isCurrent ? "page" : undefined}
                onClick={() => onChoose(item.href === pathname)}
                className={cn(
                  "flex min-h-12 items-center border-s-2 px-6 py-2.5 text-[17px] leading-[1.4] hover:bg-muted",
                  isCurrent
                    ? "border-brand-accent font-semibold"
                    : "border-transparent"
                )}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
