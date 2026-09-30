import { PageHeading } from "@/components/shared/page-heading"
import { shellCopy } from "@/lib/copy/shell"

// Typographic hero fallback (DESIGN.md › hero): the business name on plain
// cream in wordmark-display (Heebo 40/200, the one place for weight 200). The
// published content of the home page arrives in 5.2. Title: the root default.
export default function HomePage() {
  return (
    <section className="mx-auto flex w-full max-w-[720px] flex-1 flex-col items-center justify-center px-6 py-12 text-center">
      <PageHeading className="text-[40px] leading-[1.15] font-extralight">
        {shellCopy.wordmark}
      </PageHeading>
    </section>
  )
}
