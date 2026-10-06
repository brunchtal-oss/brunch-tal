import type { BabyAge } from "@/lib/time"

// The wording of a baby's age (lib/time.ts babyAge), shared by the
// customer's profile and Tal's attendee-row (story 2.10, user decision
// 2026-10-06). Under a year as before; from a year on in years and months:
// "שנה", "שנה וחודש", "שנה וחודשיים", "שנה ו-3 חודשים", "שנתיים",
// "שנתיים ו-5 חודשים", "3 שנים", "3 שנים וחודש". No age: "".

function weeks(n: number): string {
  return n === 1 ? "שבוע" : n === 2 ? "שבועיים" : `${n} שבועות`
}

function months(n: number): string {
  return n === 1 ? "חודש" : n === 2 ? "חודשיים" : `${n} חודשים`
}

function years(n: number): string {
  return n === 1 ? "שנה" : n === 2 ? "שנתיים" : `${n} שנים`
}

export function babyAgeText(age: BabyAge | null): string {
  if (!age) return ""
  if ("newborn" in age) return "פחות משבוע"
  if ("weeks" in age) return weeks(age.weeks)
  if (age.years === 0) return months(age.months)
  if (age.months === 0) return years(age.years)
  // "וחודש", "וחודשיים", but "ו-3 חודשים" (a digit after ו).
  const rest =
    age.months <= 2 ? `ו${months(age.months)}` : `ו-${months(age.months)}`
  return `${years(age.years)} ${rest}`
}
