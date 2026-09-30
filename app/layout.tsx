import { Suspense } from "react"
import type { Metadata } from "next"
import { Assistant, Heebo } from "next/font/google"

import "./globals.css"
import { RouteFocus } from "@/components/shared/route-focus"
import { shellCopy } from "@/lib/copy/shell"
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

// "{page name} · בראנץ׳ אצל טל" on every page.
export const metadata: Metadata = {
  title: {
    default: shellCopy.wordmark,
    template: shellCopy.titleTemplate,
  },
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
        fontHeading.variable
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
      </body>
    </html>
  )
}
