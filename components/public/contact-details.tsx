import { MapPinIcon, PhoneIcon } from "lucide-react"

import type { BusinessDetailsContent } from "@/lib/content/schema"
import { shellCopy } from "@/lib/copy/shell"
import { cn } from "@/lib/utils"

const copy = shellCopy.public.contact

// Whether the details have a field ContactDetails shows: a phone or an
// address (user decision 2026-10-08; a record with only the WhatsApp number,
// or only arrival instructions, shows nothing here).
export function hasContactDetails(
  details: BusinessDetailsContent | null
): details is BusinessDetailsContent {
  return Boolean(details && (details.phone || details.address))
}

// A tel: link for a phone from the business details (digits and a leading
// "+" only).
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`
}

const ROW = "flex min-h-16 items-center gap-4 py-3"

// The icon of a row: 20px in a 44px muted circle, decorative.
function RowIcon({ icon: Icon }: { icon: typeof PhoneIcon }) {
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted">
      <Icon aria-hidden strokeWidth={1.5} className="size-5" />
    </span>
  )
}

// The published business details (source doc › יצירת קשר; the look of the
// user's choice 2026-10-08): a white card (DESIGN › card) with action rows
// and thin rules between them. The phone row is one tel: link; the address
// row is one link to the navigation app when there is a navigation link
// (a new window), else plain text. No separate navigation row, and the
// arrival instructions are not shown here (they stay in the data and the
// editor). WhatsApp is the whatsapp-bar on every page and the payment
// instructions are not shown (user decision 2026-10-04). Numbers are in
// <bdi> so they do not flip in RTL. Shared by /contact and the admin
// preview of the business details (the draft). Nothing to show: nothing.
export function ContactDetails({
  details,
  className,
}: {
  details: BusinessDetailsContent | null
  className?: string
}) {
  if (!hasContactDetails(details)) return null

  const rows: { key: string; row: React.ReactNode }[] = []
  if (details.phone) {
    rows.push({
      key: "phone",
      row: (
        <a href={telHref(details.phone)} className={ROW}>
          <RowIcon icon={PhoneIcon} />
          <span className="flex min-w-0 flex-col">
            <span className="text-[13px] leading-[1.4] text-muted-foreground">
              {copy.phone}
            </span>
            <bdi
              dir="ltr"
              className="text-start text-base leading-[1.35] font-semibold"
            >
              {details.phone}
            </bdi>
          </span>
        </a>
      ),
    })
  }
  if (details.address) {
    const text = (
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] leading-[1.4] text-muted-foreground">
          {copy.address}
        </span>
        <span className="text-base leading-[1.35] font-semibold break-words">
          {details.address}
        </span>
        {/* No visible navigation line (2026-10-08); the link still says it. */}
        {details.navigation_url && (
          <span className="sr-only">
            {" "}
            {copy.navigation} {copy.opensOutside}
          </span>
        )}
      </span>
    )
    rows.push({
      key: "address",
      row: details.navigation_url ? (
        <a
          href={details.navigation_url}
          target="_blank"
          rel="noopener noreferrer"
          className={ROW}
        >
          <RowIcon icon={MapPinIcon} />
          {text}
        </a>
      ) : (
        <div className={ROW}>
          <RowIcon icon={MapPinIcon} />
          {text}
        </div>
      ),
    })
  }

  return (
    <ul
      className={cn(
        "mx-auto flex w-full max-w-[480px] flex-col divide-y divide-border rounded-xl border border-border bg-card px-4 py-1",
        className
      )}
    >
      {rows.map(({ key, row }) => (
        <li key={key}>{row}</li>
      ))}
    </ul>
  )
}
