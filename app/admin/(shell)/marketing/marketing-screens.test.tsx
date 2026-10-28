import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import {
  MarketingIntro,
  MarketingTagsEditor,
  PRIVACY_EDIT_HREF,
  savePayload,
  tagChange,
  type MarketingTagsEditorRow,
} from "./marketing-tags-editor"

const updateMarketingTagsAction = vi.fn()
const rowProps: Record<string, unknown>[] = []

vi.mock("./actions", () => ({
  updateMarketingTagsAction: (...args: unknown[]) =>
    updateMarketingTagsAction(...args),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/marketing",
}))
vi.mock("@/components/admin/value-change-row", () => ({
  asSaveResult: (r: { ok: boolean; code?: string }) =>
    r.ok ? { ok: true } : { ok: false, code: r.code },
  ValueChangeRow: (props: Record<string, unknown>) => {
    rowProps.push(props)
    return <div data-row={String(props.label)}>{props.children as never}</div>
  },
}))

beforeEach(() => {
  updateMarketingTagsAction.mockReset()
  rowProps.length = 0
})

const KEY = "22222222-2222-4222-8222-222222222222"

const copy = adminCopy.marketingTags

const EMPTY: MarketingTagsEditorRow = {
  ga4_measurement_id: null,
  gtm_container_id: null,
  meta_pixel_id: null,
  version: 1,
}

describe("MarketingTagsEditor", () => {
  it("shows the section, the scope, three LTR fields with hints and the double-count note", () => {
    const html = renderToStaticMarkup(<MarketingTagsEditor row={EMPTY} />)
    for (const text of [
      copy.section,
      copy.scope,
      copy.labels.ga4,
      copy.labels.gtm,
      copy.labels.pixel,
      copy.hints.ga4,
      copy.hints.gtm,
      copy.hints.pixel,
      copy.doubleCount,
    ]) {
      expect(html).toContain(text)
    }
    expect(html.match(/dir="ltr"/g)).toHaveLength(3)
    // Nothing saved: each tool is off.
    expect(html.match(new RegExp(`>${copy.off}<`, "g"))).toHaveLength(3)
    expect(html).not.toMatch(/\b(ml|mr|pl|pr|left|right)-/)
  })

  it("shows a saved ID and no 'off' for it", () => {
    const html = renderToStaticMarkup(
      <MarketingTagsEditor
        row={{ ...EMPTY, ga4_measurement_id: "G-AB12CD34EF" }}
      />
    )
    expect(html).toContain('value="G-AB12CD34EF"')
    expect(html.match(new RegExp(`>${copy.off}<`, "g"))).toHaveLength(2)
  })

  it("the intro and the privacy notice link to the privacy policy's editor", () => {
    const html = renderToStaticMarkup(<MarketingIntro />)
    expect(html).toContain(copy.intro)
    expect(html).toContain(copy.privacyNotice)
    expect(html).toContain(`href="${PRIVACY_EDIT_HREF}"`)
    expect(PRIVACY_EDIT_HREF).toBe("/admin/content/privacy")
    expect(html).toContain(copy.privacyLink)
  })
})

describe("tagChange", () => {
  it("old and new as text, off as 'כבוי'", () => {
    expect(tagChange("ga4", EMPTY, " g-ab12cd34ef ")).toEqual({
      from: copy.off,
      to: "G-AB12CD34EF",
    })
    expect(
      tagChange("pixel", { ...EMPTY, meta_pixel_id: "123456789012345" }, "")
    ).toEqual({ from: "123456789012345", to: copy.off })
  })

  it("no change while the value is the saved one or not valid", () => {
    expect(tagChange("ga4", EMPTY, "  ")).toBeNull()
    expect(
      tagChange(
        "gtm",
        { ...EMPTY, gtm_container_id: "GTM-AB12CD3" },
        "gtm-ab12cd3"
      )
    ).toBeNull()
    expect(tagChange("gtm", EMPTY, "GTM-12 34")).toBeNull()
  })
})

describe("a row's save", () => {
  const SAVED: MarketingTagsEditorRow = {
    ga4_measurement_id: "G-AB12CD34EF",
    gtm_container_id: null,
    meta_pixel_id: "123456789012345",
    version: 7,
  }

  it("sends the typed value for its field, the saved values for the other two, the version and the key", () => {
    expect(savePayload(SAVED, "gtm", " gtm-ab12cd3 ", KEY)).toEqual({
      ids: {
        ga4: "G-AB12CD34EF",
        gtm: " gtm-ab12cd3 ",
        pixel: "123456789012345",
      },
      expectedVersion: 7,
      idempotencyKey: KEY,
    })
    expect(savePayload(SAVED, "pixel", "", KEY)).toEqual({
      ids: { ga4: "G-AB12CD34EF", gtm: "", pixel: "" },
      expectedVersion: 7,
      idempotencyKey: KEY,
    })
  })

  it("nothing to send while the value is unchanged or invalid", () => {
    expect(savePayload(SAVED, "ga4", "g-ab12cd34ef", KEY)).toBeNull()
    expect(savePayload(SAVED, "gtm", "GTM-12 34", KEY)).toBeNull()
    expect(savePayload(SAVED, "pixel", "12345", KEY)).toBeNull()
  })

  it("each row's onSave sends nothing while its field holds the saved value", async () => {
    renderToStaticMarkup(<MarketingTagsEditor row={SAVED} />)
    expect(rowProps.map((p) => p.label)).toEqual([
      copy.changeNames.ga4,
      copy.changeNames.gtm,
      copy.changeNames.pixel,
    ])
    for (const props of rowProps) {
      expect(props.newValue).toBeNull()
      const onSave = props.onSave as (key: string) => Promise<unknown>
      await expect(onSave(KEY)).resolves.toBeNull()
    }
    expect(updateMarketingTagsAction).not.toHaveBeenCalled()
  })
})
