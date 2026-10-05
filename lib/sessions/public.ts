import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  CONCEPT_IMAGE_SELECT,
  SESSION_IMAGE_SELECT,
  sessionPhoto,
  type MediaRow,
  type SessionPhotoData,
} from "@/lib/media/photo"
import type { Database } from "@/lib/supabase/database.types"
import { createPublicClient } from "@/lib/supabase/public"

// The public session pages (story 5.16): /sessions, /sessions/[id] and the
// home page's upcoming sessions. One source for every public read of a
// session, with the anon client and explicit columns only: no capacity, no
// bookings, no availability (a guest sees nothing about places), and no
// regular/couple kind (no type label). RLS lets anon see every non-draft
// session, so the reads also keep only published sessions that have not
// started. Not cached (AD-2): the callers run after `await connection()`.

// The photo (story 5.4): the session's image, else its concept's, through a
// join to media_assets (anon sees only published images).
export const PUBLIC_SESSION_COLUMNS = `id, starts_at, description, display_price_agorot, ${SESSION_IMAGE_SELECT}, concepts(name, description, ${CONCEPT_IMAGE_SELECT})`

export type PublicSession = {
  id: string
  starts_at: string
  // The session's description when Tal entered one, else the concept's;
  // null when neither has text.
  description: string | null
  display_price_agorot: number | null
  concept_name: string
  // The session's photo, else its concept's; null without one.
  photo: SessionPhotoData | null
}

type PublicSessionRow = {
  id: string
  starts_at: string
  description: string | null
  display_price_agorot: number | null
  image?: MediaRow | null
  concepts: {
    name: string
    description: string | null
    default_image?: MediaRow | null
  } | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A row text that is blank counts as not entered. */
function text(value: string | null | undefined): string | null {
  return value && value.trim() ? value : null
}

export function toPublicSession(row: PublicSessionRow): PublicSession {
  return {
    id: row.id,
    starts_at: row.starts_at,
    description: text(row.description) ?? text(row.concepts?.description),
    display_price_agorot: row.display_price_agorot,
    // The concept is a required FK, so never missing in practice.
    concept_name: row.concepts?.name ?? "",
    photo: sessionPhoto(row.image, row.concepts?.default_image),
  }
}

type Client = SupabaseClient<Database>

// Display only (which sessions to list), not a business decision (AD-8).
function nowIso(): string {
  return new Date().toISOString()
}

/**
 * The published sessions that have not started, by start time then id.
 * Throws on a read error (the caller decides: the lists show the error
 * boundary, the home page leaves its area out).
 */
export async function listUpcomingPublicSessions(
  limit = 100,
  client: Client = createPublicClient()
): Promise<PublicSession[]> {
  const { data, error } = await client
    .from("events")
    .select(PUBLIC_SESSION_COLUMNS)
    .eq("status", "published")
    .gt("starts_at", nowIso())
    .order("starts_at")
    .order("id")
    .limit(limit)
  if (error) throw new Error("public sessions read failed")
  return (data as unknown as PublicSessionRow[]).map(toPublicSession)
}

/**
 * One published session that has not started; null for anything else (not
 * a UUID, a draft, cancelled, ended, started or missing). Throws on a read
 * error.
 */
export async function getPublicSession(
  id: string,
  client?: Client
): Promise<PublicSession | null> {
  if (!UUID.test(id)) return null
  const { data, error } = await (client ?? createPublicClient())
    .from("events")
    .select(PUBLIC_SESSION_COLUMNS)
    .eq("id", id)
    .eq("status", "published")
    .gt("starts_at", nowIso())
    .maybeSingle()
  if (error) throw new Error("public session read failed")
  return data ? toPublicSession(data as unknown as PublicSessionRow) : null
}
