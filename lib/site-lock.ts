import { createHash, timingSafeEqual } from "node:crypto"

// Site lock until launch (story 1.6, architecture AD-22). Pure decision used
// by `proxy.ts`: every request needs HTTP Basic Auth, except the
// machine-to-machine prefixes below. Each exempt route MUST verify its own
// secret or signature (e.g. `/api/jobs/*` checks CRON_SECRET, E3).

/** Path prefixes that skip the lock. Keep the trailing slash. */
export const SITE_LOCK_EXEMPT_PREFIXES = ["/api/jobs/"] as const

export type SiteLockEnv = {
  SITE_LOCKED?: string
  SITE_LOCK_USER?: string
  SITE_LOCK_PASSWORD?: string
  VERCEL_ENV?: string
  [name: string]: string | undefined
}

export type SiteLockDecision = "allow" | "deny"

/**
 * On Vercel (production / preview) the site is locked unless
 * SITE_LOCKED=false. Anywhere else it is locked only when SITE_LOCKED=true.
 */
export function isSiteLocked(env: SiteLockEnv): boolean {
  const flag = env.SITE_LOCKED?.trim().toLowerCase()
  const onVercel =
    env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview"
  return onVercel ? flag !== "false" : flag === "true"
}

export function isExemptPath(pathname: string): boolean {
  return SITE_LOCK_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

function parseBasic(
  header: string | null
): { user: string; password: string } | null {
  if (!header) return null
  const match = /^Basic +(\S+) *$/i.exec(header)
  if (!match) return null
  const encoded = match[1]
  if (encoded.length % 4 !== 0 || !BASE64.test(encoded)) return null
  let decoded: string
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.from(encoded, "base64")
    )
  } catch {
    return null
  }
  const colon = decoded.indexOf(":")
  if (colon < 0) return null
  return { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) }
}

// Hash both sides so the comparison takes the same time whatever the lengths.
function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given, "utf8").digest()
  const b = createHash("sha256").update(expected, "utf8").digest()
  return timingSafeEqual(a, b)
}

export function checkSiteLock(
  pathname: string,
  authorization: string | null,
  env: SiteLockEnv
): SiteLockDecision {
  if (!isSiteLocked(env)) return "allow"
  if (isExemptPath(pathname)) return "allow"

  // Trimmed: a value pasted into the Vercel dashboard may carry a stray space
  // or newline that nobody can type back in the browser prompt.
  const expectedUser = (env.SITE_LOCK_USER ?? "").trim()
  const expectedPassword = (env.SITE_LOCK_PASSWORD ?? "").trim()
  // Locked without credentials configured: nobody gets in (fail-closed).
  if (!expectedUser || !expectedPassword) return "deny"

  const given = parseBasic(authorization)
  if (!given) return "deny"

  // Both comparisons always run, so timing does not reveal which one failed.
  const userOk = sameSecret(given.user, expectedUser)
  const passwordOk = sameSecret(given.password, expectedPassword)
  return userOk && passwordOk ? "allow" : "deny"
}

export function siteLockDeniedResponse(): Response {
  return new Response("האתר עדיין סגור.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="brunch-at-tals", charset="UTF-8"',
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  })
}
