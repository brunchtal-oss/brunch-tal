import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { CheckoutBanner, CheckoutBannerView } from "./checkout-banner"

const CHECKOUT = "11111111-1111-4111-8111-111111111111"

// Which checkout qualifies (paid, unjoined, within 24 hours) is decided by
// the loader (checkoutBannerId, lib/server/privileged/checkout.test.ts) and
// checkout_banner_state (supabase/tests/online-payments.test.ts).
describe("the continue-joining banner", () => {
  it("the line and 'להמשך' to the return of the checkout", () => {
    const html = renderToStaticMarkup(
      <CheckoutBannerView checkoutId={CHECKOUT} />
    )
    expect(html).toContain("יש לך רכישה שעוד לא הושלמה.")
    expect(html).toContain(`href="/pay/return?c=${CHECKOUT}"`)
    expect(html).toContain("להמשך")
  })

  it("the loader's checkout: the banner", async () => {
    const banner = await CheckoutBanner({ load: async () => CHECKOUT })
    expect(banner).not.toBeNull()
    expect(renderToStaticMarkup(banner!)).toContain(
      `href="/pay/return?c=${CHECKOUT}"`
    )
  })

  it("no qualifying checkout: nothing", async () => {
    const load = vi.fn(async () => null)
    expect(await CheckoutBanner({ load })).toBeNull()
    expect(load).toHaveBeenCalledTimes(1)
  })
})
