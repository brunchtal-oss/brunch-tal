import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/content/business-details", () => ({
  getBusinessName: async () => "שם חדש",
}))
vi.mock("@/components/public/install-guide", () => ({
  InstallGuide: () => null,
}))

const { default: InstallPage } = await import("./page")

// Story 5.20: the name under the icon is the published business name.
describe("/install", () => {
  it("captions the icon with the business name", async () => {
    const html = renderToStaticMarkup(await InstallPage())
    expect(html).toMatch(/<figcaption[^>]*>שם חדש<\/figcaption>/)
  })
})
