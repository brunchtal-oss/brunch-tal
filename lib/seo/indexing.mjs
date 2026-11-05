// Search indexing switch (fix-search-ready). One pure decision, read by
// next.config.mjs (the X-Robots-Tag headers) and app/robots.ts. Off by
// default: every response keeps "noindex, nofollow" and robots.txt disallows
// the whole site, as before. Story 6.9 turns it on after the domain.
// Plain JS (JSDoc types) so next.config.mjs can import it without a build.

/**
 * @typedef {{ SITE_INDEXABLE?: string, VERCEL_ENV?: string, [name: string]: string | undefined }} IndexingEnv
 */

/**
 * Indexable only when SITE_INDEXABLE is "true" (trimmed, any case) on the
 * Vercel production deployment. Preview and local are never indexable.
 * @param {IndexingEnv} env
 * @returns {boolean}
 */
export function isIndexable(env) {
  return (
    env.SITE_INDEXABLE?.trim().toLowerCase() === "true" &&
    env.VERCEL_ENV === "production"
  )
}

/**
 * The paths that keep the noindex header when the site is indexable: the
 * private areas, the auth and token pages, the app-only pages and the API.
 * robots.txt does not block them, so a crawler can read the header.
 * @type {readonly string[]}
 */
export const NOINDEX_SOURCES = Object.freeze([
  "/me",
  "/me/:path*",
  "/admin",
  "/admin/:path*",
  "/login",
  "/reset/:path*",
  "/join/:path*",
  "/offline",
  "/install",
  "/api/:path*",
])
