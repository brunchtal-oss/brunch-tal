import { MessageCircleIcon } from "lucide-react"

import { shellCopy } from "@/lib/copy/shell"

const copy = shellCopy.public

// whatsapp-bar (DESIGN, EXPERIENCE › whatsapp-bar): a full-width bar fixed
// to the bottom of every public page, inside <aside aria-label="יצירת קשר">
// after <main>. It opens wa.me with the business details' number and
// prepared message. The page keeps room under it (app/globals.css ›
// [data-whatsapp-bar]). Below a 480px window height (zoom, landscape) the
// bar is not shown (display: none, so it leaves the tab order and the
// accessibility tree) and WhatsappFlowLink shows the same link in the flow,
// before the footer. Without a usable number (href null) neither is shown.
// A signed-in customer sees neither (story 5.7, components/public/
// viewer-shell.tsx); the footer keeps room only while the bar is in the page.
export function WhatsappBar({ href }: { href: string | null }) {
  if (!href) return null
  return (
    <aside
      aria-label={copy.whatsappLabel}
      data-whatsapp-bar=""
      className="fixed inset-x-6 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-20 mx-auto max-w-[672px] short:hidden"
    >
      <WhatsappLink href={href} />
    </aside>
  )
}

export function WhatsappFlowLink({ href }: { href: string | null }) {
  if (!href) return null
  return (
    <div className="mx-auto hidden w-full max-w-[720px] px-6 pt-12 short:block">
      <WhatsappLink href={href} />
    </div>
  )
}

function WhatsappLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={copy.whatsappBarName}
      className="flex min-h-12 items-center justify-center gap-2 rounded-[4px] bg-success px-4 py-2 text-center text-base leading-[1.2] font-semibold text-primary-foreground hover:bg-success/90"
    >
      <MessageCircleIcon aria-hidden strokeWidth={1.8} className="size-5" />
      {copy.whatsappBar}
    </a>
  )
}
