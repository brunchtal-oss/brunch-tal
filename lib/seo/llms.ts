import { customerCopy } from "@/lib/copy/customer"
import { shellCopy } from "@/lib/copy/shell"
import { formatAgorot } from "@/lib/money"
import type { PublicSession } from "@/lib/sessions/public"
import { formatSessionDateTime } from "@/lib/time"

// /llms.txt (fix-seo-editor, the llmstxt.org format): a short Markdown map of
// the site for AI tools. The business name as the H1, the site description,
// the public pages with their descriptions, the upcoming sessions the site
// shows (concept, date and time, display price, link) and the policies.
// Published content and public sessions only; nothing about places,
// availability, the session's kind or payment.

const copy = shellCopy.public.llms

export type LlmsPage = {
  title: string
  path: string
  description?: string | null
}

export type LlmsInput = {
  name: string
  description: string | null
  /** The site's base URL (siteUrl()). */
  base: string
  pages: readonly LlmsPage[]
  sessions: readonly Pick<
    PublicSession,
    "id" | "concept_name" | "starts_at" | "display_price_agorot"
  >[]
  policies: readonly LlmsPage[]
}

/**
 * Text from content on one line, with the characters that would make
 * Markdown structure (links, headings, emphasis, quotes, code, HTML)
 * escaped, so published text can never add a link or a section.
 */
export function markdownText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*_[\]()#<>|!]/g, (char) => `\\${char}`)
    .replace(/^([-+]|\d+\.)(?=\s)/, (match) => `\\${match}`)
}

function link(title: string, url: string, detail?: string | null): string {
  const text = detail ? markdownText(detail) : ""
  return `- [${markdownText(title)}](${url})${text ? `: ${text}` : ""}`
}

export function buildLlmsTxt(input: LlmsInput): string {
  const lines: string[] = [`# ${markdownText(input.name)}`, ""]
  if (input.description) {
    lines.push(`> ${markdownText(input.description)}`, "")
  }
  lines.push(`## ${copy.pages}`, "")
  for (const page of input.pages) {
    lines.push(link(page.title, `${input.base}${page.path}`, page.description))
  }
  if (input.sessions.length > 0) {
    lines.push("", `## ${copy.sessions}`, "")
    for (const session of input.sessions) {
      const when = formatSessionDateTime(session.starts_at)
      const price =
        session.display_price_agorot !== null
          ? `, ${formatAgorot(session.display_price_agorot)}`
          : ""
      lines.push(
        link(
          customerCopy.sessionTitle(session.concept_name),
          `${input.base}/sessions/${session.id}`,
          `${when}${price}`
        )
      )
    }
  }
  if (input.policies.length > 0) {
    lines.push("", `## ${copy.policies}`, "")
    for (const page of input.policies) {
      lines.push(
        link(page.title, `${input.base}${page.path}`, page.description)
      )
    }
  }
  return `${lines.join("\n")}\n`
}
