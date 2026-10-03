import "server-only"

import { headers } from "next/headers"

// The full join link of a raw token, built where the RPC returned it (the
// raw token is shown once, AD-10). The site's address is the one the browser
// sent (the Origin of this POST), so the link works on every deployment and
// on the home network in dev. null when no address can be read.
export async function joinLinkFor(token: string): Promise<string | null> {
  const origin = await requestOrigin()
  return origin ? `${origin}/join/${token}` : null
}

async function requestOrigin(): Promise<string | null> {
  const h = await headers()
  const origin = h.get("origin")
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin
  const host = h.get("x-forwarded-host") ?? h.get("host")
  if (!host) return null
  const proto = h.get("x-forwarded-proto") ?? "https"
  return `${proto}://${host}`
}
