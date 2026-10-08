// The admin home's greeting (user decision 2026-10-08): by the time of day
// in Asia/Jerusalem, with her first name. Pure: the caller passes the
// instant (display only, AD-8). 05:00-11:59 morning, 12:00-16:59 noon,
// 17:00-21:59 evening, 22:00-04:59 night; without a known time "היי".

import { adminCopy } from "./copy/admin"
import { localHourMinute, type DateInput } from "./time"

const copy = adminCopy.home

export type DayPart = "morning" | "noon" | "evening" | "night"

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning"
  if (hour >= 12 && hour < 17) return "noon"
  if (hour >= 17 && hour < 22) return "evening"
  return "night"
}

/**
 * full_name from Auth user metadata (the admin's name, user decision
 * 2026-10-08); null when it is missing or not a non-blank string.
 */
export function metadataFullName(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const value = (metadata as Record<string, unknown>).full_name
  return typeof value === "string" && value.trim() ? value : null
}

/** The first word of a full name; null when there is none. */
export function firstName(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0]
  return first ? first : null
}

export function adminGreeting(
  fullName: string | null | undefined,
  at: DateInput | null
): string {
  const name = firstName(fullName)
  if (!at) return name ? copy.hiWithName(name) : copy.greeting.unknown
  const greeting = copy.greeting[dayPart(localHourMinute(at).hour)]
  return name ? copy.greetingWithName(greeting, name) : greeting
}
