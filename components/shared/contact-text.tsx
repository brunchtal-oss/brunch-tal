// A message whose contact phrase links to Tal's WhatsApp (user decisions
// 2026-10-02 and 2026-10-03). Without published business details (href null)
// or without the phrase, the text stays plain. The link never sends a
// referrer (a token page URL holds the token).

// A message cut around the contact phrase; null when the message has no such
// phrase.
export function splitContact(
  text: string,
  phrase: string
): { before: string; phrase: string; after: string } | null {
  const at = phrase ? text.indexOf(phrase) : -1
  if (at < 0) return null
  return {
    before: text.slice(0, at),
    phrase,
    after: text.slice(at + phrase.length),
  }
}

export function ContactText({
  text,
  href,
  phrase,
}: {
  text: string
  href: string | null
  phrase: string
}) {
  const parts = href ? splitContact(text, phrase) : null
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
