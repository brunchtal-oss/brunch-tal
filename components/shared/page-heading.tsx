import { cn } from "@/lib/utils"

// The one h1 of a page. tabIndex -1 lets RouteFocus move focus here after a
// client navigation. Default: display-md (Heebo 26/300).
export function PageHeading({
  className,
  ...props
}: React.ComponentProps<"h1">) {
  return (
    <h1
      tabIndex={-1}
      className={cn(
        "font-heading text-[26px] leading-[1.2] font-light",
        className
      )}
      {...props}
    />
  )
}
