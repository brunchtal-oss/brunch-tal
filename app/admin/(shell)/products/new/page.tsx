import { Suspense } from "react"
import type { Metadata } from "next"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"

import { ProductCreateForm } from "./product-create-form"

const copy = adminCopy.products

export const metadata: Metadata = {
  title: copy.create.title,
}

// A new product (CAP-3): one form, the type first. Rendered inside the admin
// shell's <Suspense> gate.
export default function NewProductPage() {
  return (
    <>
      <PageHeading>{copy.create.title}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <NewProductContent />
      </Suspense>
    </>
  )
}

async function NewProductContent() {
  // The card's default validity (business_settings, admin RLS). Without it
  // the field stays empty and the RPC takes the setting itself.
  const supabase = await createClient()
  const { data } = await supabase
    .from("business_settings")
    .select("default_validity_days")
    .maybeSingle()
  return (
    <ProductCreateForm
      defaultValidityDays={data?.default_validity_days ?? null}
    />
  )
}
