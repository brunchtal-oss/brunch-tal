import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"

import { ConceptCreateForm } from "./concept-create-form"

const copy = adminCopy.concepts

export const metadata: Metadata = {
  title: copy.create.title,
}

// A new concept (story 4.8): name, description and kind; a success opens its
// editor (where its image is added). Rendered inside the admin shell's
// <Suspense> gate.
export default function NewConceptPage() {
  return (
    <>
      <PageHeading>{copy.create.title}</PageHeading>
      <ConceptCreateForm />
    </>
  )
}
