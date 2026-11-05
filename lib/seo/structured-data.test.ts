import { describe, expect, it } from "vitest"

import type { BusinessDetailsContent } from "@/lib/content/schema"

import { buildStructuredData, jsonLdString } from "./structured-data"

const details = {
  whatsapp_phone: "+972544256456",
  business_name: "שם העסק",
  address: "רחוב הדוגמה 1, תל אביב",
} as BusinessDetailsContent

const base = { name: "שם העסק", url: "https://example.co.il", details }

function business(input: Parameters<typeof buildStructuredData>[0]) {
  return buildStructuredData(input)["@graph"][0] as Record<string, unknown>
}

describe("buildStructuredData (fix-search-ready)", () => {
  it("a LocalBusiness and the WebSite from published content", () => {
    const data = buildStructuredData({
      ...base,
      description: "תיאור",
      image: "https://cdn.example/hero.jpg",
      footer: {
        items: [{ label: "אינסטגרם", url: "https://instagram.com/x" }],
      },
    })
    expect(data["@context"]).toBe("https://schema.org")
    expect(data["@graph"][0]).toEqual({
      "@type": "LocalBusiness",
      "@id": "https://example.co.il/#business",
      name: "שם העסק",
      url: "https://example.co.il/",
      telephone: "+972544256456",
      address: {
        "@type": "PostalAddress",
        streetAddress: "רחוב הדוגמה 1, תל אביב",
        addressCountry: "IL",
      },
      image: "https://cdn.example/hero.jpg",
      description: "תיאור",
      sameAs: ["https://instagram.com/x"],
    })
    expect(data["@graph"][1]).toMatchObject({
      "@type": "WebSite",
      name: "שם העסק",
      url: "https://example.co.il/",
    })
  })

  it("prefers the phone to the WhatsApp number", () => {
    expect(
      business({ ...base, details: { ...details, phone: "+97231234567" } })
        .telephone
    ).toBe("+97231234567")
  })

  it("an Organization without an address, and no empty fields", () => {
    const result = business({
      ...base,
      details: { ...details, address: "  " },
      description: "",
      image: null,
      footer: null,
    })
    expect(result["@type"]).toBe("Organization")
    expect(result).not.toHaveProperty("address")
    expect(result).not.toHaveProperty("description")
    expect(result).not.toHaveProperty("image")
    expect(result).not.toHaveProperty("sameAs")
  })

  it("without business details: the name and the URL only", () => {
    expect(business({ ...base, details: null })).toEqual({
      "@type": "Organization",
      "@id": "https://example.co.il/#business",
      name: "שם העסק",
      url: "https://example.co.il/",
    })
  })

  it("a hidden footer link is not in sameAs", () => {
    const result = business({
      ...base,
      footer: {
        items: [
          { label: "אינסטגרם", url: "https://instagram.com/x" },
          {
            label: "פייסבוק",
            url: "https://facebook.com/hidden",
            hidden: true,
          },
          { url: "https://no-label.example" },
        ],
      },
    })
    expect(result.sameAs).toEqual(["https://instagram.com/x"])
  })
})

describe("jsonLdString", () => {
  it("escapes every < so no text closes the script", () => {
    const json = jsonLdString({ description: "</script><b>" })
    expect(json).not.toContain("<")
    expect(json).toBe(String.raw`{"description":"\u003c/script>\u003cb>"}`)
    expect(JSON.parse(json)).toEqual({ description: "</script><b>" })
  })
})
