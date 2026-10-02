import { splitContact } from "./join-view"

// A join message whose contact phrase links to Tal's WhatsApp (round 2,
// user decision 2026-10-02). Without published business details (href null)
// or without the phrase, the text stays plain. The link never sends a
// referrer (the page URL holds the token).
export function ContactText({
  text,
  href,
}: {
  text: string
  href: string | null
}) {
  const parts = href ? splitContact(text) : null
  if (!parts) return <>{text}</>
  return (
    <>
      {parts.before}
      <a
        href={href!}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold underline underline-offset-4"
      >
        {parts.phrase}
      </a>
      {parts.after}
    </>
  )
}
