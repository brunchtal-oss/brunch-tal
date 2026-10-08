import Link from "next/link"
import { MapPinIcon, PhoneIcon } from "lucide-react"

import { telHref } from "@/components/public/contact-details"
import type { BusinessDetailsContent } from "@/lib/content/schema"
import { pwaCopy } from "@/lib/copy/pwa"
import { shellCopy } from "@/lib/copy/shell"
import { cn } from "@/lib/utils"

import { SocialIcon, socialKind } from "./social-icon"

const copy = shellCopy.public

const ROW = "inline-flex min-h-11 items-center gap-3"
const ICON = "size-5 shrink-0 text-background/70"
const TEXT_LINK =
  "inline-flex min-h-11 items-center underline underline-offset-[3px] hover:text-background"
const SMALL_LINK =
  "inline-flex min-h-11 items-center leading-none hover:text-background"

// The public footer (stories 5.2, 5.3, 5.5, 5.9; the look the user chose on
// 2026-10-08): its own ink band with cream text, one centred column. The
// phone (tel:) and the address (opening the navigation link in a new tab
// when there is one) as icon rows; the links Tal adds in the content editor
// (site › footer), an Instagram or Facebook address as its brand icon and
// any other as text, each in a new tab; a short olive rule; then one small
// line: the legal links whose pages are published (legal), the install
// guide and the admin entrance. No business name and no footer text (user
// decision 2026-10-04). A missing field, or no links, shows nothing.
export function SiteFooter({
  details,
  legal,
  links = [],
  className,
}: {
  details: BusinessDetailsContent | null
  legal: readonly { href: string; label: string }[]
  links?: readonly { label: string; url: string }[]
  className?: string
}) {
  return (
    <footer
      data-site-footer=""
      className={cn("mt-12 bg-foreground text-background", className)}
    >
      <div className="mx-auto flex max-w-[720px] flex-col items-center gap-2 px-6 pt-4 pb-3 text-center">
        {(details?.phone || details?.address) && (
          <ul className="flex flex-col items-center gap-0 text-[15px]">
            {details.phone && (
              <li>
                <a href={telHref(details.phone)} className={ROW}>
                  <PhoneIcon aria-hidden strokeWidth={1.5} className={ICON} />
                  <span className="sr-only">{copy.contact.phone} </span>
                  <bdi dir="ltr">{details.phone}</bdi>
                </a>
              </li>
            )}
            {details.address && (
              <li>
                {details.navigation_url ? (
                  <a
                    href={details.navigation_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={ROW}
                  >
                    <MapPinIcon
                      aria-hidden
                      strokeWidth={1.5}
                      className={ICON}
                    />
                    <span className="sr-only">{copy.contact.address} </span>
                    {details.address}
                    <span className="sr-only">
                      {" "}
                      {copy.contact.opensOutside}
                    </span>
                  </a>
                ) : (
                  <span className={ROW}>
                    <MapPinIcon
                      aria-hidden
                      strokeWidth={1.5}
                      className={ICON}
                    />
                    <span className="sr-only">{copy.contact.address} </span>
                    {details.address}
                  </span>
                )}
              </li>
            )}
          </ul>
        )}

        {links.length > 0 && (
          <ul
            data-footer-links=""
            className="flex flex-wrap items-center justify-center gap-x-4 text-[15px]"
          >
            {links.map((link, index) => {
              const kind = socialKind(link.url)
              return (
                <li key={index}>
                  {kind ? (
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${link.label} ${copy.contact.opensOutside}`}
                      className="inline-flex size-11 items-center justify-center rounded-lg hover:text-background/80"
                    >
                      <SocialIcon kind={kind} className="size-6" />
                    </a>
                  ) : (
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={TEXT_LINK}
                    >
                      {link.label}
                      <span className="sr-only">
                        {" "}
                        {copy.contact.opensOutside}
                      </span>
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <span aria-hidden className="h-px w-12 bg-brand-accent" />

        <nav
          aria-label={shellCopy.nav.footerLabel}
          className="flex flex-wrap items-center justify-center gap-x-4 gap-y-0 text-[13px] text-background/75"
        >
          {legal.map((item) => (
            <Link key={item.href} href={item.href} className={SMALL_LINK}>
              {item.label}
            </Link>
          ))}
          <Link href="/install" className={SMALL_LINK}>
            {pwaCopy.footerLink}
          </Link>
          <Link href="/admin/login" className={SMALL_LINK}>
            {copy.adminLogin}
          </Link>
        </nav>
      </div>
    </footer>
  )
}
