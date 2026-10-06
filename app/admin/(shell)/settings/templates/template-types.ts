import { adminCopy } from "@/lib/copy/admin"

// The template types in the order of the list (notification-matrix: the
// customer's, then Tal's). The names live in lib/copy/admin.ts.
export const TEMPLATE_TYPES = Object.keys(adminCopy.settings.templates.types)

export function isTemplateType(value: string): boolean {
  return TEMPLATE_TYPES.includes(value)
}

// Position in the list; an unknown type goes last.
export function templateTypeOrder(type: string): number {
  const index = TEMPLATE_TYPES.indexOf(type)
  return index === -1 ? TEMPLATE_TYPES.length : index
}
