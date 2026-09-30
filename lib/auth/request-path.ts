// The proxy copies the requested path (with query) into this request header,
// because a layout cannot read its own URL. The shell guards use it only as
// the `next` of the login redirect, and the login page passes `next` through
// safeNext/destinationFor, so a forged value leads nowhere outside the site.
// The proxy always overwrites whatever the browser sent.
export const REQUEST_PATH_HEADER = "x-request-path"

export function requestPathOf(url: { pathname: string; search: string }) {
  return `${url.pathname}${url.search}`
}

// The header value if it is a path inside `area` ("/me", "/admin"), else the
// area itself.
export function shellPath(value: string | null, area: string): string {
  if (
    value &&
    (value === area ||
      value.startsWith(`${area}/`) ||
      value.startsWith(`${area}?`))
  ) {
    return value
  }
  return area
}
