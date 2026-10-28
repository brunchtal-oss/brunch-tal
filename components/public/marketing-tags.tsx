"use client"

import { useEffect, useSyncExternalStore } from "react"
import Script from "next/script"

import {
  exitHref,
  ga4InitScript,
  ga4Src,
  gtmScript,
  hasAnyTag,
  isPublicPath,
  metaPixelScript,
  startedPublic,
  type MarketingTagsView,
} from "@/lib/marketing-tags"

// The marketing tags (story 5.24), rendered last by app/(public)/layout.tsx
// only, for every visitor (not gated by the cookie notice). GA4, GTM and the
// Meta Pixel each load when their ID is set; each script string is built
// only from an ID that matches its format (lib/marketing-tags.ts).
//
// The scripts stay in the page after a client navigation, and GA4 and Meta
// record history changes, so the public area is left by full page loads:
// (1) a document whose first URL is outside the public area never loads
// tags (the back button into a document that started at /me); (2) while
// tags are on, a capture-phase click listener turns a click on a
// same-origin link to /me, /admin, /login, /join, /reset, /offline or /api
// into location.assign; (3) if the layout unmounts on such a path anyway,
// the page reloads.

const noop = () => () => {}

// Whether this document was first loaded at a public path.
function startedOnPublicPath(): boolean {
  try {
    const entry = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined
    return startedPublic(entry?.name)
  } catch {
    return false
  }
}

export function MarketingTags(tags: MarketingTagsView) {
  // The server snapshot is false: the scripts come only in the browser.
  const allowed = useSyncExternalStore(noop, startedOnPublicPath, () => false)
  const on = allowed && hasAnyTag(tags)

  useEffect(() => {
    if (!on) return
    const onClick = (event: MouseEvent) => {
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null
      const href = exitHref(
        event,
        anchor
          ? {
              href: anchor.href,
              target: anchor.target,
              download: anchor.hasAttribute("download"),
            }
          : null,
        window.location.origin
      )
      if (!href) return
      event.preventDefault()
      event.stopPropagation()
      window.location.assign(href)
    }
    document.addEventListener("click", onClick, true)
    return () => {
      document.removeEventListener("click", onClick, true)
      // After the navigation has updated the URL.
      window.setTimeout(() => {
        if (!isPublicPath(window.location.pathname)) window.location.reload()
      }, 0)
    }
  }, [on])

  if (!on) return null

  const ga4Url = tags.ga4 ? ga4Src(tags.ga4) : null
  const ga4Init = tags.ga4 ? ga4InitScript(tags.ga4) : null
  const gtm = tags.gtm ? gtmScript(tags.gtm) : null
  const pixel = tags.pixel ? metaPixelScript(tags.pixel) : null

  return (
    <>
      {ga4Url && ga4Init && (
        <>
          <Script
            id="marketing-ga4-src"
            src={ga4Url}
            strategy="afterInteractive"
          />
          <Script id="marketing-ga4" strategy="afterInteractive">
            {ga4Init}
          </Script>
        </>
      )}
      {gtm && (
        <Script id="marketing-gtm" strategy="afterInteractive">
          {gtm}
        </Script>
      )}
      {pixel && (
        <Script id="marketing-meta-pixel" strategy="afterInteractive">
          {pixel}
        </Script>
      )}
    </>
  )
}
