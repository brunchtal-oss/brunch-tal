import { Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"

import { PRODUCT_COLUMNS, toProductRow } from "../load-product"
import { ProductEditor } from "./product-editor"

const copy = adminCopy.products
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const metadata: Metadata = {
  title: copy.title,
}

// One product, field by field (CAP-3); the create form leads here.
// Rendered inside the admin shell's <Suspense> gate.
export default function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <Suspense
      fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
    >
      <ProductContent params={params} />
    </Suspense>
  )
}

async function ProductContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error("product read failed")
  if (!data) notFound()
  const row = toProductRow(data)

  return (
    <>
      <PageHeading>
        <bdi>{row.name}</bdi>
      </PageHeading>
      <ProductEditor row={row} />
    </>
  )
}
