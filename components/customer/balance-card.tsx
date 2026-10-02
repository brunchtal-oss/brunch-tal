import { customerCopy } from "@/lib/copy/customer"
import { formatDayMonth, formatLocalDate } from "@/lib/time"

// DESIGN.md › balance-card: muted background, 8px corners, a decorative
// accent dot; the numbers in body-strong, then "בתוקף עד DD.MM" in
// ink-muted (no redemption weekdays: user decision 2026-10-02). All values
// come from entitlement_balances (AD-14); nothing is computed here.
export function BalanceCard({
  available,
  reserved,
  expiresOn,
}: {
  available: number
  reserved: number
  expiresOn: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-muted px-4 py-3">
      <p className="flex items-center gap-2 font-semibold">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full bg-brand-accent"
        />
        <span>
          <bdi>{customerCopy.available(available)}</bdi> ·{" "}
          <bdi>{customerCopy.reserved(reserved)}</bdi>
        </span>
      </p>
      <p className="text-[15px] text-muted-foreground">
        {customerCopy.validUntil}{" "}
        <time dateTime={formatLocalDate(expiresOn)}>
          <bdi>{formatDayMonth(expiresOn)}</bdi>
        </time>
      </p>
    </div>
  )
}
