import { InlineNotice } from "@/components/shared/inline-notice"
import { customerCopy } from "@/lib/copy/customer"
import { cn } from "@/lib/utils"

const copy = customerCopy.purchase

// "Continue joining" (online payments, PR B; review pass 1): only for a
// checkout of this browser that is paid and not joined yet, created within
// 24 hours, as the loader checks in the database (read only); open,
// failed or expired checkouts never show it. "להמשך" leads to /pay/return
// for it, which decides the real state. Rendered in its own <Suspense> in
// the public layout and in /me. Nothing while the kill switch is off.
export async function CheckoutBanner({
  load,
  className,
}: {
  // The checkout id to continue, or null (app/(public)/pay/actions.ts).
  load: () => Promise<string | null>
  className?: string
}) {
  const id = await load()
  if (!id) return null
  return <CheckoutBannerView checkoutId={id} className={className} />
}

export function CheckoutBannerView({
  checkoutId,
  className,
}: {
  checkoutId: string
  className?: string
}) {
  return (
    <InlineNotice
      tone="info"
      className={cn("w-full", className)}
      actions={
        // A route handler, not a page: a plain link, never prefetched.
        <a
          href={`/pay/return?c=${encodeURIComponent(checkoutId)}`}
          className="py-3 font-semibold underline underline-offset-[3px]"
        >
          {copy.bannerLink}
        </a>
      }
    >
      {copy.banner}
    </InlineNotice>
  )
}
