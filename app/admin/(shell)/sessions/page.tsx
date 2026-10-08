import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { PlusIcon } from "lucide-react"

import { PageHeading } from "@/components/shared/page-heading"
import { buttonClass } from "@/components/shared/button-class"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"

import {
  SESSION_COLUMNS,
  sessionsListFilter,
  toSessionRow,
} from "./load-session"
import { SessionsList } from "./sessions-list"

const copy = adminCopy.sessions

export const metadata: Metadata = {
  title: copy.title,
}

// The sessions (CAP-12): every draft and every published session that has
// not ended yet, by date, each with its status-chip. Rendered inside the
// admin shell's <Suspense> gate.
export default function SessionsPage() {
  return (
    <>
      <PageHeading>{copy.title}</PageHeading>
      {/* button-primary at inline-start, 12px above the first session; the
          content starts at inline-start, a 16px plus 8px before the text
          (user decision 2026-10-08). */}
      <div className="flex flex-col gap-3">
        <Link
          href="/admin/sessions/new"
          className={buttonClass({
            size: "lg",
            className:
              "h-12 items-center justify-start gap-2 self-start rounded-lg px-4 text-base font-semibold",
          })}
        >
          <PlusIcon aria-hidden strokeWidth={1.5} className="size-4" />
          {copy.addBrunch}
        </Link>
        <Suspense
          fallback={
            <p className="text-muted-foreground">{shellCopy.loading}</p>
          }
        >
          <SessionsContent />
        </Suspense>
      </div>
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
    .or(sessionsListFilter(now))
    .order("starts_at")
    .order("id")
  if (error) throw new Error("sessions list failed")
  return <SessionsList rows={data.map(toSessionRow)} />
}
