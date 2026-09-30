import { createClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"

// Published content only (AD-16): an `anon` client with no cookies and no
// session, so it can run inside `'use cache'`. It sees exactly what grants and
// RLS allow `anon`, never customer data or occupancy.
export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !publishableKey) {
    throw new Error("Supabase public client is not configured")
  }

  return createClient<Database>(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
