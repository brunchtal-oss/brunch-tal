import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronRightIcon } from "lucide-react"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"

import { isTemplateType } from "../template-types"
import { TemplateEditor, type TemplateRow } from "./template-editor"

const copy = adminCopy.settings.templates

export const metadata: Metadata = {
  title: copy.title,
}

// One notification template (story 4.7): its title and body, the fields it
// may use, and a preview. Rendered inside the admin shell's <Suspense> gate.
export default function TemplatePage({
  params,
}: {
  params: Promise<{ type: string }>
}) {
  return (
    <>
      <Link
        href="/admin/settings/templates"
        className="inline-flex min-h-11 items-center gap-1 self-start text-[15px] underline underline-offset-[3px]"
      >
        <ChevronRightIcon aria-hidden strokeWidth={1.5} className="size-4" />
        {copy.backToList}
      </Link>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <TemplateContent params={params} />
      </Suspense>
    </>
  )
}

async function TemplateContent({
  params,
}: {
  params: Promise<{ type: string }>
}) {
  const { type } = await params
  if (!isTemplateType(type)) notFound()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("notification_templates")
    .select(
      "type, recipient_kind, push, body_mode, title, body, allowed_vars, version"
    )
    .eq("type", type)
    .maybeSingle()
  if (error) throw new Error("template read failed")
  if (!data) notFound()

  return (
    <>
      <PageHeading>{copy.types[type]}</PageHeading>
      <TemplateEditor row={data as TemplateRow} />
    </>
  )
}
