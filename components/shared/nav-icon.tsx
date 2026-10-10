import {
  CalendarIcon,
  ClipboardListIcon,
  CreditCardIcon,
  EllipsisIcon,
  FileTextIcon,
  HouseIcon,
  Link2Icon,
  PackageIcon,
  ReceiptTextIcon,
  SettingsIcon,
  ShapesIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react"

import type { NavIcon as NavIconKey } from "@/lib/nav"

const ICONS = {
  home: HouseIcon,
  sessions: CalendarIcon,
  work: ClipboardListIcon,
  payments: CreditCardIcon,
  purchases: ReceiptTextIcon,
  profile: UserRoundIcon,
  more: EllipsisIcon,
  customers: UsersRoundIcon,
  // The rows of the admin's "more" (user decision 2026-10-08).
  links: Link2Icon,
  products: PackageIcon,
  content: FileTextIcon,
  settings: SettingsIcon,
  // Story 4.8.
  concepts: ShapesIcon,
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
