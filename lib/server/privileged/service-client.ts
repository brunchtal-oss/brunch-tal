import "server-only"

import { createClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/supabase/database.types"

// Bypasses RLS with the secret key (AD-4). Allowed only for: Auth Admin API
// writes, cross-bucket Storage copies, RPCs granted to service_role only, and
// the push worker. Never for reading customer data. No session, no cookies.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) {
    throw new Error("Supabase service client is not configured")
  }

  return createClient<Database>(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
