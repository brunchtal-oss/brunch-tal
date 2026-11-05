// The site's base URL (fix-search-ready), without a trailing slash: the
// metadataBase, the sitemap's URLs, robots.txt's sitemap line and the
// structured data. NEXT_PUBLIC_SITE_URL (the final domain, set at handover)
// when it is a valid http(s) URL, else Vercel's production domain, else the
// local dev server.
export type SiteUrlEnv = {
  NEXT_PUBLIC_SITE_URL?: string
  VERCEL_PROJECT_PRODUCTION_URL?: string
  [name: string]: string | undefined
}

const LOCAL = "http://localhost:3000"

function httpUrl(value: string | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "")
  } catch {
    return null
  }
}

export function siteUrl(env: SiteUrlEnv = process.env): string {
  const explicit = httpUrl(env.NEXT_PUBLIC_SITE_URL)
  if (explicit) return explicit
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (vercel) return httpUrl(`https://${vercel}`) ?? LOCAL
  return LOCAL
}
