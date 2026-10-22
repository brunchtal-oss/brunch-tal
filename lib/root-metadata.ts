import type { Metadata } from "next"

import { titleTemplateOf } from "@/lib/copy/shell"

// The root layout's metadata for a business name (story 5.20): the tab
// title "{page name} · {name}", the name alone on a page without its own
// title, and the name under the icon on an iPhone home screen (story 5.9:
// full screen). The manifest link is added by app/manifest.ts.
export function rootMetadata(name: string): Metadata {
  return {
    title: { default: name, template: titleTemplateOf(name) },
    appleWebApp: { capable: true, title: name },
    icons: { apple: "/icons/apple-touch-icon.png" },
  }
}
