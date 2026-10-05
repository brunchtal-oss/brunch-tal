import {
  CalendarIcon,
  CreditCardIcon,
  EllipsisIcon,
  HouseIcon,
  ReceiptTextIcon,
} from "lucide-react"

import type { NavIcon as NavIconKey } from "@/lib/nav"

const ICONS = {
  home: HouseIcon,
  sessions: CalendarIcon,
  payments: CreditCardIcon,
  purchases: ReceiptTextIcon,
  more: EllipsisIcon,
} satisfies Record<NavIconKey, unknown>

// Decorative: the item's label is always visible next to it.
export function NavIcon({
  icon,
  className,
}: {
  icon: NavIconKey
  className?: string
}) {
  const Icon = ICONS[icon]
  return <Icon aria-hidden strokeWidth={1.5} className={className} />
}
