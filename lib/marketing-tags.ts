// The marketing tags (story 5.24): three tool IDs that Tal pastes on
// /admin/marketing, never code. One module for the screen, the Server
// Action and the public view; the formats are the same as the table's
// checks and admin_update_marketing_tags
// (supabase/migrations/20261028093236_marketing_tags.sql). A blank ID is
// null and turns that tool off.

export type TagField = "ga4" | "gtm" | "pixel"

export const TAG_FIELDS: readonly TagField[] = ["ga4", "gtm", "pixel"]

export const TAG_FORMATS: Record<TagField, RegExp> = {
  ga4: /^G-[A-Z0-9]{4,15}$/,
  gtm: /^GTM-[A-Z0-9]{4,12}$/,
  pixel: /^[0-9]{10,20}$/,
}

// The table's columns (and the RPC's detail.field) of each ID.
export const TAG_COLUMNS = {
  ga4: "ga4_measurement_id",
  gtm: "gtm_container_id",
  pixel: "meta_pixel_id",
} as const satisfies Record<TagField, string>

export type MarketingTagsRow = {
  ga4_measurement_id: string | null
  gtm_container_id: string | null
  meta_pixel_id: string | null
}

export type MarketingTagsView = Record<TagField, string | null>

// Invisible format characters that an ID copied from a Hebrew (RTL) page
// can carry and trim() keeps.
const FORMAT_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g

// Format characters removed, spaces at both ends (String.prototype.trim
// covers NBSP too), upper case; blank is null.
export function normalizeTagId(raw: string | null | undefined): string | null {
  const value = (raw ?? "").replace(FORMAT_CHARS, "").trim().toUpperCase()
  return value === "" ? null : value
}

// Whether a typed value can be saved: null when it is blank or matches its
// format, "format" otherwise.
export function tagProblem(
  field: TagField,
  raw: string | null | undefined
): "format" | null {
  const value = normalizeTagId(raw)
  return value === null || TAG_FORMATS[field].test(value) ? null : "format"
}

// A stored value that is safe to put in a script: the value itself when it
// matches its format exactly, else null (the tool is off).
export function validTagId(field: TagField, value: unknown): string | null {
  return typeof value === "string" && TAG_FORMATS[field].test(value)
    ? value
    : null
}

// The public view of the row: each tool's ID, or null (off) when it is
// empty, invalid or the row is missing.
export function marketingTagsView(
  row: Partial<MarketingTagsRow> | null | undefined
): MarketingTagsView {
  return {
    ga4: validTagId("ga4", row?.ga4_measurement_id),
    gtm: validTagId("gtm", row?.gtm_container_id),
    pixel: validTagId("pixel", row?.meta_pixel_id),
  }
}

export function hasAnyTag(view: MarketingTagsView): boolean {
  return TAG_FIELDS.some((field) => view[field] !== null)
}

// The paths that are not the public site: the tags never load in a document
// that started on one, and a click to one leaves by a full page load.
const PRIVATE_PREFIXES = [
  "/me",
  "/admin",
  "/login",
  "/join",
  "/reset",
  "/offline",
  "/api",
] as const

export function isPublicPath(pathname: string): boolean {
  return !PRIVATE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

// Whether this document was first loaded at a public path, from the URL of
// its navigation entry. No entry or a URL that does not parse: false (the
// current URL may already be a later client navigation).
export function startedPublic(entryName: string | undefined): boolean {
  if (!entryName) return false
  try {
    return isPublicPath(new URL(entryName).pathname)
  } catch {
    return false
  }
}

// The inline scripts. Each takes a raw value and returns null unless it
// matches its format, so only a checked ID ever reaches a script string.

export function ga4Src(id: string): string | null {
  const valid = validTagId("ga4", id)
  return valid
    ? `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(valid)}`
    : null
}

// gtag.js with `config`: its own page_view on load and on history changes.
export function ga4InitScript(id: string): string | null {
  const valid = validTagId("ga4", id)
  if (!valid) return null
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${valid}');`
}

// The standard container loader.
export function gtmScript(id: string): string | null {
  const valid = validTagId("gtm", id)
  if (!valid) return null
  return `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${valid}');`
}

// The Meta base code: init and PageView (fbevents tracks history changes).
// autoConfig is off, so fbevents sends no button-click or metadata events.
export function metaPixelScript(id: string): string | null {
  const valid = validTagId("pixel", id)
  if (!valid) return null
  return `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('set','autoConfig',false,'${valid}');fbq('init','${valid}');fbq('track','PageView');`
}

// A click that leaves the public area: the URL to load in full, or null to
// let the click go on. Only a plain primary click on a same-origin link
// without a target or download counts.
export function exitHref(
  click: {
    button: number
    metaKey: boolean
    ctrlKey: boolean
    shiftKey: boolean
    altKey: boolean
    defaultPrevented: boolean
  },
  link: { href: string; target: string; download: boolean } | null,
  origin: string
): string | null {
  if (!link || click.defaultPrevented || click.button !== 0) return null
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey)
    return null
  if (link.download || (link.target !== "" && link.target !== "_self"))
    return null
  let url: URL
  try {
    url = new URL(link.href, origin)
  } catch {
    return null
  }
  if (url.origin !== origin) return null
  return isPublicPath(url.pathname) ? null : url.href
}
