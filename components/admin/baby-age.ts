// A baby's age on a given day (attendee-row, story 3.4): display only, from
// two plain local dates ("YYYY-MM-DD"). Under a week: newborn; under a whole
// calendar month: whole weeks; then whole calendar months. A birth date after
// the day (or a bad date): no age.

import { adminCopy } from "@/lib/copy/admin"

const copy = adminCopy.sessions.babyAge
const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function parse(date: string) {
  const match = PLAIN_DATE.exec(date)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const utc = Date.UTC(year, month - 1, day)
  // Rejects 2026-02-30 and the like.
  if (new Date(utc).getUTCDate() !== day) return null
  return { year, month, day, utc }
}

export function babyAge(birthDate: string, onDay: string): string {
  const birth = parse(birthDate)
  const day = parse(onDay)
  if (!birth || !day || birth.utc > day.utc) return ""
  let months = (day.year - birth.year) * 12 + (day.month - birth.month)
  if (day.day < birth.day) months -= 1
  if (months >= 1) return copy.months(months)
  const days = Math.round((day.utc - birth.utc) / 86_400_000)
  if (days < 7) return copy.newborn
  return copy.weeks(Math.floor(days / 7))
}
