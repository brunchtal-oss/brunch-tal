import { describe, expect, it } from "vitest"

import { WORDMARK } from "@/lib/copy/shell"

import { rootMetadata } from "./root-metadata"

describe("rootMetadata (story 5.20)", () => {
  it("the name in the title, its template and the iPhone home screen", () => {
    expect(rootMetadata("שם חדש")).toEqual({
      title: { default: "שם חדש", template: "%s · שם חדש" },
      appleWebApp: { capable: true, title: "שם חדש" },
      icons: { apple: "/icons/apple-touch-icon.png" },
    })
  })

  it("the fallback name keeps the old title", () => {
    expect(rootMetadata(WORDMARK).title).toEqual({
      default: WORDMARK,
      template: `%s · ${WORDMARK}`,
    })
  })
})
