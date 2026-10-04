import type { BusinessDetailsContent } from "@/lib/content/schema"
import { shellCopy } from "@/lib/copy/shell"
import { cn } from "@/lib/utils"

const copy = shellCopy.public.contact

const LINK =
  "inline-flex min-h-11 items-center font-semibold underline underline-offset-4"

// A tel: link for a phone from the business details (digits and a leading
// "+" only).
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`
}

// The published business details (EXPERIENCE › יצירת קשר): phone, WhatsApp,
// address, arrival instructions, a navigation link and the payment
// instructions. A field that is empty is not shown; numbers are wrapped in
// <bdi> so they do not flip in RTL. Shared by /contact, home › contact and
// the admin preview of the business details (the draft). Without details:
// nothing.
export function ContactDetails({
  details,
  whatsappHref,
  className,
}: {
  details: BusinessDetailsContent | null
  whatsappHref: string | null
  className?: string
}) {
  if (!details) return null

  const rows: { label: string; value: React.ReactNode }[] = []
  if (details.phone) {
    rows.push({
      label: copy.phone,
      value: (
        <a href={telHref(details.phone)} className={LINK}>
          <bdi dir="ltr">{details.phone}</bdi>
        </a>
      ),
    })
  }
  if (whatsappHref) {
    rows.push({
      label: copy.whatsapp,
      value: (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK}
        >
          <bdi dir="ltr">{details.whatsapp_phone}</bdi>
          <span className="sr-only"> {copy.opensOutside}</span>
        </a>
      ),
    })
  }
  if (details.address) {
    rows.push({ label: copy.address, value: details.address })
  }
  if (details.arrival_instructions) {
    rows.push({
      label: copy.arrival,
      value: (
        <span className="whitespace-pre-line">
          {details.arrival_instructions}
        </span>
      ),
    })
  }
  if (details.navigation_url) {
    rows.push({
      label: copy.navigation,
      value: (
        <a
          href={details.navigation_url}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK}
        >
          {copy.navigation}
          <span className="sr-only"> {copy.opensOutside}</span>
        </a>
      ),
    })
  }
  if (details.payment_instructions) {
    rows.push({
      label: copy.payment,
      value: (
        <span className="whitespace-pre-line">
          {details.payment_instructions}
        </span>
      ),
    })
  }
  if (rows.length === 0) return null

  return (
    <dl
      className={cn(
        "mx-auto flex w-full max-w-[480px] flex-col border-t border-border",
        className
      )}
    >
      {rows.map((row) =>
        row.label === copy.navigation ? (
          // The link names itself; the label is for screen readers only.
          <div key={row.label} className="border-b border-border py-3">
            <dt className="sr-only">{row.label}</dt>
            <dd className="text-base">{row.value}</dd>
          </div>
        ) : (
          <div key={row.label} className="border-b border-border py-3">
            <dt className="text-[13px] leading-[1.4] text-muted-foreground">
              {row.label}
            </dt>
            <dd className="mt-0.5 text-base leading-normal">{row.value}</dd>
          </div>
        )
      )}
    </dl>
  )
}
