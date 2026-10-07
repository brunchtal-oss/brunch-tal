import Link from "next/link"

import { StatusChip } from "@/components/shared/status-chip"
import { adminCopy } from "@/lib/copy/admin"

import { toExpiringCard } from "../home-items"
import { HomeSection } from "./home-section"
import { loadHome } from "./load-home"

const copy = adminCopy.home

// Cards about to expire (story 4.1): active cards with free entries whose
// days left are within business_settings.admin_expiring_days, by expiry, as
// decided by admin_get_home. The name links to the customer's card (story
// 4.2); the row itself is not a link.
export async function ExpiringCards() {
  const { expiring_cards: rows } = await loadHome()

  return (
    <HomeSection id="home-expiring" title={copy.expiring}>
      {rows.length === 0 ? (
        <p className="text-base text-muted-foreground">{copy.expiringEmpty}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => {
            const item = toExpiringCard(row)
            return (
              <li
                key={item.key}
                className="flex flex-col gap-0.5 border-b border-border py-4 first:border-t"
              >
                {/* The chip shares only the name's line, so the entries
                    line takes the full width; "בתוקף עד DD.MM" never
                    breaks apart (phone check 2026-10-06). */}
                <div className="flex items-start gap-2.5">
                  <p className="min-w-0 flex-1 text-base leading-[1.35] font-semibold">
                    {item.href ? (
                      <Link
                        href={item.href}
                        className="rounded-[4px] underline underline-offset-4"
                      >
                        <bdi className="break-words">{item.title}</bdi>
                      </Link>
                    ) : (
                      <bdi className="break-words">{item.title}</bdi>
                    )}
                  </p>
                  <StatusChip tone="warning" className="mt-0.5 shrink-0">
                    {copy.expiringChip}
                  </StatusChip>
                </div>
                <p className="text-[15px]">
                  <bdi>{item.entries}</bdi>
                  {" · "}
                  <bdi className="whitespace-nowrap">{item.until}</bdi>
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </HomeSection>
  )
}
