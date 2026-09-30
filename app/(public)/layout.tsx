import Link from "next/link"

import { TopBar } from "@/components/public/top-bar"
import { SkipLink } from "@/components/shared/skip-link"
import { shellCopy } from "@/lib/copy/shell"

// Public shell (AD-2). The menu-sheet, whatsapp-bar and the footer texts come
// from published content in 5.2; for now the footer holds only the admin
// entrance.
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col">
      <SkipLink />
      <TopBar />
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col">
        {children}
      </main>
      <footer className="border-t border-border">
        <nav
          aria-label={shellCopy.nav.footerLabel}
          className="mx-auto flex max-w-[720px] px-6 py-4"
        >
          <Link
            href="/admin/login"
            className="inline-flex min-h-11 items-center rounded-sm text-[13px] text-muted-foreground underline underline-offset-[3px]"
          >
            {shellCopy.public.adminLogin}
          </Link>
        </nav>
      </footer>
    </div>
  )
}
