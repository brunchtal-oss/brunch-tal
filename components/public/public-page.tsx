import { PageHeading } from "@/components/shared/page-heading"
import { shellCopy } from "@/lib/copy/shell"

const copy = shellCopy.public

// The top of an inner public page: the h1 is the page's name from the
// navigation (display-lg, centred like the section headings).
export function PublicPageHeading({ children }: { children: string }) {
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 pt-10">
      <PageHeading className="text-center text-[34px] leading-[1.15] text-balance">
        {children}
      </PageHeading>
    </div>
  )
}

// A public page with no published section: one status line and the
// WhatsApp link (when the business details have a usable number).
export function EmptyPublicPage({
  whatsappHref,
}: {
  whatsappHref: string | null
}) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col items-center gap-2 px-6 pt-8 text-center">
      <p className="text-[17px] leading-[1.65] text-muted-foreground">
        {copy.emptyPage}
      </p>
      {whatsappHref && (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-base font-semibold underline underline-offset-4"
        >
          {copy.emptyPageWhatsapp}
          <span className="sr-only"> {copy.contact.opensOutside}</span>
        </a>
      )}
    </div>
  )
}
