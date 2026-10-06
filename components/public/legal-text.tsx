import { Fragment } from "react"

import { shellCopy } from "@/lib/copy/shell"
import { cn } from "@/lib/utils"

// The text of a legal page (story 5.5): plain text Tal writes in the editor,
// with a small syntax, turned into React elements (never raw HTML; React
// escapes every string):
//   a blank line        -> a new paragraph
//   a line "## title"   -> a heading (h2; only at the start of its own line,
//                          "##" anywhere else is text)
//   lines "- item"      -> a bulleted list
//   **bold**            -> <strong>
//   [text](url)         -> a link, only for https:, tel: and mailto:;
//                          any other address is plain text (the label)
//   a single line break -> kept inside the paragraph (<br>)
// An https: link opens in a new tab (rel="noopener noreferrer").

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "link"; href: string; external: boolean; children: Inline[] }

export type LegalBlock =
  | { type: "heading"; text: Inline[] }
  | { type: "paragraph"; lines: Inline[][] }
  | { type: "list"; items: Inline[][] }

// [label](url): the url may hold one level of balanced parentheses.
const TOKEN =
  /\*\*([^*\n]+?)\*\*|\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g

const LIST_ITEM = /^\s*-\s+/
const HEADING = /^##[ \t]+(\S.*)$/

// The legal pages' h2 (display, light): the headings of a text and the
// accessibility statement's fixed headings look the same.
export const LEGAL_HEADING =
  "font-heading text-[24px] leading-[1.25] font-light text-balance"

// The address of a link when it is allowed, else null.
export function safeHref(
  raw: string
): { href: string; external: boolean } | null {
  const url = raw.trim()
  if (/^https:\/\//i.test(url)) {
    try {
      return new URL(url).protocol === "https:"
        ? { href: url, external: true }
        : null
    } catch {
      return null
    }
  }
  // At least one digit: "tel:()" is not a phone.
  if (/^tel:\+?[\d\-\s()]+$/i.test(url) && /\d/.test(url)) {
    return {
      href: `tel:${url.slice(4).replace(/[^\d+]/g, "")}`,
      external: false,
    }
  }
  if (/^mailto:[^\s@<>"]+@[^\s@<>"]+$/i.test(url)) {
    return { href: url, external: false }
  }
  return null
}

export function parseInline(text: string, inStrong = false): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0
    if (index > last) out.push({ type: "text", text: text.slice(last, index) })
    last = index + match[0].length
    if (match[1] !== undefined) {
      // No bold inside bold: the inner text is plain (links still work).
      out.push(
        inStrong
          ? { type: "text", text: match[1] }
          : { type: "strong", children: parseInline(match[1], true) }
      )
      continue
    }
    // The label keeps its formatting (bold inside a link).
    const label = parseInline(match[2], inStrong)
    const target = safeHref(match[3])
    // Any other address: the label as plain text, without a link.
    if (target) out.push({ type: "link", ...target, children: label })
    else out.push(...label)
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) })
  return out
}

export function parseLegalText(text: string): LegalBlock[] {
  const blocks: LegalBlock[] = []
  const chunks = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((chunk) => chunk.replace(/^\n+|\n+$/g, ""))
    .filter((chunk) => chunk.trim() !== "")
  for (const chunk of chunks) {
    // Inside a chunk, list lines and other lines alternate as runs.
    let run: { list: boolean; lines: string[] } | null = null
    const flush = () => {
      if (!run) return
      blocks.push(
        run.list
          ? {
              type: "list",
              items: run.lines.map((line) =>
                parseInline(line.replace(LIST_ITEM, ""))
              ),
            }
          : { type: "paragraph", lines: run.lines.map((l) => parseInline(l)) }
      )
      run = null
    }
    for (const line of chunk.split("\n")) {
      const heading = HEADING.exec(line.trim())
      if (heading) {
        flush()
        blocks.push({ type: "heading", text: parseInline(heading[1].trim()) })
        continue
      }
      const list = LIST_ITEM.test(line)
      if (run && run.list !== list) flush()
      if (!run) run = { list, lines: [] }
      run.lines.push(line)
    }
    flush()
  }
  return blocks
}

const LINK = "font-semibold underline underline-offset-4 break-words"

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return nodes.map((node, index) => {
    if (node.type === "text")
      return <Fragment key={index}>{node.text}</Fragment>
    if (node.type === "strong") {
      return (
        <strong key={index} className="font-semibold">
          <InlineNodes nodes={node.children} />
        </strong>
      )
    }
    return node.external ? (
      <a
        key={index}
        href={node.href}
        target="_blank"
        rel="noopener noreferrer"
        className={LINK}
      >
        <InlineNodes nodes={node.children} />
        <span className="sr-only">
          {" "}
          {shellCopy.public.contact.opensOutside}
        </span>
      </a>
    ) : (
      <a key={index} href={node.href} className={LINK}>
        <InlineNodes nodes={node.children} />
      </a>
    )
  })
}

// The rendered text (body-lg, start-aligned, kept under ~65 characters by
// the page's column).
export function LegalText({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 text-[17px] leading-[1.7] text-pretty",
        className
      )}
    >
      {parseLegalText(text).map((block, index) =>
        block.type === "heading" ? (
          <h2 key={index} className={cn(LEGAL_HEADING, index > 0 && "mt-6")}>
            <InlineNodes nodes={block.text} />
          </h2>
        ) : block.type === "paragraph" ? (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                <InlineNodes nodes={line} />
              </Fragment>
            ))}
          </p>
        ) : (
          <ul key={index} className="flex list-disc flex-col gap-2 ps-5">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <InlineNodes nodes={item} />
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}
