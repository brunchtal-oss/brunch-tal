import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { joinCopy } from "@/lib/copy/join"

import { JoinForm } from "./join-form"
import { validateJoin } from "./join-input"

vi.mock("./actions", () => ({ submitJoinAction: vi.fn() }))

const TOKEN = "t".repeat(43)
const KEY = "22222222-2222-4222-8222-222222222222"
const PHOTO = {
  question: "line one\nline two",
  yes_label: "yes label",
  no_label: "no label",
}

function render(linkState: "active" | "used" | "expired" | "conflict") {
  return renderToStaticMarkup(
    <JoinForm
      token={TOKEN}
      idempotencyKey={KEY}
      linkState={linkState}
      productName="Card"
      amountAgorot={47200}
      photoConsent={PHOTO}
      today="2026-10-01"
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
    ]) {
      expect(names(html)).toContain(name)
      data.append(name, value)
    }
    expect(validateJoin(data).ok).toBe(true)
  })

  it.each([
    ["used", joinCopy.used],
    ["conflict", joinCopy.conflict],
  ] as const)("shows the %s screen instead of the form", (state, text) => {
    const html = render(state)
    expect(html).toContain(text)
    expect(html).not.toContain('name="password"')
  })
})
