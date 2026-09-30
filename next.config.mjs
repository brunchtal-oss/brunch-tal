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
    incomingRequests: { ignore: [/\/(reset|join)\//] },
    serverFunctions: false,
  },

  async headers() {
    return [
      // Token routes (AD-16): no referrer leaks the token, nothing is cached.
      {
        source: "/reset/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }, noStore],
      },
      { source: "/me", headers: [noStore] },
      { source: "/me/:path*", headers: [noStore] },
      { source: "/admin", headers: [noStore] },
      { source: "/admin/:path*", headers: [noStore] },
    ]
  },
}

export default nextConfig
