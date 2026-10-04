import { networkInterfaces } from "node:os"

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

// /login?next=/join/<token> (an existing account logs in to claim a join
// link, story 2.3) carries the token in its query: it is neither logged nor
// sent as a referrer. The value may arrive encoded (%2F).
const LOGIN_WITH_JOIN_NEXT = /^\/login\?(?:.*&)?next=(?:\/|%2F)join(?:\/|%2F)/i

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for 'use cache' / cacheTag / updateTag (architecture spine AD-16).
  cacheComponents: true,

  allowedDevOrigins: privateIPv4Addresses(),

  // AGENTS.md is curated by hand; `next dev` must not append its own rules.
  agentRules: false,

  // Token routes are never logged (AD-16). The dev logger also prints Server
  // Function arguments (token, form data), so that log is off.
  logging: {
    incomingRequests: { ignore: [/\/(reset|join)\//, LOGIN_WITH_JOIN_NEXT] },
    serverFunctions: false,
  },

  // About is a section of the home page, not a page (user decision
  // 2026-10-04); an old /about link lands on home.
  async redirects() {
    return [{ source: "/about", destination: "/", permanent: false }]
  },

  async headers() {
    return [
      // Token routes (AD-16): no referrer leaks the token, nothing is cached.
      {
        source: "/reset/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }, noStore],
      },
      {
        source: "/join/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }, noStore],
      },
      // The query value is decoded before matching (anchored by Next).
      {
        source: "/login",
        has: [{ type: "query", key: "next", value: "/join/.*" }],
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
