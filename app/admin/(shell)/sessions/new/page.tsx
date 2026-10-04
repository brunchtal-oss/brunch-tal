import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"

import type { ConceptOption } from "../session-draft"
import { SessionCreateForm } from "./session-create-form"

const copy = adminCopy.sessions

export const metadata: Metadata = {
  title: copy.create.title,
}

// A new session (CAP-12): the concept first, then the date and times; it is
// saved as a draft or published at once. Rendered inside the admin shell's <Suspense> gate.
export default function NewSessionPage() {
  return (
    <>
      <PageHeading>{copy.create.title}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <NewSessionContent />
      </Suspense>
    </>
  )
}

async function NewSessionContent() {
  const supabase = await createClient()
  const [concepts, settings] = await Promise.all([
    supabase
      .from("concepts")
      .select("id, name, description, default_kind")
      .is("archived_at", null)
      .order("sort_order")
      .order("name"),
    // The capacity of each kind, the default hours and the close rule
    // (business_settings, admin RLS). Without them the capacity and times
    // start empty and Tal types them (they are required), and no rule shows.
    supabase
      .from("business_settings")
      .select(
        "default_capacity_regular, default_capacity_couple, default_session_start_time, default_session_end_time, registration_close_days_before, registration_close_local_time"
      )
      .maybeSingle(),
  ])
  if (concepts.error) throw new Error("concepts read failed")
  const options = concepts.data.map((row) => row as ConceptOption)
  return (
    <SessionCreateForm
      concepts={options}
      capacityDefaults={
        settings.data
          ? {
              regular: settings.data.default_capacity_regular,
              couple: settings.data.default_capacity_couple,
            }
          : null
      }
      timeDefaults={
        settings.data
          ? {
              start: hhmm(settings.data.default_session_start_time),
              end: hhmm(settings.data.default_session_end_time),
            }
          : null
      }
      closeRule={
        settings.data
          ? {
              daysBefore: settings.data.registration_close_days_before,
              time: hhmm(settings.data.registration_close_local_time),
            }
          : null
      }
    />
  )
}

// Postgres time arrives as "HH:MM:SS"; the form and the rule use "HH:MM".
function hhmm(time: string): string {
  return time.slice(0, 5)
}
