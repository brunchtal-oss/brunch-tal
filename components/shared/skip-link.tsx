import { shellCopy } from "@/lib/copy/shell"

// First stop in the tab order of every page: jumps to <main id="main">.
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only rounded-sm bg-primary px-4 text-base font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center"
    >
      {shellCopy.skipToMain}
    </a>
  )
}
