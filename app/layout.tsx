import { Assistant, Heebo } from "next/font/google"

import "./globals.css"
import { cn } from "@/lib/utils"

// Fonts per DESIGN.md: Assistant for body text, Heebo for headings.
const fontSans = Assistant({
  subsets: ["hebrew", "latin"],
  variable: "--font-sans",
})

const fontHeading = Heebo({
  subsets: ["hebrew", "latin"],
  variable: "--font-heading",
})

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
      )}
    >
      <body>{children}</body>
    </html>
  )
}
