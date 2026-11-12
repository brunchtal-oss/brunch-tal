import { networkInterfaces } from "node:os"

import { isIndexable, NOINDEX_SOURCES } from "./lib/seo/indexing.mjs"

// Private IPv4 addresses of this machine, so a phone on the home network can
// open the dev server (http://<ip>:3000). Dev only; ignored by `next build`.
function privateIPv4Addresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((net) => net && net.family === "IPv4" && !net.internal)
    .map((net) => net.address)
    .filter((address) =>
      /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)
    )
}

const noStore = { key: "Cache-Control", value: "private, no-store" }

const noindex = { key: "X-Robots-Tag", value: "noindex, nofollow" }

// Story 5.15 (moved forward, user decision 2026-10-10): the site is open
// without the lock but kept out of search engines until the launch (6.9),
// with app/robots.ts. fix-search-ready: once SITE_INDEXABLE is on in
// production, only the private, auth, token, app-only and API paths keep the
// header. The env is read each time headers() runs, which in practice is at
// build, so a change needs a redeploy.
function noindexRules(env = process.env) {
  if (!isIndexable(env)) return [{ source: "/:path*", headers: [noindex] }]
  return NOINDEX_SOURCES.map((source) => ({ source, headers: [noindex] }))
}

// Published images (story 5.4): next/image optimizes only the public files
// of the Supabase project (media-public). Drafts are never optimized (the
// admin preview uses signed URLs with `unoptimized`).
function supabaseImagePatterns() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!raw) return []
  try {
    const url = new URL(raw)
    return [
      {
        protocol: url.protocol.replace(":", ""),
        hostname: url.hostname,
        port: url.port,
        pathname: "/storage/v1/object/public/media-public/**",
      },
    ]
  } catch {
    return []
  }
}

// The login pages may carry a token in their next (/login?next=/join/<token>,
// story 2.3; /login?next=/verify-email?token=..., story 6.11): they are
// never logged, and send no referrer and nothing cached, whatever the query
// (the simplest rule that covers every next).
const LOGIN_PAGES = /^\/(?:admin\/)?login(?:[/?#]|$)/

// Story 6.11: the email links carry their token in the query
// (/verify-email?token=..., our own; /reset-password?token_hash=..., Auth's).
const EMAIL_LINK_ROUTES = /^\/(?:verify-email|reset-password)(?:[/?#]|$)/

// Bots that get the whole HTML at once (metadata in <head>, no streamed
// Suspense content) instead of the streamed page (fix-seo-editor). Next's
// own list, copied from the installed version
// (next/dist/shared/lib/router/utils/html-bots.js; next.config.test.ts checks
// it is still all here after an upgrade), plus the AI search and answer
// crawlers, which read the HTML without running scripts.
const NEXT_HTML_LIMITED_BOTS =
  "[\\w-]+-Google|Google-[\\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight"
const AI_HTML_LIMITED_BOTS =
  "GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-SearchBot|Claude-User|PerplexityBot|Perplexity-User|CCBot"
export const HTML_LIMITED_BOTS = new RegExp(
  `${NEXT_HTML_LIMITED_BOTS}|${AI_HTML_LIMITED_BOTS}`,
  "i"
)

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for 'use cache' / cacheTag / updateTag (architecture spine AD-16).
  cacheComponents: true,

  allowedDevOrigins: privateIPv4Addresses(),

  htmlLimitedBots: HTML_LIMITED_BOTS,

  images: {
    remotePatterns: supabaseImagePatterns(),
    // A hidden (deleted) photo leaves the optimizer's cache within the
    // upstream max-age (600s, set at upload) instead of the default 4 hours.
    minimumCacheTTL: 60,
  },

  // AGENTS.md is curated by hand; `next dev` must not append its own rules.
  agentRules: false,

  // Token routes are never logged (AD-16). The dev logger also prints Server
  // Function arguments (token, form data), so that log is off.
  logging: {
    incomingRequests: {
      ignore: [/\/(reset|join)\//, LOGIN_PAGES, EMAIL_LINK_ROUTES],
    },
    serverFunctions: false,
  },

  // About is a section of the home page, not a page (user decision
  // 2026-10-04); an old /about link lands on home, for good (308, so a
  // search engine moves the link to home; fix-search-ready).
  async redirects() {
    return [{ source: "/about", destination: "/", permanent: true }]
  },

  async headers() {
    return [
      ...noindexRules(),
      // Token routes (AD-16): no referrer leaks the token, nothing is cached.
      {
        source: "/reset/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }, noStore],
      },
      {
        source: "/join/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }, noStore],
      },
      // Story 6.11: the email links (their token is in the query).
      {
        source: "/verify-email",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }, noStore],
      },
      {
        source: "/reset-password",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }, noStore],
      },
      // The login pages, always (their next may carry a token).
      {
        source: "/login",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }, noStore],
      },
      {
        source: "/admin/login",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }, noStore],
      },
      { source: "/me", headers: [noStore] },
      { source: "/me/:path*", headers: [noStore] },
      { source: "/admin", headers: [noStore] },
      { source: "/admin/:path*", headers: [noStore] },
      // The service worker (story 5.9, AD-16): always checked against the
      // server, so a new version reaches installed apps.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
        ],
      },
    ]
  },
}

export default nextConfig
