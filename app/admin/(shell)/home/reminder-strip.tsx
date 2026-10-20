import { createClient } from "@/lib/supabase/server"

import { ReminderStripView } from "./reminder-strip-view"

export type ReminderRow = {
  id: string
  payload: unknown
  read_at: string | null
}

// The strip's reminder: the newest marketing reminder, only while it is
// unread (an older unread one never shows once a newer one was read), with
// its body; null otherwise.
export function currentReminder(
  row: ReminderRow | null
): { id: string; body: string } | null {
  if (!row || row.read_at !== null) return null
  const payload =
    row.payload && typeof row.payload === "object"
      ? (row.payload as Record<string, unknown>)
      : {}
  const body = typeof payload.body === "string" ? payload.body.trim() : ""
  if (body === "") return null
  return { id: row.id, body }
}

// The reminder-strip on the admin home (story 5.11, DESIGN › reminder-
// strip): her newest marketing_reminder notification (RLS: her own rows),
// right under the h1, until she closes it. A failed read shows nothing.
export async function ReminderStrip() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("notifications")
    .select("id, payload, read_at")
    .eq("recipient_kind", "admin")
    .eq("type", "marketing_reminder")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  const reminder = currentReminder(data)
  if (!reminder) return null
  // Keyed by the reminder, so a newer one never inherits a closed state.
  return (
    <ReminderStripView
      key={reminder.id}
      id={reminder.id}
      body={reminder.body}
    />
  )
}
