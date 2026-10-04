import { createHash, createHmac, timingSafeEqual } from "node:crypto"

import { siteLockCopy } from "@/lib/copy/site-lock"

// Site lock until launch (story 1.6, architecture AD-22). Pure decision used
// by `proxy.ts`: every request needs HTTP Basic Auth, except the
// machine-to-machine prefixes below. Each exempt route MUST verify its own
// secret or signature (e.g. `/api/jobs/*` checks CRON_SECRET, E3).
// Story 5.9 lets the site be installed while locked: the manifest and icons
// are public files, a passed lock is remembered in a signed cookie, and a
// browser page gets a sign-in form (POST /site-lock) along with the 401.

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

/**
 * Public files that skip the lock so the site can be installed while locked
 * (story 5.9): the browser fetches the manifest and its icons without
 * credentials. An entry ending in "/" is a prefix, any other is exact. Not
 * routes: nothing here verifies a secret, so only static files belong here.
 */
export const SITE_LOCK_PUBLIC_FILES = [
  "/manifest.webmanifest",
  "/icons/",
] as const

export function isPublicFile(pathname: string): boolean {
  return SITE_LOCK_PUBLIC_FILES.some((entry) =>
    entry.endsWith("/") ? pathname.startsWith(entry) : pathname === entry
  )
}

/** Remembers a passed lock, because an installed iPhone app shows no Basic
 * Auth prompt (story 5.9). */
export const SITE_LOCK_COOKIE = "site_lock"
const SITE_LOCK_COOKIE_MAX_AGE = 60 * 60 * 24 * 30

/** The form that the 401 carries posts here; handled inside proxy.ts. */
export const SITE_LOCK_FORM_PATH = "/site-lock"

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

// Trimmed: a value pasted into the Vercel dashboard may carry a stray space
// or newline that nobody can type back in the browser prompt. Null when
// either is missing: locked without credentials, nobody gets in (fail-closed).
function expectedCredentials(
  env: SiteLockEnv
): { user: string; password: string } | null {
  const user = (env.SITE_LOCK_USER ?? "").trim()
  const password = (env.SITE_LOCK_PASSWORD ?? "").trim()
  return user && password ? { user, password } : null
}

// Both comparisons always run, so timing does not reveal which one failed.
function credentialsMatch(
  given: { user: string; password: string },
  expected: { user: string; password: string }
): boolean {
  const userOk = sameSecret(given.user, expected.user)
  const passwordOk = sameSecret(given.password, expected.password)
  return userOk && passwordOk
}

// HMAC-SHA256 of the user keyed by the password: never the password itself,
// and changing either one voids every cookie already issued.
function cookieValue(expected: { user: string; password: string }): string {
  return createHmac("sha256", expected.password)
    .update(expected.user, "utf8")
    .digest("base64url")
}

export type SiteLockAccess = {
  decision: SiteLockDecision
  /** A cookie value to store: valid Basic Auth arrived without a valid cookie. */
  issueCookie: string | null
}

export function siteLockAccess(
  pathname: string,
  authorization: string | null,
  cookie: string | null,
  env: SiteLockEnv
): SiteLockAccess {
  const allow = { decision: "allow", issueCookie: null } as const
  const deny = { decision: "deny", issueCookie: null } as const
  if (!isSiteLocked(env)) return allow
  if (isExemptPath(pathname) || isPublicFile(pathname)) return allow

  const expected = expectedCredentials(env)
  if (!expected) return deny

  const valid = cookieValue(expected)
  const cookieOk = cookie !== null && sameSecret(cookie, valid)
  const given = parseBasic(authorization)
  const basicOk = given !== null && credentialsMatch(given, expected)

  if (basicOk && !cookieOk) return { decision: "allow", issueCookie: valid }
  return basicOk || cookieOk ? allow : deny
}

export function checkSiteLock(
  pathname: string,
  authorization: string | null,
  env: SiteLockEnv,
  cookie: string | null = null
): SiteLockDecision {
  return siteLockAccess(pathname, authorization, cookie, env).decision
}

export function siteLockCookieHeader(value: string): string {
  return `${SITE_LOCK_COOKIE}=${value}; Path=/; Max-Age=${SITE_LOCK_COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`
}

/** Where the form returns: a path on this site only, else "/". */
export function safeLockNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/"
  // A backslash is read as "/" by browsers ("/\evil" = "//evil"); control
  // characters have no place in a path.
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (char === "\\" || code < 0x20 || code === 0x7f) return "/"
  }
  // The form's own path has no page (GET /site-lock is a 404).
  const path = value.split(/[?#]/, 1)[0]
  if (path === SITE_LOCK_FORM_PATH) return "/"
  return value
}

/** A denied GET that a browser renders as a page gets the form. */
export function wantsLockForm(method: string, accept: string | null): boolean {
  return method === "GET" && (accept ?? "").includes("text/html")
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char])
}

// Self-contained page (no app CSS or fonts, nothing else is reachable while
// locked except the icons): DESIGN.md colours, one narrow column, the app
// icon's plate on top.
function siteLockFormHtml(next: string, error: boolean): string {
  const copy = siteLockCopy
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#4A4A2A">
<meta name="robots" content="noindex">
<title>${escapeHtml(copy.title)}</title>
<style>
*{box-sizing:border-box}
html{background:#FAF6EE;color:#2E2A1F;font-family:Assistant,Heebo,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;-webkit-text-size-adjust:100%}
body{margin:0;min-height:100svh}
main{max-width:24rem;margin:0 auto;padding:4rem 1.5rem 2.5rem;display:flex;flex-direction:column;gap:1.5rem}
img{display:block;width:56px;height:56px;border-radius:14px}
h1{margin:0;font-family:Heebo,Assistant,system-ui,sans-serif;font-weight:300;font-size:26px;line-height:1.2}
form{display:flex;flex-direction:column;gap:1rem}
label{display:flex;flex-direction:column;gap:.375rem;font-size:15px;font-weight:600}
input{font:inherit;font-size:16px;font-weight:400;min-height:44px;padding:0 .75rem;border:1px solid #6B6450;border-radius:6px;background:#FFFDF8;color:#2E2A1F}
input:focus-visible,button:focus-visible{outline:3px solid rgba(74,74,42,.5);outline-offset:2px}
button{font:inherit;font-size:16px;font-weight:600;min-height:48px;border:0;border-radius:6px;background:#4A4A2A;color:#FAF6EE;cursor:pointer;margin-top:.5rem}
.error{margin:0;padding:.75rem 1rem;border-radius:8px;background:#F8E4E1;color:#B42318;font-size:15px}
</style>
</head>
<body>
<main>
<img src="/icons/icon-192.png" alt="">
<h1>${escapeHtml(copy.title)}</h1>
${error ? `<p class="error" role="alert">${escapeHtml(copy.error)}</p>\n` : ""}<form method="post" action="${SITE_LOCK_FORM_PATH}">
<input type="hidden" name="next" value="${escapeHtml(next)}">
<label>${escapeHtml(copy.user)}<input name="user" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
<label>${escapeHtml(copy.password)}<input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit">${escapeHtml(copy.submit)}</button>
</form>
</main>
</body>
</html>`
}

/** The 401 for a browser page: still asks for Basic Auth, and carries the
 * form for an app that shows no prompt (installed iPhone app). */
export function siteLockFormResponse(next: string, error = false): Response {
  return new Response(siteLockFormHtml(safeLockNext(next), error), {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="brunch-at-tals", charset="UTF-8"',
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  })
}

/** POST /site-lock: correct credentials go to `next` with the cookie (303),
 * wrong ones get the form again with the error. */
export function handleSiteLockPost(
  form: { user: string | null; password: string | null; next: string | null },
  env: SiteLockEnv,
  origin: string
): Response {
  const next = safeLockNext(form.next)
  const expected = expectedCredentials(env)
  const ok =
    expected !== null &&
    credentialsMatch(
      { user: form.user ?? "", password: form.password ?? "" },
      expected
    )
  if (!expected || !ok) return siteLockFormResponse(next, true)
  return new Response(null, {
    status: 303,
    headers: {
      // Absolute: Next rejects a relative Location from the proxy. `next` is
      // a path (safeLockNext), so it stays on this origin.
      Location: new URL(next, origin).href,
      "Set-Cookie": siteLockCookieHeader(cookieValue(expected)),
      "Cache-Control": "no-store",
    },
  })
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
