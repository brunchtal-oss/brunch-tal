"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ChevronLeftIcon, CroissantIcon } from "lucide-react"

import { StatusChip } from "@/components/shared/status-chip"
import { adminCopy } from "@/lib/copy/admin"
import { objectPosition, publicMediaUrl } from "@/lib/media/photo"

import { visibleConcepts, type ConceptRow } from "./concept-draft"

const copy = adminCopy.concepts

// The rows of /admin/concepts (story 4.8): the concept's photo (a square, at
// its focus point; the session card's muted surface without one), its
// name, its kind and "בארכיון" for an archived one. The archived concepts
// are behind "להציג ארכיון" (below the active ones). A row leads to the
// editor.
export function ConceptsList({ rows }: { rows: readonly ConceptRow[] }) {
  const [showArchive, setShowArchive] = useState(false)
  const shown = visibleConcepts(rows, showArchive)
  const hasArchive = rows.some((row) => row.archived_at !== null)

  return (
    <div className="flex flex-col gap-4">
      {shown.length === 0 ? (
        <p className="text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="flex flex-col border-t border-border">
          {shown.map((row) => (
            <li key={row.id} className="border-b border-border">
              <Link
                href={`/admin/concepts/${row.id}`}
                className="flex min-h-16 items-center gap-3 py-3"
              >
                <Thumb row={row} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-base font-semibold break-words">
                    <bdi>{row.name}</bdi>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                    {copy.kinds[row.default_kind]}
                    {row.archived_at !== null && (
                      <StatusChip tone="expired">
                        {copy.archivedChip}
                      </StatusChip>
                    )}
                  </span>
                </span>
                <ChevronLeftIcon
                  aria-hidden
                  strokeWidth={1.5}
                  className="size-5 shrink-0 text-muted-foreground"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {hasArchive && (
        <button
          type="button"
          aria-expanded={showArchive}
          onClick={() => setShowArchive((current) => !current)}
          className="min-h-11 self-start px-1 text-base underline underline-offset-[3px]"
        >
          {showArchive ? copy.hideArchive : copy.showArchive}
        </button>
      )}
    </div>
  )
}

// Decorative: the name next to it says which concept it is.
function Thumb({ row }: { row: ConceptRow }) {
  const image = row.image
  return (
    <span className="relative size-14 shrink-0 overflow-hidden rounded-sm bg-muted">
      {row.image_path && image ? (
        <Image
          src={publicMediaUrl(row.image_path)}
          alt=""
          fill
          sizes="56px"
          className="object-cover"
          style={{
            objectPosition: objectPosition(image.focus_x, image.focus_y),
          }}
        />
      ) : (
        <span aria-hidden className="grid size-full place-items-center">
          <CroissantIcon strokeWidth={1} className="size-7 text-brand-accent" />
        </span>
      )}
    </span>
  )
}
