import "server-only"

import { cache } from "react"
import { unstable_rethrow } from "next/navigation"

import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import { toSessionRole, type SessionRole } from "./destination"

// Who is looking at a public page (story 5.16): the session's role from
// get_my_session_role() (AD-2), or null for a guest. Never throws: a failed
// lookup counts as a guest, so the public page still shows the guest's
// action. Reads the cookies, so call it only inside <Suspense>. Cached per
// request (React cache): the public shell asks twice (top-bar and
// whatsapp-bar, story 5.7) and reads the role once.
export const getViewerRole = cache(
  async function getViewerRole(): Promise<SessionRole | null> {
    try {
      const supabase = await createClient()
      const { data: claims } = await supabase.auth.getClaims()
      if (!claims?.claims) return null
      const result = await callRpc(supabase, "get_my_session_role")
      return result.ok ? toSessionRole(result.data) : null
    } catch (error) {
      // Next's own signals (dynamic rendering) pass through.
      unstable_rethrow(error)
      return null
    }
  }
)
