import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"
import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { signedDraftUrls } from "@/lib/media/drafts"
import { createClient } from "@/lib/supabase/server"

import {
  isReadOnlySession,
  SESSION_COLUMNS,
  toSessionRow,
} from "../../load-session"
import { sessionTitle } from "../../session-draft"
import { SessionStatusChip } from "../../session-status-chip"
import { SessionEditor } from "./session-editor"

const copy = adminCopy.sessions
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata: Metadata = {
  title: copy.title,
}

// One session, field by field (CAP-12); the create form and the session's
// details lead here. A cancelled, completed or ended session is read-only:
// it goes to its details (story 3.4, user decision 2026-10-05). Rendered
// inside the admin shell's <Suspense> gate.
// ?image=failed: the create form made the session but its image was not
// saved (story 5.4); a notice says so above the editor.
export default function EditSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ image?: string | string[] }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <EditSessionContent params={params} searchParams={searchParams} />
    </Suspense>
  )
}

async function EditSessionContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ image?: string | string[] }>
}) {
  const [{ id }, { image }] = await Promise.all([params, searchParams])
  if (!UUID.test(id)) notFound()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("events")
    .select(SESSION_COLUMNS)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error("session read failed")
  if (!data) notFound()
  const row = toSessionRow(data)
  if (isReadOnlySession(row, new Date())) redirect(`/admin/sessions/${id}`)
  // Story 5.4: the saved image's draft file, for the preview.
  const imageId = row.image?.media_id
  const previews = imageId ? await signedDraftUrls(supabase, [imageId]) : {}

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PageHeading>
          <bdi>{sessionTitle(row.concept_name)}</bdi>
        </PageHeading>
        <SessionStatusChip status={row.status} />
      </div>
      {image === "failed" && (
        <InlineNotice tone="warning">
          {copy.image.createdWithoutImage}
        </InlineNotice>
      )}
      <SessionEditor
        row={row}
        imagePreviewUrl={imageId ? (previews[imageId] ?? null) : null}
      />
    </>
  )
}
