import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// buttonVariants (shadcn, not edited) only concatenates its className after
// the variant's classes, without tailwind-merge: a class that changes the
// same property (border-foreground over the outline's border-transparent /
// border-border, h-12 over the size's h-9) may lose in the stylesheet's
// order, as the frame of a button-secondary did on the phone (2026-10-08).
// This merges them, so the caller's classes win.
export function buttonClass({
  className,
  ...variants
}: Parameters<typeof buttonVariants>[0] = {}): string {
  return cn(buttonVariants(variants), className)
}
