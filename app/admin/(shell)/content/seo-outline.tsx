import Link from "next/link"

import { adminCopy } from "@/lib/copy/admin"
import type { OutlineEntry } from "@/lib/seo/outline"
import { cn } from "@/lib/utils"

const copy = adminCopy.content.seo

// The page's headings under its H1 (fix-seo-editor, lib/seo/outline.ts), as
// the site shows them now: an H3 is indented under its H2 with a thin rule
// at inline-start, the level marked in small type (it is the information:
// Google reads the order of levels). A heading from content opens its field
// in the section's editor; a fixed one and the automatic session names have
// no link.
export function SeoOutline({ entries }: { entries: readonly OutlineEntry[] }) {
  return (
    <section aria-labelledby="seo-outline" className="flex flex-col gap-2">
      <h2 id="seo-outline" className="text-[15px] font-semibold">
        {copy.outline}
      </h2>
      <p className="text-[13px] text-pretty text-muted-foreground">
        {copy.outlineHint}
      </p>
      {entries.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">{copy.outlineEmpty}</p>
      ) : (
        <ol className="flex flex-col border-t border-border">
          {entries.map((entry, index) => (
            <li
              key={`${index}-${entry.text}`}
              className={cn(
                "flex min-h-11 items-center gap-3 border-b border-border",
                entry.level === 3 && "ms-4 border-s border-s-border ps-3"
              )}
            >
              <span className="w-6 shrink-0 text-[13px] text-muted-foreground tabular-nums">
                {`H${entry.level}`}
              </span>
              {entry.href ? (
                <Link
                  href={entry.href}
                  className="min-w-0 py-2 text-[15px] break-words underline underline-offset-4"
                >
                  {entry.text}
                </Link>
              ) : (
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 py-2 text-[15px] break-words">
                  {entry.text}
                  {!entry.auto && (
                    <span className="text-[13px] text-muted-foreground">
                      {copy.outlineFixed}
                    </span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
