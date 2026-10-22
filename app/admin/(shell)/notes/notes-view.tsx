"use client"

import { useCallback, useState } from "react"
import Link from "next/link"

import { TEXT_BUTTON } from "@/components/admin/edit-kit"
import { AnnounceContext } from "@/components/admin/use-work-action"
import { InlineNotice } from "@/components/shared/inline-notice"
import { sectionTitleClass } from "@/components/shared/section-title"
import { adminCopy } from "@/lib/copy/admin"
import { cn } from "@/lib/utils"

import { AddNote, ArchivedNoteItem, NoteItem } from "./note-item"
import { notesHref, type Note } from "./notes-data"

// The notes tab (story 4.11; fix 13: one board, sketch A "לוח פתקים"): "+
// פתק" (opens a sheet), then every shown note as a paper card in a grid (2
// columns on the phone, 3 from md), in board order (pinned first, on a
// muted ground with a strip of tape). Archived notes are hidden; "להציג
// ארכיון" shows them under the board with "החזרה". No optimistic update:
// every control is locked until the refreshed page arrives, and the result
// shows in an inline-notice (also read by screen readers).

const copy = adminCopy.notes

export function NotesView({
  notes,
  showArchive,
}: {
  notes: readonly Note[]
  showArchive: boolean
}) {
  const [notice, setNotice] = useState("")
  const announce = useCallback((text: string) => {
    // A repeated text is shown and announced again.
    setNotice("")
    queueMicrotask(() => setNotice(text))
  }, [])
  const active = notes.filter((n) => !n.archived)
  const archived = notes.filter((n) => n.archived)

  return (
    <AnnounceContext value={announce}>
      <div className="flex flex-col gap-5">
        <div aria-live="polite" className="empty:hidden">
          {notice && <InlineNotice tone="success">{notice}</InlineNotice>}
        </div>

        {active.length === 0 ? (
          // empty-state (DESIGN › empty-state): the sentence and one action.
          // Every note archived: says so instead of the empty board's text.
          <div className="flex flex-col items-center gap-4 rounded-lg bg-muted px-4 py-6 text-center">
            <p className={sectionTitleClass}>
              {archived.length > 0 ? copy.allArchived : copy.emptyBoard}
            </p>
            <AddNote wide />
          </div>
        ) : (
          <>
            <AddNote />
            <ul
              aria-label={copy.board}
              className="grid grid-cols-2 items-start gap-3 pt-1 md:grid-cols-3"
            >
              {active.map((note, index) => (
                <NoteItem
                  key={note.id}
                  note={note}
                  notes={notes}
                  tilt={index % 3}
                />
              ))}
            </ul>
          </>
        )}

        <div className="flex flex-col gap-3 pt-2">
          <Link
            href={notesHref(!showArchive)}
            scroll={false}
            className={cn(TEXT_BUTTON, "self-start font-semibold")}
          >
            {showArchive ? copy.hideArchive : copy.showArchive}
          </Link>
          {showArchive && (
            <section aria-labelledby="notes-archive" className="flex flex-col">
              <h2
                id="notes-archive"
                className="text-[13px] font-semibold text-muted-foreground"
              >
                {copy.archiveTitle}
              </h2>
              {archived.length === 0 ? (
                <p className="py-3 text-muted-foreground">{copy.noArchive}</p>
              ) : (
                <ul className="flex flex-col">
                  {archived.map((note) => (
                    <ArchivedNoteItem key={note.id} note={note} />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </AnnounceContext>
  )
}
