import { describe, expect, it } from "vitest"

import type { BusinessDetailsContent } from "@/lib/content/schema"

import {
  buildEventData,
  buildFaqData,
  buildStructuredData,
  jsonLdString,
} from "./structured-data"

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

describe("buildFaqData (fix-seo-editor)", () => {
  it("only visible items with both a question and an answer", () => {
    const data = buildFaqData({
      items: [
        { question: "q1", answer: "a1" },
        { question: "hidden", answer: "x", hidden: true },
        { question: "no answer" },
        { answer: "no question" },
      ],
    })
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "q1",
          acceptedAnswer: { "@type": "Answer", text: "a1" },
        },
      ],
    })
  })

  it("is null without a full item or a section", () => {
    expect(buildFaqData(null)).toBeNull()
    expect(buildFaqData({ items: [{ question: "q" }] })).toBeNull()
  })
})

describe("buildEventData (fix-seo-editor)", () => {
  const session = {
    id: "11111111-1111-4111-8111-111111111111",
    concept_name: "יווני",
    // 10:00 in Israel, summer time (+03:00).
    starts_at: "2026-06-10T07:00:00Z",
    description: "תיאור",
    display_price_agorot: 12050,
    photo: {
      photoUrl: "https://cdn.example/s.jpg",
      photoAlt: "",
      focusX: 50,
      focusY: 50,
    },
  }

  it("what the page shows, with the Israel offset and a decimal price", () => {
    const data = buildEventData({
      session: session as never,
      name: "שם העסק",
      details,
      url: "https://example.co.il",
    })
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "Event",
      name: "בראנץ׳ יווני",
      startDate: "2026-06-10T10:00:00+03:00",
      eventStatus: "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      location: {
        "@type": "Place",
        name: "שם העסק",
        address: {
          "@type": "PostalAddress",
          streetAddress: "רחוב הדוגמה 1, תל אביב",
          addressCountry: "IL",
        },
      },
      image: "https://cdn.example/s.jpg",
      description: "תיאור",
      url: `https://example.co.il/sessions/${session.id}`,
      offers: {
        "@type": "Offer",
        price: "120.50",
        priceCurrency: "ILS",
        url: `https://example.co.il/sessions/${session.id}`,
      },
      organizer: {
        "@type": "Organization",
        name: "שם העסק",
        url: "https://example.co.il/",
      },
    })
    const json = JSON.stringify(data)
    expect(json).not.toMatch(/capacity|availab|kind/i)
  })

  it("no offers without a display price, a Place with the name only without an address", () => {
    const data = buildEventData({
      session: {
        ...session,
        display_price_agorot: null,
        description: null,
        photo: null,
        // Winter time (+02:00).
        starts_at: "2026-12-01T08:00:00Z",
      } as never,
      name: "שם העסק",
      details: null,
      url: "https://example.co.il",
    }) as Record<string, unknown>
    expect(data.offers).toBeUndefined()
    expect(data.image).toBeUndefined()
    expect(data.description).toBeUndefined()
    expect(data.location).toEqual({ "@type": "Place", name: "שם העסק" })
    expect(data.startDate).toBe("2026-12-01T10:00:00+02:00")
  })
})
