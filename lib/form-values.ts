import type { Json } from "@/lib/supabase/database.types"

// Small shape checks shared by forms, Server Actions and response parsers
// (story 5.19). Pure: no server-only import, so a "use client" module may
// use them.

// A positive whole number typed in a field, or null.
export function parsePositiveInt(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d{1,9}$/.test(trimmed)) return null
  const value = Number(trimmed)
  return value > 0 ? value : null
}

// A non-empty JSON object (not null, not an array).
export function isPlainObject(value: unknown): value is Record<string, Json> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  )
}

// A row version the screen read: a positive safe integer.
export function validVersion(version: unknown): version is number {
  return Number.isSafeInteger(version) && (version as number) > 0
}

// A non-empty string, or null.
export function nonEmptyText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}
