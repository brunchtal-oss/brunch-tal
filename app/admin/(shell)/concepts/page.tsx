import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { PlusIcon } from "lucide-react"

import { buttonClass } from "@/components/shared/button-class"
import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"

import { ConceptsList } from "./concepts-list"
import { CONCEPT_COLUMNS, toConceptRow } from "./load-concept"

const copy = adminCopy.concepts

export const metadata: Metadata = {
  title: copy.title,
}

// The concepts (story 4.8, CAP-41): each with its photo and kind, the
// archived behind "להציג ארכיון"; a row leads to its editor, "+ קונספט" to
// a new one. In the order the session form offers them (sort_order, name).
// Rendered inside the admin shell's <Suspense> gate.
export default function ConceptsPage() {
  return (
    <>
      <PageHeading>{copy.title}</PageHeading>
      <Link
        href="/admin/concepts/new"
        aria-label={copy.addLabel}
        className={buttonClass({
          variant: "outline",
          size: "lg",
          className: "h-12 self-start border-foreground px-4 text-base",
        })}
      >
        <PlusIcon aria-hidden strokeWidth={1.5} className="size-5" />
        {copy.add}
      </Link>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <ConceptsContent />
      </Suspense>
    </>
  )
}

async function ConceptsContent() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("concepts")
    .select(CONCEPT_COLUMNS)
    .order("sort_order")
    .order("name")
  if (error) throw new Error("concepts list failed")
  return <ConceptsList rows={data.map(toConceptRow)} />
}
