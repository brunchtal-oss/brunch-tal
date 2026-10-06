import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"

import { templateTypeOrder } from "./template-types"

const copy = adminCopy.settings.templates

export const metadata: Metadata = {
  title: copy.title,
}

// The notification templates, one row per type (CAP-34; EXPERIENCE › admin
// states › template): its name, who receives it and its current title.
// Read with the admin's RLS (notification_templates_admin_select).
export default function TemplatesPage() {
  return (
    <>
      <Link
        href="/admin/settings"
        className="inline-flex min-h-11 items-center gap-1 self-start text-[15px] underline underline-offset-[3px]"
      >
        <ChevronRightIcon aria-hidden strokeWidth={1.5} className="size-4" />
        {copy.back}
      </Link>
      <PageHeading>{copy.title}</PageHeading>
      <Suspense
        fallback={<p className="text-muted-foreground">{shellCopy.loading}</p>}
      >
        <TemplatesList />
      </Suspense>
    </>
  )
}

async function TemplatesList() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("notification_templates")
    .select("type, recipient_kind, push, title")
  if (error) throw new Error("templates read failed")
  const rows = [...data].sort(
    (a, b) => templateTypeOrder(a.type) - templateTypeOrder(b.type)
  )

  return (
    <ul className="flex flex-col border-t border-border">
      {rows.map((row) => (
        <li key={row.type} className="border-b border-border">
          <Link
            href={`/admin/settings/templates/${row.type}`}
            className="flex min-h-12 items-center justify-between gap-3 py-3"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-base font-semibold">
                {copy.types[row.type] ?? row.type}
              </span>
              <span className="text-[13px] text-muted-foreground">
                {row.recipient_kind === "admin"
                  ? copy.recipient.admin
                  : copy.recipient.customer}
                {row.push && ` · ${copy.push}`}
              </span>
              <span className="truncate text-[15px] text-muted-foreground">
                <bdi>{row.title}</bdi>
              </span>
            </span>
            <ChevronLeftIcon
              aria-hidden
              strokeWidth={1.5}
              className="size-5 shrink-0 text-muted-foreground"
            />
          </Link>
        </li>
      ))}
    </ul>
  )
}
