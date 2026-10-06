import "server-only"

import { cache } from "react"

import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import type { AttentionRow, HomeData } from "../home-items"

// The reads of /admin (story 4.1). Each section is its own <Suspense>, and
// several read admin_get_home: cache() makes it one call per request. Any
// failure throws (the page's error boundary), as on the other admin lists.

export const loadHome = cache(async (): Promise<HomeData> => {
  const result = await callRpc(await createClient(), "admin_get_home")
  if (!result.ok) throw new Error("admin_get_home failed")
  return result.data as unknown as HomeData
})

export const loadAttentionItems = cache(async (): Promise<AttentionRow[]> => {
  const result = await callRpc(
    await createClient(),
    "admin_get_attention_items"
  )
  if (!result.ok) throw new Error("admin_get_attention_items failed")
  return result.data as unknown as AttentionRow[]
})
