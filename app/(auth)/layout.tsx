import { SkipLink } from "@/components/shared/skip-link"

// Auth shell (AD-2): no navigation, one narrow column. /login, /admin/login,
// /reset/[token] (and /join/[token] later) render inside this <main>.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <SkipLink />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex min-h-svh w-full max-w-sm flex-col justify-center gap-6 px-6 py-10"
      >
        {children}
      </main>
    </>
  )
}
