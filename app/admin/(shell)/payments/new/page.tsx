import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeftIcon } from "lucide-react"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"

const copy = adminCopy.payments

export const metadata: Metadata = {
  title: copy.newTitle,
}

// Whom the payment is for (story 2.5): a new customer goes to the form of
// today (a join link), an existing one to the search first. Two links shaped
// as radio-cards: a choice that leads to another screen, so no radio state
// and nothing to submit.
export default function NewPaymentChoicePage() {
  const options = [
    { href: "/admin/payments/new/new-customer", label: copy.newCustomer },
    { href: "/admin/payments/new/existing", label: copy.existingCustomer },
  ]
  return (
    <>
      <PageHeading>{copy.newTitle}</PageHeading>
      <nav aria-labelledby="payment-for" className="flex flex-col gap-2">
        <h2 id="payment-for" className="mb-2 text-[15px] font-semibold">
          {copy.choiceLegend}
        </h2>
        <ul className="flex flex-col gap-2">
          {options.map((option) => (
            <li key={option.href}>
              <Link
                href={option.href}
                className="flex min-h-14 items-center justify-between gap-3 rounded-sm border border-muted-foreground bg-card px-4 py-3 text-base font-semibold hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
              >
                {option.label}
                <ChevronLeftIcon
                  aria-hidden
                  strokeWidth={1.5}
                  className="size-5 shrink-0 text-muted-foreground"
                />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  )
}
