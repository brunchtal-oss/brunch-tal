import { describe, expect, it } from "vitest"

import { growConfig, onlinePaymentsEnabled } from "./online-config"

const FULL = {
  ONLINE_PAYMENTS_ENABLED: "true",
  GROW_ENV: "sandbox",
  GROW_CLIENT_ID: "client-id",
  GROW_CLIENT_SECRET: "client-secret",
  GROW_PLUGIN_ID: "plugin-id",
  GROW_DOCUMENT_TYPE: "400",
}

describe("growConfig", () => {
  it("sandbox hosts", () => {
    expect(growConfig(FULL)).toEqual({
      env: "sandbox",
      idpUrl: "https://api.sandbox.morning.dev",
      apiUrl: "https://sandbox.d.greeninvoice.co.il/api/v1",
      clientId: "client-id",
      clientSecret: "client-secret",
      pluginId: "plugin-id",
      documentType: 400,
    })
  })

  it("production hosts and the tax-invoice receipt type", () => {
    const config = growConfig({
      ...FULL,
      GROW_ENV: " production ",
      GROW_DOCUMENT_TYPE: "320",
    })
    expect(config?.idpUrl).toBe("https://api.morning.co")
    expect(config?.apiUrl).toBe("https://api.greeninvoice.co.il/api/v1")
    expect(config?.documentType).toBe(320)
  })

  it("does not need the kill switch", () => {
    expect(growConfig({ ...FULL, ONLINE_PAYMENTS_ENABLED: "" })).not.toBeNull()
  })

  it.each([
    ["GROW_ENV", "staging"],
    ["GROW_ENV", ""],
    ["GROW_CLIENT_ID", ""],
    ["GROW_CLIENT_SECRET", "  "],
    ["GROW_PLUGIN_ID", ""],
    ["GROW_DOCUMENT_TYPE", "305"],
    ["GROW_DOCUMENT_TYPE", ""],
  ])("null when %s is %j", (name, value) => {
    expect(growConfig({ ...FULL, [name]: value })).toBeNull()
  })
})

describe("onlinePaymentsEnabled", () => {
  it("on with the switch and every var", () => {
    expect(onlinePaymentsEnabled(FULL)).toBe(true)
  })

  it.each(["false", "TRUE", "1", ""])("off when the switch is %j", (value) => {
    expect(
      onlinePaymentsEnabled({ ...FULL, ONLINE_PAYMENTS_ENABLED: value })
    ).toBe(false)
  })

  it("off when a Grow var is missing", () => {
    expect(onlinePaymentsEnabled({ ...FULL, GROW_PLUGIN_ID: undefined })).toBe(
      false
    )
  })

  it("off with an empty env", () => {
    expect(onlinePaymentsEnabled({})).toBe(false)
  })
})
