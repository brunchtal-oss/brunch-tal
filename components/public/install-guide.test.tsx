import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { pwaCopy } from "@/lib/copy/pwa"

import { InstallGuide, InstallGuideView } from "./install-guide"

const copy = pwaCopy.install

const stepsOf = (html: string) =>
  [...html.matchAll(/<ol data-steps="">(.*?)<\/ol>/g)].map(
    (match) => match[1].match(/<li/g)?.length ?? 0
  )

describe("InstallGuideView", () => {
  it("shows both cards with numbered steps and no button without the install event", () => {
    const html = renderToStaticMarkup(
      <InstallGuideView installed={false} canPrompt={false} />
    )
    expect(html).toContain(copy.android.title)
    expect(html).toContain(copy.iphone.title)
    expect(html).toContain(copy.iphone.note)
    expect(stepsOf(html)).toEqual([3, 4])
    for (const step of [...copy.android.steps, ...copy.iphone.steps]) {
      expect(html).toContain(step.replaceAll('"', "&quot;"))
    }
    expect(html).not.toContain("<button")
    expect(html).not.toContain(copy.installed)
  })

  it("shows the Android button instead of its steps after the install event", () => {
    const html = renderToStaticMarkup(
      <InstallGuideView installed={false} canPrompt />
    )
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).toContain(copy.android.button)
    expect(stepsOf(html)).toEqual([4])
  })

  it("shows only the installed line in the installed app", () => {
    const html = renderToStaticMarkup(<InstallGuideView installed canPrompt />)
    expect(html).toContain(copy.installed)
    expect(html).not.toContain(copy.android.title)
    expect(html).not.toContain("<button")
    expect(html).not.toContain("<ol")
  })
})

describe("InstallGuide", () => {
  it("renders the steps on the server (no install event, not standalone)", () => {
    const html = renderToStaticMarkup(<InstallGuide />)
    expect(stepsOf(html)).toEqual([3, 4])
    expect(html).not.toContain(copy.installed)
  })
})
