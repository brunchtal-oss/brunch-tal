"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"
import { SlidersHorizontalIcon } from "lucide-react"

import { WorkPanel } from "@/components/admin/edit-kit"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { SpecialBrunchContent } from "@/lib/content/schema"
import { adminCopy } from "@/lib/copy/admin"
import {
  SPECIAL_BRUNCH_CODES,
  specialBrunchOptions,
  type SpecialBrunchCode,
} from "@/lib/special-brunch"
import { cn } from "@/lib/utils"

import {
  categoryHref,
  choiceActivity,
  filterChoice,
  filterCount,
  type CustomerActivity,
  type FilterChoice,
} from "./customer-items"

const copy = adminCopy.customers
const ACTIVITIES = ["active", "inactive"] as const

// Story 2.16 (phone-check fix, user decision 2026-11-10): one small "סינון"
// button in place of the category buttons and the special-brunch chips. It
// carries the number of active filters and opens a bottom sheet of
// checkboxes: "כל הלקוחות" (clears the rest; checked when nothing else is),
// the two activities and the three special brunches (titles from the
// content block). "הצגת הלקוחות" goes to the filter's address, so the list,
// "back" and the export follow the URL as before.
export function CustomerFilter({
  category,
  interests,
  specialBrunch,
  onApply,
}: {
  // The open filter (null: no list yet).
  category: CustomerActivity | null
  interests: readonly SpecialBrunchCode[]
  specialBrunch: SpecialBrunchContent
  onApply: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<FilterChoice>(() =>
    filterChoice(category, interests)
  )
  const count = filterCount(category, interests)

  return (
    <>
      <button
        type="button"
        aria-label={copy.filter.buttonLabel(count)}
        onClick={() => {
          // A fresh sheet: the open filter.
          setChoice(filterChoice(category, interests))
          setOpen(true)
        }}
        className={cn(
          "inline-flex min-h-11 items-center gap-2 self-start rounded-[4px] border px-3 text-[15px] font-semibold",
          count > 0
            ? "border-primary text-primary"
            : "border-muted-foreground text-foreground hover:bg-muted"
        )}
      >
        <SlidersHorizontalIcon
          aria-hidden
          strokeWidth={1.5}
          className="size-5"
        />
        {copy.filter.button}
        {count > 0 && (
          <span
            aria-hidden
            className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-[13px] text-primary-foreground"
          >
            {count}
          </span>
        )}
      </button>
      <WorkPanel
        open={open}
        onOpenChange={setOpen}
        busy={false}
        title={copy.filter.title}
      >
        <FilterForm
          choice={choice}
          onChoiceChange={setChoice}
          specialBrunch={specialBrunch}
          onSubmit={() => {
            setOpen(false)
            onApply()
            router.push(categoryHref(choiceActivity(choice), choice.interests))
          }}
        />
      </WorkPanel>
    </>
  )
}

// The sheet's body: "כל הלקוחות", the two groups and the one button.
export function FilterForm({
  choice,
  onChoiceChange,
  specialBrunch,
  onSubmit,
}: {
  choice: FilterChoice
  onChoiceChange: (choice: FilterChoice) => void
  specialBrunch: SpecialBrunchContent
  onSubmit: () => void
}) {
  const id = useId()
  const none = choice.activities.length === 0 && choice.interests.length === 0

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <Row
        id={`${id}-all`}
        label={copy.filter.all}
        checked={none}
        onCheckedChange={(next) => {
          if (next) onChoiceChange({ activities: [], interests: [] })
        }}
      />

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-2 text-[15px] font-semibold">
          {copy.filter.activityLegend}
        </legend>
        {ACTIVITIES.map((value) => (
          <Row
            key={value}
            id={`${id}-${value}`}
            label={copy.categories[value]}
            checked={choice.activities.includes(value)}
            onCheckedChange={(next) =>
              onChoiceChange({
                ...choice,
                activities: ACTIVITIES.filter((a) =>
                  a === value ? next : choice.activities.includes(a)
                ),
              })
            }
          />
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-2 text-[15px] font-semibold">
          {copy.filter.specialBrunchLegend}
        </legend>
        {specialBrunchOptions(specialBrunch).map((option) => (
          <Row
            key={option.code}
            id={`${id}-${option.code}`}
            label={option.title}
            checked={choice.interests.includes(option.code)}
            onCheckedChange={(next) =>
              onChoiceChange({
                ...choice,
                interests: SPECIAL_BRUNCH_CODES.filter((code) =>
                  code === option.code ? next : choice.interests.includes(code)
                ),
              })
            }
          />
        ))}
      </fieldset>

      <Button
        type="submit"
        size="lg"
        className="h-12 rounded-[4px] text-base font-semibold"
      >
        {copy.filter.apply}
      </Button>
    </form>
  )
}

function Row({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  id: string
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex min-h-11 items-center gap-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className="size-6 rounded-[4px] border-[1.5px] border-muted-foreground"
      />
      <label htmlFor={id} className="text-base">
        {label}
      </label>
    </div>
  )
}
