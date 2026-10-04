import Link from "next/link"

import { telHref } from "@/components/public/contact-details"
import type { BusinessDetailsContent } from "@/lib/content/schema"
import { pwaCopy } from "@/lib/copy/pwa"
import { shellCopy } from "@/lib/copy/shell"
import { cn } from "@/lib/utils"

const copy = shellCopy.public

const LINK =
  "inline-flex min-h-11 items-center underline underline-offset-[3px] hover:text-background"

// The public footer (stories 5.2, user decisions 2026-10-04): its own ink
// band, apart from the cream page and the olive top-bar (cream text,
// ~14:1). The phone (tel:) and the address (opening the navigation link
// when there is one), the legal links whose pages are published (legal; 5.5)
// and the fixed admin entrance. No business name and no footer text (user
// decision 2026-10-04). A missing field is not shown. The install guide
// link (story 5.9) is always there.
export function SiteFooter({
  details,
  legal,
  className,
}: {
  details: BusinessDetailsContent | null
  legal: readonly { href: string; label: string }[]
  className?: string
}) {
  return (
    <footer
      data-site-footer=""
      className={cn("mt-12 bg-foreground text-background", className)}
    >
      <div className="mx-auto flex max-w-[720px] flex-col gap-5 px-6 pt-8 pb-6">
        {(details?.phone || details?.address) && (
          <dl className="flex flex-col gap-1 text-[15px]">
            {details.phone && (
              <div className="flex items-center gap-2">
                <dt className="text-background/75">{copy.contact.phone}</dt>
                <dd>
                  <a href={telHref(details.phone)} className={LINK}>
                    <bdi dir="ltr">{details.phone}</bdi>
                  </a>
                </dd>
              </div>
            )}
            {details.address && (
              <div className="flex items-baseline gap-2">
                <dt className="shrink-0 text-background/75">
                  {copy.contact.address}
                </dt>
                <dd>
                  {details.navigation_url ? (
                    <a
                      href={details.navigation_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={LINK}
                    >
                      {details.address}
                      <span className="sr-only">
                        {" "}
                        {copy.contact.opensOutside}
                      </span>
                    </a>
                  ) : (
                    details.address
                  )}
                </dd>
              </div>
            )}
          </dl>
        )}

        <nav
          aria-label={shellCopy.nav.footerLabel}
          className="flex flex-wrap items-center gap-x-5 border-t border-background/20 pt-3 text-[13px] text-background/75"
        >
          {legal.map((item) => (
            <Link key={item.href} href={item.href} className={LINK}>
              {item.label}
            </Link>
          ))}
          <Link href="/install" className={LINK}>
            {pwaCopy.footerLink}
          </Link>
          <Link href="/admin/login" className={LINK}>
            {copy.adminLogin}
          </Link>
        </nav>
      </div>
    </footer>
  )
}
