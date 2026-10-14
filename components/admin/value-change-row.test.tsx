import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import { saveWithKey, ValueChangeRow } from "./value-change-row"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const copy = adminCopy.valueChange

describe("ValueChangeRow", () => {
  it("shows only the field while the value is unchanged", () => {
    const html = renderToStaticMarkup(
      <ValueChangeRow
        label="Units"
        oldValue="4"
        newValue={null}
        scope="Scope note"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      >
        <input id="units" />
      </ValueChangeRow>
    )
    expect(html).toContain('id="units"')
    expect(html).not.toContain(copy.save)
    expect(html).not.toContain(copy.cancel)
    expect(html).not.toContain("Scope note")
    expect(html).not.toContain(copy.saved)
  })

  it("shows old ← new, the scope note and the save button after a change", () => {
    const html = renderToStaticMarkup(
      <ValueChangeRow
        label="Units"
        oldValue="4"
        newValue="5"
        scope="Scope note"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      >
        <input id="units" />
      </ValueChangeRow>
    )
    expect(html).toContain(copy.change("Units", "4", "5"))
    expect(html).toContain("Units: 4 ← 5")
    expect(html).toContain("Scope note")
    expect(html).toContain(copy.save)
    expect(html).toContain(copy.cancel)
    // No checkbox: it belongs to the sensitive dialog only.
    expect(html).not.toContain('role="checkbox"')
    expect(html).not.toContain("aria-busy")
  })
})

describe("saveWithKey", () => {
  const KEY = "22222222-2222-4222-8222-222222222222"

  it.each([
    ["ok", { ok: true } as const],
    [
      "a refusal stored under the key (PHONE_TAKEN)",
      { ok: false, code: "PHONE_TAKEN" } as const,
    ],
  ])("takes a new key after %s", async (_label, answer) => {
    const onSave = vi.fn(async () => answer)
    const saved = await saveWithKey(onSave, KEY)
    expect(onSave).toHaveBeenCalledWith(KEY)
    expect(saved.result).toEqual(answer)
    expect(saved.nextKey).not.toBe(KEY)
  })

  it("a thrown save is SERVER_ERROR with a new key", async () => {
    const saved = await saveWithKey(async () => {
      throw new Error("network")
    }, KEY)
    expect(saved.result).toEqual({ ok: false, code: "SERVER_ERROR" })
    expect(saved.nextKey).not.toBe(KEY)
  })

  it("keeps the key when nothing was sent", async () => {
    const saved = await saveWithKey(async () => null, KEY)
    expect(saved).toEqual({ result: null, nextKey: KEY })
  })
})
