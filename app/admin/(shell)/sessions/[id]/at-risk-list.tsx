import Link from "next/link"

import { adminCopy } from "@/lib/copy/admin"
import { formatDayMonth } from "@/lib/time"

import { customerHref } from "../../customers/customer-items"
import type { AtRiskCard } from "./event-plan"

const copy = adminCopy.sessions.atRisk

// The warning inside the cancel and time-change dialogs (story 3.8): the
// customers whose card may be left with an entry they cannot use, each with
// the product, its expiry, the reason and a link to her card. A warning
// only: it never blocks the action, and there is no extend button here
// (3.13).
export function AtRiskList({
  title,
  cards,
}: {
  title: string
  cards: readonly AtRiskCard[]
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-semibold">{title}</p>
      <ul className="flex flex-col gap-2">
        {cards.map((card, index) => (
          <li
            key={`${card.customerId ?? "none"}:${index}`}
            className="flex flex-col"
          >
            {card.customerId ? (
              <Link
                href={customerHref(card.customerId)}
                aria-label={copy.toCustomer(card.customerLabel)}
                className="font-semibold underline underline-offset-[3px]"
              >
                <bdi>{card.customerLabel}</bdi>
              </Link>
            ) : (
              <bdi className="font-semibold">{card.customerLabel}</bdi>
            )}
            <span className="text-[13px]">
              <bdi>
                {copy.line(card.productName, formatDayMonth(card.expiresOn))}
              </bdi>
              {". "}
              {copy.reason[card.reason]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
