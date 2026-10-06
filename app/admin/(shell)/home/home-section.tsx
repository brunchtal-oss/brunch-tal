import Link from "next/link"

// One part of /admin (story 4.1): an h2 in display-sm (Heebo 22/300) with an
// optional aside at inline-end (a counter or a "to all" link), then the
// content. Each part is its own component, so 4.7 adds its links without
// changing them.
export function HomeSection({
  id,
  title,
  aside,
  children,
}: {
  id: string
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          id={id}
          className="font-heading text-[22px] leading-[1.25] font-light text-balance"
        >
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

// A text link (DESIGN › button-link) with a 44px target.
export function HomeLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center text-[15px] underline underline-offset-4"
    >
      {children}
    </Link>
  )
}
