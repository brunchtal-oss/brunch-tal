// The brand glyphs of the footer's social links (user decision 2026-10-08;
// lucide has no brand icons). Drawn here, 24px, in currentColor, always
// decorative: the link carries the name.

export type SocialKind = "instagram" | "facebook"

const HOSTS: Record<string, SocialKind> = {
  "instagram.com": "instagram",
  "facebook.com": "facebook",
  "fb.com": "facebook",
}

/**
 * The network of a footer link's address (instagram.com, facebook.com or
 * fb.com, also with www. or m.), or null: such a link is shown as text.
 */
export function socialKind(url: string): SocialKind | null {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  host = host.replace(/^(www\.|m\.)/, "")
  return HOSTS[host] ?? null
}

export function SocialIcon({
  kind,
  className,
}: {
  kind: SocialKind
  className?: string
}) {
  if (kind === "instagram") {
    return (
      <svg
        aria-hidden
        data-social={kind}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className={className}
      >
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.25" cy="6.75" r="1" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  return (
    <svg
      aria-hidden
      data-social={kind}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.6V4.4A21 21 0 0 0 14.3 4.3c-2.3 0-3.9 1.4-3.9 4V10.5H7.8v3h2.6V21h3.1Z" />
    </svg>
  )
}
