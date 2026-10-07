import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { authCopy } from "@/lib/copy/auth"
import { joinCopy } from "@/lib/copy/join"

import { JoinForm } from "./join-form"
import { validateJoin } from "./join-input"

vi.mock("./actions", () => ({ submitJoinAction: vi.fn() }))

const TOKEN = "t".repeat(43)
const KEY = "22222222-2222-4222-8222-222222222222"
const PHOTO = {
  atmosphere_title: "atmosphere title",
  atmosphere_question: "line one\nline two",
  atmosphere_yes: "yes label",
  atmosphere_no: "no label",
  personal_title: "personal title",
  personal_question: "personal question",
  personal_yes: "personal yes",
  personal_no: "personal no",
  note: "note one\nnote two",
}

function render(
  linkState: "active" | "used" | "expired" | "conflict",
  extra: {
    conflictReason?: "two_accounts" | "not_activated" | null
    contactHref?: string | null
    privacyHref?: string | null
  } = {}
) {
  return renderToStaticMarkup(
    <JoinForm
      token={TOKEN}
      idempotencyKey={KEY}
      linkState={linkState}
      conflictReason={extra.conflictReason}
      contactHref={extra.contactHref}
      productName="Card"
      amountAgorot={47200}
      photoConsent={PHOTO}
      today="2026-10-01"
      privacyHref={extra.privacyHref}
    />
  )
}

// Every named input of the rendered form (the names validateJoin reads).
function names(html: string): string[] {
  return [...html.matchAll(/<(?:input|textarea|select)[^>]*\sname="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((name, index, all) => all.indexOf(name) === index)
}

describe("JoinForm", () => {
  it("renders the fields under the names the action reads, nothing pre-selected", () => {
    const html = render("active")
    expect(names(html).sort()).toEqual(
      [
        "token",
        "idempotencyKey",
        "fullName",
        "phone",
        "email",
        "babyName",
        "birthDate",
        "dietaryNotes",
        "password",
        "confirm",
        "privacyConsent",
        "photoConsent",
        "personalPhotoConsent",
      ].sort()
    )
    // No radio or checkbox is pre-selected (a `checked` attribute).
    expect(html).not.toMatch(/\schecked[=\s/>]/)
    expect(html).toContain("472 ₪")
    expect(html).toContain("yes label")
    expect(html).toContain("no label")
    expect(html).toContain(joinCopy.addBaby)

    // The same names, filled, pass validation.
    const data = new FormData()
    for (const [name, value] of [
      ["fullName", "Dev"],
      ["phone", "0541234567"],
      ["email", "a@b.co"],
      ["babyName", "B"],
      ["birthDate", "2026-09-01"],
      ["password", "Test-pass-123"],
      ["confirm", "Test-pass-123"],
      ["privacyConsent", "on"],
      ["photoConsent", "yes"],
      ["personalPhotoConsent", "no"],
    ]) {
      expect(names(html)).toContain(name)
      data.append(name, value)
    }
    expect(validateJoin(data).ok).toBe(true)
  })

  it.each([
    ["used", joinCopy.used],
    ["conflict", joinCopy.conflicts.bind_conflict],
  ] as const)("shows the %s screen instead of the form", (state, text) => {
    const html = render(state)
    expect(html).toContain(text)
    expect(html).not.toContain('name="password"')
  })
})

// Story 2.13: one form in two steps, the inactive one hidden (not removed).
describe("JoinForm steps", () => {
  // The markup of one step, from its opening tag.
  function step(html: string, n: 1 | 2): string {
    const start = html.lastIndexOf("<div", html.indexOf(`data-step="${n}"`))
    const end = n === 1 ? html.indexOf('data-step="2"') : html.length
    return html.slice(start, end)
  }

  it("opens on step 1, with step 2 in the form but hidden", () => {
    const html = render("active")
    const one = step(html, 1)
    const two = step(html, 2)
    expect(one).not.toMatch(/^<div[^>]*\shidden/)
    expect(two).toMatch(/^<div[^>]*\shidden/)
    expect(one).toContain(joinCopy.stepOneTitle)
    expect(one).toContain('name="password"')
    expect(one).toContain('name="privacyConsent"')
    expect(one).toContain(`>${joinCopy.next}</button>`)
    expect(one).not.toContain('name="photoConsent"')
    expect(two).toContain(joinCopy.stepTwoTitle)
    expect(two).toContain('name="photoConsent"')
    expect(two).toContain('name="personalPhotoConsent"')
    expect(two).toContain(`>${joinCopy.back}</button>`)
    expect(two).toContain('type="submit"')
    // The step headings take focus from the step buttons.
    expect(html.match(/<h2[^>]*tabindex="-1"/g)).toHaveLength(2)
  })

  it("shows both questions with their titles, and the note under them", () => {
    const two = step(render("active"), 2)
    for (const text of [
      "atmosphere title",
      "personal title",
      "personal question",
      "personal yes",
      "personal no",
      "note one",
      "note two",
    ]) {
      expect(two).toContain(text)
    }
    expect(two.indexOf("note one")).toBeGreaterThan(two.indexOf("personal no"))
    // No "(חובה)" next to the questions.
    expect(two).not.toContain(authCopy.required)
  })

  it("names each question in its missing-answer message", () => {
    expect(joinCopy.errors.photoConsent).not.toBe(
      joinCopy.errors.personalPhotoConsent
    )
  })

  it("marks the allergies as optional, with the hint under the label", () => {
    const html = render("active")
    expect(joinCopy.dietaryNotes).toContain("(לא חובה)")
    expect(html).toContain(joinCopy.dietaryNotes)
    expect(html).toContain('id="dietary-hint"')
    expect(html).toContain(joinCopy.dietaryHint)
    const textarea = /<textarea[^>]*>/.exec(html)?.[0] ?? ""
    expect(textarea).toContain('aria-describedby="dietary-hint"')
    expect(html.indexOf("dietary-hint")).toBeLessThan(html.indexOf("<textarea"))
  })
})

describe("JoinForm conflict reason", () => {
  it("words a link that opened in conflict by its stored reason, with the WhatsApp link", () => {
    const href = "https://wa.me/972544256456"
    const html = render("conflict", {
      conflictReason: "two_accounts",
      contactHref: href,
    })
    const text = joinCopy.conflicts.two_accounts
    expect(html).toContain(text.slice(0, text.indexOf(joinCopy.contactPhrase)))
    expect(html).toContain(`href="${href}"`)
  })

  it("links the expired screen's contact phrase to WhatsApp", () => {
    const href = "https://wa.me/972544256456"
    const html = render("expired", { contactHref: href })
    expect(html).toContain(`>${joinCopy.expiredContactPhrase}</a>`)
    expect(html).not.toContain('name="password"')
  })

  it("shows plain text without published business details", () => {
    const html = render("conflict", { conflictReason: "not_activated" })
    expect(html).toContain(joinCopy.conflicts.not_activated)
    expect(html).not.toContain("wa.me")
  })
})

describe("JoinForm privacy link (story 5.5)", () => {
  // The privacy checkbox's label.
  function label(html: string): string {
    return /<label for="privacy"[^>]*>([\s\S]*?)<\/label>/.exec(html)?.[1] ?? ""
  }

  it("links the policy in a new tab once it is published", () => {
    const text = label(render("active", { privacyHref: "/privacy" }))
    expect(text).toContain('href="/privacy"')
    expect(text).toContain('target="_blank"')
    expect(text).toContain('rel="noopener noreferrer"')
    expect(text).toContain(joinCopy.privacyConsentLink)
  })

  it("keeps the plain wording without a published policy", () => {
    const text = label(render("active", { privacyHref: null }))
    expect(text).not.toContain("<a")
    expect(text).toContain(joinCopy.privacyConsent)
  })
})
