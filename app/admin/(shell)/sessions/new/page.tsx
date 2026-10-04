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
// saved as a draft. Rendered inside the admin shell's <Suspense> gate.
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
    // The capacity of each kind (business_settings, admin RLS). Without it
    // the capacity field starts empty and Tal types it (it is required).
    supabase
      .from("business_settings")
      .select("default_capacity_regular, default_capacity_couple")
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
    />
  )
}
