import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"

import {
  parseNotesParams,
  selectedTopic,
  toNotes,
  toTopics,
} from "./notes-data"
import { NotesView } from "./notes-view"

const copy = adminCopy.notes

export const metadata: Metadata = {
  title: copy.title,
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// /admin/notes (story 4.11, CAP-39), from "עוד": topics Tal creates and free
// notes inside them. The selected topic is ?topic= (else the first), its
// archive is ?archive=1. note_topics and notes are read with the admin's
// RLS; every write is an admin RPC (./actions.ts). Rendered inside the
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
  const { topicId, archive } = parseNotesParams(await searchParams)
  const supabase = await createClient()
  const topicsRead = await supabase
    .from("note_topics")
    .select("id, name, sort_order")
  if (topicsRead.error) throw new Error("note topics read failed")
  const topics = toTopics(topicsRead.data)
  const topic = selectedTopic(topics, topicId)

  let notes: ReturnType<typeof toNotes> = []
  if (topic) {
    const notesRead = await supabase
      .from("notes")
      .select("id, body, pinned, done, archived_at, sort_order")
      .eq("topic_id", topic.id)
    if (notesRead.error) throw new Error("notes read failed")
    notes = toNotes(notesRead.data)
  }

  return (
    <NotesView
      topics={topics}
      topic={topic}
      notes={notes}
      showArchive={archive}
    />
  )
}
