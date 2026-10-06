import { redirect } from "next/navigation"

// The session-morning view of 3.4 is replaced by the work sheet (story 4.9,
// demo-scope: user decision 2026-10-05): the old address leads there.
export default async function SessionMorningPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/admin/sessions/${encodeURIComponent(id)}/work`)
}
