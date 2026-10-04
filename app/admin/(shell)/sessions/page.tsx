import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { PlusIcon } from "lucide-react"

import { PageHeading } from "@/components/shared/page-heading"
import { buttonVariants } from "@/components/ui/button"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"

import { SESSION_COLUMNS, toSessionRow } from "./load-session"
import { SessionsList } from "./sessions-list"

const copy = adminCopy.sessions

export const metadata: Metadata = {
  title: copy.title,
}

// The sessions (CAP-12): every draft and every published session that has
// not started yet, by date, each with its status-chip. Rendered inside the
// admin shell's <Suspense> gate.
export default function SessionsPage() {
  return (
    <>
      <PageHeading>{copy.title}</PageHeading>
      <Link
        href="/admin/sessions/new"
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
        <SessionsContent />
      </Suspense>
    </>
  )
}

async function SessionsContent() {
  const supabase = await createClient()
  // Display only (which rows to list), not a business decision (AD-8).
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from("events")
    .select(SESSION_COLUMNS)
    .or(`status.eq.draft,and(status.eq.published,starts_at.gte.${now})`)
    .order("starts_at")
    .order("id")
  if (error) throw new Error("sessions list failed")
  return <SessionsList rows={data.map(toSessionRow)} />
}
