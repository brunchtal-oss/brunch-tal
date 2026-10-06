import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { shellCopy } from "@/lib/copy/shell"
import type { PushState } from "@/lib/push/client"

import { PushCard, PushCardView } from "./push-card"
import { PushEndpointField } from "./push-endpoint-field"
import { SignOutButton } from "./sign-out-button"

vi.mock("@/lib/auth/sign-out", () => ({ signOutAction: vi.fn() }))

const copy = shellCopy.notifications.push

function view(
  state: PushState,
  surface: "customer" | "admin" = "customer",
  failed = false
) {
  return renderToStaticMarkup(
    <PushCardView state={state} surface={surface} failed={failed} />
  )
}

function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])
}

describe("PushCardView", () => {
  it("asks with one sentence, button-primary and button-link", () => {
    const html = view("ask")
    expect(html).toContain(copy.askCustomer)
    expect(buttons(html)).toEqual([copy.enable, copy.later])
    expect(html).toContain(`aria-label="${copy.label}"`)
  })

  it("the admin's card has her own sentence", () => {
    const html = view("ask", "admin")
    expect(html).toContain(copy.askAdmin)
    expect(html).not.toContain(copy.askCustomer)
  })

  it("on: one line and 'לכבות'", () => {
    const html = view("on")
    expect(html).toContain(copy.on)
    expect(buttons(html)).toEqual([copy.turnOff])
  })

  it("off ('לא עכשיו'): a collapsed line with 'להפעיל'", () => {
    const html = view("off")
    expect(html).toContain(copy.off)
    expect(buttons(html)).toEqual([copy.turnOn])
    expect(html).not.toContain(copy.askCustomer)
  })

  it("denied: off with the device-settings help, no button", () => {
    const html = view("denied")
    expect(html).toContain(copy.off)
    expect(html).toContain(copy.deniedHelp)
    expect(buttons(html)).toEqual([])
  })

  it("unsupported: the explanation only", () => {
    const html = view("unsupported")
    expect(html).toContain(copy.unsupported)
    expect(buttons(html)).toEqual([])
    expect(html).not.toContain('href="/install"')
  })

  it("an iPhone tab: the explanation and a link to /install", () => {
    const html = view("ios-install")
    expect(html).toContain(copy.iosInstall)
    expect(html).toContain('href="/install"')
    expect(html).toContain(copy.iosInstallLink)
    expect(buttons(html)).toEqual([])
  })

  it("a failed subscription shows the error and a retry", () => {
    const html = view("on", "customer", true)
    expect(html).toContain('role="alert"')
    expect(html).toContain(copy.error)
    expect(buttons(html)).toEqual([copy.retry, copy.later])
  })

  it("the customer's copy never names Tal", () => {
    for (const value of Object.values(copy)) {
      expect(value).not.toMatch(/(?<![\u0590-\u05FF])טל(?![\u0590-\u05FF])/)
    }
  })
})

describe("PushCard", () => {
  it("renders nothing on the server (the state is the device's)", () => {
    const html = renderToStaticMarkup(
      <PushCard
        surface="customer"
        register={async () => ({ ok: true, data: undefined })}
        unregister={async () => ({ ok: true, data: undefined })}
      />
    )
    expect(html).toBe("")
  })
})

describe("PushEndpointField", () => {
  it("is a hidden push_endpoint field, empty until the browser fills it", () => {
    expect(renderToStaticMarkup(<PushEndpointField />)).toBe(
      '<input type="hidden" name="push_endpoint" value=""/>'
    )
  })
})

describe("SignOutButton", () => {
  it("sends this device's push endpoint with the sign-out form (/login, /join)", () => {
    const html = renderToStaticMarkup(<SignOutButton next="/join/abc" />)
    expect(html).toContain('name="push_endpoint"')
    expect(html).toContain('name="next"')
  })
})
