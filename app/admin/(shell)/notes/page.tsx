import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"

import { parseNotesParams, toNotes } from "./notes-data"
import { NotesView } from "./notes-view"

const copy = adminCopy.notes

export const metadata: Metadata = {
  title: copy.title,
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// /admin/notes (story 4.11, CAP-39; fix 13: one board, no topics), from
// "עוד": one board of free notes; the archive is ?archive=1. notes is read
// with the admin's RLS; every write is an admin RPC (./actions.ts). Rendered inside the
// admin shell's <Suspense> gate; no cache (the notes hold names and
// phones).
export default function NotesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageHeading>{copy.title}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <NotesContent searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function NotesContent({ searchParams }: { searchParams: SearchParams }) {
  const { archive } = parseNotesParams(await searchParams)
  const supabase = await createClient()
  const notesRead = await supabase
    .from("notes")
    .select("id, body, pinned, done, archived_at, sort_order")
  if (notesRead.error) throw new Error("notes read failed")
  const notes = toNotes(notesRead.data)

  return <NotesView notes={notes} showArchive={archive} />
}
