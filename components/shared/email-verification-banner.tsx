import {
  EmailVerificationNotice,
  type ResendAction,
} from "@/components/shared/email-verification-notice"
import { callRpc } from "@/lib/rpc"
import { createClient } from "@/lib/supabase/server"

// Story 6.11: shown only while get_my_email_verified says the account's
// current email has no matching verification record. Nothing when it is
// verified, and nothing when the read fails (the page goes on).
export async function EmailVerificationBanner({
  resend,
}: {
  resend: ResendAction
}) {
  const result = await callRpc(await createClient(), "get_my_email_verified")
  if (!result.ok) return null
  const verified = (result.data as { verified?: unknown } | null)?.verified
  if (verified !== false) return null
  return <EmailVerificationNotice resend={resend} />
}
