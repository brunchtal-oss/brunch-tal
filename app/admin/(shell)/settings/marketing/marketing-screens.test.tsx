import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { adminCopy } from "@/lib/copy/admin"

import type { MarketingText } from "./marketing-draft"
import { ScheduleEditor } from "./schedule-editor"
import { TextsEditor } from "./texts-editor"

vi.mock("./actions", () => ({
  updateScheduleAction: vi.fn(),
  addTextAction: vi.fn(),
  updateTextAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/settings/marketing",
}))

const copy = adminCopy.settings.marketing

const TEXTS: MarketingText[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    body: "פוסט אחד, עכשיו.",
    active: true,
    sort_order: 1,
    last_sent_at: "2026-10-18T06:00:00Z",
    version: 2,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    body: "סטורי אחד. קדימה.",
    active: true,
    sort_order: 2,
    last_sent_at: null,
    version: 1,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    body: "תעלי משהו.",
    active: false,
    sort_order: 3,
    last_sent_at: null,
    version: 1,
  },
]

describe("ScheduleEditor (story 5.11)", () => {
  it("a row per day from Sunday; a time field only on a checked day; no save while unchanged", () => {
    const html = renderToStaticMarkup(
      <ScheduleEditor
        version={4}
        schedule={[
          { weekday: 0, time: "09:00" },
          { weekday: 4, time: "20:00" },
        ]}
      />
    )
    expect(html).toContain(copy.schedule)
    const positions = copy.days.map((day) => html.indexOf(`>${day}<`))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(html.match(/type="time"/g)).toHaveLength(2)
    expect(html).toContain('value="09:00"')
    expect(html).toContain('value="20:00"')
    expect(html).toContain(`aria-label="${copy.timeLabel("ראשון")}"`)
    expect(html).not.toContain(`>${copy.save}<`)
    expect(html).not.toContain("←")
  })
})

describe("TextsEditor (story 5.11)", () => {
  it("each text with its chip, the next one marked, and when it was sent", () => {
    const html = renderToStaticMarkup(<TextsEditor texts={TEXTS} />)
    for (const t of TEXTS) expect(html).toContain(t.body)
    expect(html.match(new RegExp(`>${copy.active}<`, "g"))).toHaveLength(2)
    expect(html).toContain(`>${copy.inactive}<`)
    expect(html.match(new RegExp(copy.next, "g"))).toHaveLength(1)
    // The next one is the active text never sent (the second).
    expect(html.indexOf(copy.next)).toBeGreaterThan(html.indexOf(TEXTS[1].body))
    expect(html.indexOf(copy.next)).toBeLessThan(html.indexOf(TEXTS[2].body))
    expect(html).toContain(copy.lastSent("18.10"))
    expect(html).toContain(copy.neverSent)
    expect(html).toContain(copy.edit)
    expect(html).toContain(copy.add)
    expect(html).not.toContain(copy.noActive)
  })

  it("no active text: the notice that nothing is sent, and no next", () => {
    const html = renderToStaticMarkup(
      <TextsEditor texts={TEXTS.map((t) => ({ ...t, active: false }))} />
    )
    expect(html).toContain(copy.noActive)
    expect(html).not.toContain(copy.next)
  })
})
