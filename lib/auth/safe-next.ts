// Returns an internal path (with query and hash) safe to redirect to after
// login, or null. Rejects absolute URLs, protocol-relative URLs ("//host"),
// backslash tricks ("/\host"), control characters and anything that resolves
// to another origin.
const BASE = "http://internal.invalid"

export function safeNext(value: unknown): string | null {
  if (typeof value !== "string") return null
  if (value.length === 0 || value.length > 2048) return null
  if (!value.startsWith("/")) return null
  if (value.startsWith("//") || value.startsWith("/\\")) return null
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null

  let url: URL
  try {
    url = new URL(value, BASE)
  } catch {
    return null
  }
  if (url.origin !== BASE) return null
  // Dot segments can normalize "/..//host" into "//host", which a browser
  // treats as protocol-relative: check the normalized path again.
  if (url.pathname.startsWith("//") || url.pathname.startsWith("/\\")) {
    return null
  }

  return `${url.pathname}${url.search}${url.hash}`
}
