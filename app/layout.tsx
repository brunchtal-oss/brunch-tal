import { Suspense } from "react"
import type { Metadata, Viewport } from "next"
import { Assistant, Heebo, Rubik } from "next/font/google"

import "./globals.css"
import { AccessibilityButton } from "@/components/shared/accessibility-button"
import { RouteFocus } from "@/components/shared/route-focus"
import { ServiceWorkerRegister } from "@/components/shared/service-worker-register"
import { rootMetadata } from "@/lib/root-metadata"
import {
  getPageSeo,
  pageSeoDescription,
  pageShareImage,
} from "@/lib/seo/page-seo"
import { getSiteSeo } from "@/lib/seo/site-seo"
import { siteUrl } from "@/lib/site-url"
import { cn } from "@/lib/utils"

// Fonts per DESIGN.md: Assistant for body text, Heebo for headings. Both are
// self-hosted by next/font (no third-party request on token routes).
const fontSans = Assistant({
  subsets: ["hebrew", "latin"],
  variable: "--font-sans",
  display: "swap",
})

const fontHeading = Heebo({
  subsets: ["hebrew", "latin"],
  variable: "--font-heading",
  display: "swap",
})

// The home promo banner's face only (fix 15, user decision 2026-10-22):
// bold Rubik reads as an announcement. Not preloaded: one strip uses it.
const fontPromo = Rubik({
  subsets: ["hebrew", "latin"],
  weight: "700",
  variable: "--font-promo",
  display: "swap",
  preload: false,
})

// "{page name} · {business name}" on every page: the published name
// (story 5.20), else the WORDMARK. The site description and share image
// come from the published home hero, else the default image
// (fix-search-ready); the share image is the content editor's site image
// first (fix-search-ready, fix-seo-editor). All readers are cached, so the
// metadata stays in the static shell.
export async function generateMetadata(): Promise<Metadata> {
  const [site, seo] = await Promise.all([getSiteSeo(), getPageSeo()])
  const base = siteUrl()
  return rootMetadata(site.name, {
    siteUrl: base,
    description: pageSeoDescription(seo, null, site),
    image: pageShareImage(seo, null, site, base),
  })
}

// The olive of the manifest's theme_color (DESIGN.md primary).
export const viewport: Viewport = {
  themeColor: "#4A4A2A",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={cn(
        "antialiased",
        "font-sans",
        fontSans.variable,
        fontHeading.variable,
        fontPromo.variable
      )}
    >
      <body>
        {/* Once for the whole app, so a cross-shell navigation (/login -> /me)
            also moves focus to the new page's h1. */}
        {/* usePathname needs a Suspense boundary (cacheComponents). */}
        <Suspense fallback={null}>
          <RouteFocus />
        </Suspense>
        {children}
        {/* Story 5.25: every page but /admin (usePathname, own Suspense). */}
        <Suspense fallback={null}>
          <AccessibilityButton />
        </Suspense>
        <ServiceWorkerRegister />
      </body>
    </html>
  )
}
