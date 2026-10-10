import { adminCopy } from "@/lib/copy/admin"

import { totalsView } from "../home-items"
import { HomeSection } from "./home-section"
import { loadHome } from "./load-home"

const copy = adminCopy.home

// The one sum of the home (story 4.1, source §7): "approved payments minus
// refunds" for the local month up to today, computed in SQL
// (admin_get_home.totals), in a cube like the other parts (design round).
// The refunds line (story 3.7) is always shown, also at 0; refunds count
// once Tal completes them (3.9).
export async function MonthTotals() {
  const { totals } = await loadHome()
  const view = totalsView(totals)

  return (
    <HomeSection id="home-totals" title={copy.totalsTitle}>
      <div className="flex flex-col gap-1">
        <p className="text-[13px] leading-[1.4] text-muted-foreground">
          <time dateTime={view.periodStart.slice(0, 7)}>{view.period}</time>
        </p>
        <p className="text-[26px] leading-none tabular-nums">
          <bdi>{view.net}</bdi>
        </p>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-2 border-t border-border pt-3 text-[15px]">
        <dt className="text-muted-foreground">{view.approvedLabel}</dt>
        <dd className="text-end tabular-nums">
          <bdi>{view.approved}</bdi>
        </dd>
        <dt className="text-muted-foreground">{view.refundedLabel}</dt>
        <dd className="text-end tabular-nums">
          <bdi>{view.refunded}</bdi>
        </dd>
      </dl>
    </HomeSection>
  )
}
