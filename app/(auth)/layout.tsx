import { SkipLink } from "@/components/shared/skip-link"

// Auth shell (AD-2): no navigation, one narrow column. /login, /admin/login,
// /reset/[token] (and /join/[token] later) render inside this <main>.
// Top-aligned with a fixed top gap (not centred), so the form sits where the
// eye expects it and does not jump when the phone keyboard opens.
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
        className="mx-auto flex min-h-svh w-full max-w-sm flex-col gap-6 px-6 pt-16 pb-10"
      >
        {children}
      </main>
    </>
  )
}
