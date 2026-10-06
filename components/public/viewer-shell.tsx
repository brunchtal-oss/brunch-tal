import { getViewerRole } from "@/lib/auth/viewer-role"

import { TopBar } from "./top-bar"
import { WhatsappBar, WhatsappFlowLink } from "./whatsapp-bar"

// The parts of the public shell that depend on who is looking (story 5.7,
// from deferred-work). Each reads the session's role and so must render
// inside <Suspense>, never inside 'use cache' (app/(public)/layout.tsx): the
// rest of the public page stays cached.

/** The top-bar with the account link for the viewer's role. */
export async function ViewerTopBar({ name }: { name: string }) {
  const role = await getViewerRole()
  return <TopBar name={name} role={role} />
}

/**
 * The whatsapp-bar and its in-flow link, for anyone but a signed-in
 * customer (she has her own area; an admin and a guest keep the bar).
 */
export async function ViewerWhatsapp({ href }: { href: string | null }) {
  if (!href) return null
  const role = await getViewerRole()
  return <ViewerWhatsappBar href={href} role={role} />
}

export function ViewerWhatsappBar({
  href,
  role,
}: {
  href: string | null
  role: string | null
}) {
  if (role === "customer") return null
  return (
    <>
      <WhatsappBar href={href} />
      <WhatsappFlowLink href={href} />
    </>
  )
}
