import Image from "next/image"
import { CroissantIcon } from "lucide-react"

import { cn } from "@/lib/utils"

// The photo of a session, 4:3 unless the caller sets another aspect (user's decision 2026-10-04, UX memlog: one
// uniform card, a photo on every card). The session's own photo, else its
// concept's photo; both come with story 5.4 (upload and storage). Until then,
// and for any session without one, a quiet muted surface with a decorative
// mark in the accent colour: never an empty frame. alt "" when decorative.
export function SessionPhoto({
  src,
  alt = "",
  sizes,
  priority = false,
  className,
}: {
  src?: string | null
  alt?: string
  sizes: string
  priority?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "relative aspect-[4/3] overflow-hidden bg-muted",
        className
      )}
    >
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      ) : (
        <div aria-hidden className="absolute inset-0 grid place-items-center">
          <CroissantIcon
            strokeWidth={1}
            className="size-12 text-brand-accent"
          />
        </div>
      )}
    </div>
  )
}
