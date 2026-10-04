import "server-only"

import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

import type { ContentPage, EditableSlug } from "./content-items"

// The editor's view of a page, with the admin's session (drafts are read
// only through admin_get_content_page, never by a public route).
export async function loadContentPage(
  slug: EditableSlug
): Promise<ContentPage> {
  const result = await callRpc(await createClient(), "admin_get_content_page", {
    p_slug: slug,
  })
  if (!result.ok) throw new Error("admin_get_content_page failed")
  return result.data as unknown as ContentPage
}
