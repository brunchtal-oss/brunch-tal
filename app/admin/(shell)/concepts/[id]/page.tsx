import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PageHeading } from "@/components/shared/page-heading"
import { StatusChip } from "@/components/shared/status-chip"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { signedDraftUrls } from "@/lib/media/drafts"
import { createClient } from "@/lib/supabase/server"

import { CONCEPT_COLUMNS, toConceptRow } from "../load-concept"
import { ConceptEditor } from "./concept-editor"

const copy = adminCopy.concepts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata: Metadata = {
  title: copy.title,
}

// One concept (story 4.8): its fields, image, archive / restore and delete.
// The list and the create form lead here. Rendered inside the admin shell's
// <Suspense> gate.
export default function ConceptPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <ConceptContent params={params} />
    </Suspense>
  )
}

async function ConceptContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("concepts")
    .select(CONCEPT_COLUMNS)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error("concept read failed")
  if (!data) notFound()
  const row = toConceptRow(data)
  // The saved image's draft file, for the preview (as a session's).
  const imageId = row.image?.media_id
  const previews = imageId ? await signedDraftUrls(supabase, [imageId]) : {}

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PageHeading>
          <bdi>{row.name}</bdi>
        </PageHeading>
        {row.archived_at !== null && (
          <StatusChip tone="expired">{copy.archivedChip}</StatusChip>
        )}
      </div>
      <ConceptEditor
        key={row.id}
        row={row}
        imagePreviewUrl={imageId ? (previews[imageId] ?? null) : null}
      />
    </>
  )
}
