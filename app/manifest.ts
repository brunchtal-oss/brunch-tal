import type { MetadataRoute } from "next"

import { WORDMARK } from "@/lib/copy/shell"

// The web app manifest (story 5.9), served at /manifest.webmanifest. The site
// lock lets it and /icons/ through (SITE_LOCK_PUBLIC_FILES), so the site can
// be installed while locked. Colours from DESIGN.md (primary, background).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: WORDMARK,
    short_name: WORDMARK,
    lang: "he",
    dir: "rtl",
    display: "standalone",
    start_url: "/me",
    scope: "/",
    theme_color: "#4A4A2A",
    background_color: "#FAF6EE",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
