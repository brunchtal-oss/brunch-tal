import type { BusinessDetailsContent } from "@/lib/content/schema"
import { shellCopy } from "@/lib/copy/shell"
import { cn } from "@/lib/utils"

const copy = shellCopy.public.contact

const LINK =
  "inline-flex min-h-11 items-center font-semibold underline underline-offset-4"

// Whether the details have a field ContactDetails shows (a record with only
// the WhatsApp number shows nothing here).
export function hasContactDetails(
  details: BusinessDetailsContent | null
): details is BusinessDetailsContent {
  return Boolean(
    details &&
    (details.phone ||
      details.address ||
      details.arrival_instructions ||
      details.navigation_url)
  )
}

// A tel: link for a phone from the business details (digits and a leading
// "+" only).
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`
}

// The published business details (source doc › יצירת קשר): phone, address,
// arrival instructions and a navigation link. WhatsApp is the whatsapp-bar
// on every page and the payment instructions are not shown here (user
// decision 2026-10-04). A field that is empty is not shown; numbers are
// wrapped in <bdi> so they do not flip in RTL. Shared by /contact and the
// admin preview of the business details (the draft). Without details:
// nothing.
export function ContactDetails({
  details,
  className,
}: {
  details: BusinessDetailsContent | null
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
