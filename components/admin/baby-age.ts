// A baby's age on a given day (attendee-row, story 3.4): display only, from
// two plain local dates ("YYYY-MM-DD"). The computation is lib/time.ts and
// the wording lib/copy/baby-age.ts, shared with the customer's profile
// (story 2.10). A birth date after the day (or a bad date): "".

import { babyAgeText } from "@/lib/copy/baby-age"
import { babyAge as computeBabyAge } from "@/lib/time"

export function babyAge(birthDate: string, onDay: string): string {
  return babyAgeText(computeBabyAge(birthDate, onDay))
}
