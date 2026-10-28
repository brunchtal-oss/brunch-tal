import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { MarketingTags } from "./marketing-tags"

// Story 5.24: the server HTML never carries a tag; the scripts come only in
// the browser, after the document's first URL is checked (the pure rules are
// in lib/marketing-tags.test.ts).
describe("MarketingTags", () => {
  it("renders nothing on the server, with or without IDs", () => {
    expect(
      renderToStaticMarkup(
        <MarketingTags
          ga4="G-AB12CD34EF"
          gtm="GTM-AB12CD3"
          pixel="123456789012345"
        />
      )
    ).toBe("")
    expect(
      renderToStaticMarkup(<MarketingTags ga4={null} gtm={null} pixel={null} />)
    ).toBe("")
  })
})
