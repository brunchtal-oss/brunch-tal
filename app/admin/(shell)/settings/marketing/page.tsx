import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"

import { PageHeading } from "@/components/shared/page-heading"
import { adminCopy } from "@/lib/copy/admin"
import { shellCopy } from "@/lib/copy/shell"
import { createClient } from "@/lib/supabase/server"

import { parseSchedule } from "./marketing-draft"
import { ScheduleEditor } from "./schedule-editor"
import { TextsEditor } from "./texts-editor"

const copy = adminCopy.settings.marketing

export const metadata: Metadata = {
  title: copy.title,
}

// Tal's marketing reminders (story 5.11, CAP-35): when they come (one row
// per weekday) and the texts they rotate through (add, edit, on/off). Read
// with the admin's RLS; rendered inside the admin shell's <Suspense> gate.
export default function MarketingPage() {
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
        <MarketingContent />
      </Suspense>
    </>
  )
}

async function MarketingContent() {
  const supabase = await createClient()
  const [settings, texts] = await Promise.all([
    supabase
      .from("business_settings")
      .select("version, marketing_reminder_schedule")
      .single(),
    supabase
      .from("marketing_reminder_texts")
      .select("id, body, active, sort_order, last_sent_at, version")
      .order("sort_order")
      .order("id"),
  ])
  if (settings.error) throw new Error("settings read failed")
  if (texts.error) throw new Error("marketing texts read failed")

  return (
    <div className="flex flex-col gap-8">
      <ScheduleEditor
        version={settings.data.version}
        schedule={parseSchedule(settings.data.marketing_reminder_schedule)}
      />
      <TextsEditor texts={texts.data} />
    </div>
  )
}
