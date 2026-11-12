import { describe, expect, it } from "vitest"

import {
  checkImageBytes,
  emailImageUrl,
  fileArg,
  MAX_EMAIL_IMAGE_BYTES,
  vaultInstructions,
  vaultLine,
} from "../scripts/email-image.mjs"

// Story 6.11: the pure helpers of the email image scripts.

describe("email image scripts", () => {
  it("the public URL of media-public/email/header.jpg, per project", () => {
    expect(emailImageUrl("https://abcdefghijklmnopqrst.supabase.co/")).toBe(
      "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/media-public/email/header.jpg"
    )
  })

  it("--file is required and never another flag", () => {
    expect(fileArg(["node", "x", "--file", "a.jpg", "--apply"])).toBe("a.jpg")
    expect(fileArg(["node", "x", "--file", "--apply"])).toBeNull()
    expect(fileArg(["node", "x"])).toBeNull()
  })

  it("prints the SQL Editor line: create the first time, update after", () => {
    const url =
      "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/media-public/email/header.jpg"
    expect(vaultLine(url, false)).toBe(
      `select vault.create_secret('${url}', 'email_image_url');`
    )
    expect(vaultLine(url, true)).toBe(
      `select vault.update_secret((select id from vault.secrets where name = 'email_image_url'), '${url}');`
    )
    // A quote can never break out of the literal.
    expect(vaultLine("a'b", false)).toContain("'a''b'")
    // Unknown (the role may not read Vault): both lines, labelled.
    const both = vaultInstructions(url, null)
    expect(both).toContain(vaultLine(url, false))
    expect(both).toContain(vaultLine(url, true))
    expect(vaultInstructions(url, true)).toHaveLength(2)
  })

  it("accepts a small JPEG only", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])
    expect(checkImageBytes(jpeg)).toEqual({ ok: true })
    expect(checkImageBytes(new Uint8Array([])).ok).toBe(false)
    expect(checkImageBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47])).ok).toBe(
      false
    )
    const big = new Uint8Array(MAX_EMAIL_IMAGE_BYTES + 1)
    big.set([0xff, 0xd8, 0xff])
    expect(checkImageBytes(big).ok).toBe(false)
  })
})
