import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"
import { formatClockTime } from "@/lib/time"

import { SettingsEditor } from "./settings-editor"
import { SETTINGS_COLUMNS, type SettingsRow } from "./settings-draft"

const copy = adminCopy.settings

export const metadata: Metadata = {
  title: copy.title,
}

// The default values (CAP-34), from "more". Rendered inside the admin
// shell's <Suspense> gate; business_settings is read with the admin's RLS.
export default function SettingsPage() {
  return (
    <>
      <PageHeading>{copy.title}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <SettingsContent />
      </Suspense>
    </>
  )
}

async function SettingsContent() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("business_settings")
    .select(SETTINGS_COLUMNS)
    .single()
  if (error) throw new Error("settings read failed")
  const row: SettingsRow = {
    ...data,
    registration_close_local_time: formatClockTime(
      data.registration_close_local_time
    ),
    default_session_start_time: formatClockTime(
      data.default_session_start_time
    ),
    default_session_end_time: formatClockTime(data.default_session_end_time),
  }
  return <SettingsEditor row={row} />
}
