import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { PlusIcon } from "lucide-react"

import { PageHeading } from "@/components/shared/page-heading"
import { buttonVariants } from "@/components/ui/button"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"

import { PRODUCT_COLUMNS, toProductRow } from "./load-product"
import { ProductsList } from "./products-list"

const copy = adminCopy.products

export const metadata: Metadata = {
  title: copy.title,
}

// The catalog (CAP-3): each product with its price and summary, "מוסתר"
// for a hidden one; a row leads to its editor. Offered products first.
// Rendered inside the admin shell's <Suspense> gate.
export default function ProductsPage() {
  return (
    <>
      <PageHeading>{copy.title}</PageHeading>
      <Link
        href="/admin/products/new"
        className={buttonVariants({
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
        <ProductsContent />
      </Suspense>
    </>
  )
}

async function ProductsContent() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .order("active", { ascending: false })
    .order("name")
    .order("id")
  if (error) throw new Error("products list failed")
  return <ProductsList rows={data.map(toProductRow)} />
}
