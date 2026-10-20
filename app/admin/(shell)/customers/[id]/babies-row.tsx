import { adminCopy } from "@/lib/copy/admin"

import type { BabyItem } from "./card-items"

const copy = adminCopy.customers.card

// The babies' row at the end of the card's "פרטים" (fix 9): each name and
// age, or "no babies".
export function BabiesRow({ babies }: { babies: BabyItem[] }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[13px] text-muted-foreground">{copy.babies}</dt>
      <dd className="text-base">
        {babies.length === 0 ? (
          <span className="text-muted-foreground">{copy.noBabies}</span>
        ) : (
          <ul className="flex flex-col gap-1">
            {babies.map((baby) => (
              <li key={baby.key}>
                <bdi className="font-semibold">{baby.name}</bdi>
                {baby.age && (
                  <span className="text-muted-foreground">, {baby.age}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  )
}
