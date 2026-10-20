"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { InlineNotice } from "@/components/shared/inline-notice"
import { OnlineButton } from "@/components/shared/online-button"
import { sectionTitleClass } from "@/components/shared/section-title"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage, type ErrorCode } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"

import { updateScheduleAction } from "./actions"
import {
  DEFAULT_TIME,
  dayProblem,
  draftFromSchedule,
  scheduleChanged,
  scheduleFromDraft,
  type ScheduleDay,
  type ScheduleSlot,
} from "./marketing-draft"

const copy = adminCopy.settings.marketing

type Answer = { ok: true } | { ok: false; code: ErrorCode }

// The schedule (story 5.11): one row per weekday, Sunday first, a checkbox
// with the day's name and, only while it is checked, its time. One save
// with the version this page read (STALE_VERSION when the settings changed
// since); the save shows only while the draft differs from the saved
// schedule. A checked day without a valid time says so and blocks the
// save. After a save the page refreshes, so the saved schedule and its
// version come from the server. One idempotency key per attempt (AD-5).
export function ScheduleEditor({
  version,
  schedule,
}: {
  version: number
  schedule: readonly ScheduleSlot[]
}) {
  const router = useRouter()
  const [draft, setDraft] = useState(() => draftFromSchedule(schedule))
  const [key, setKey] = useState(() => newIdempotencyKey())
  const [pending, setPending] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [showProblems, setShowProblems] = useState(false)

  const changed = scheduleChanged(schedule, draft)

  const setDay = (weekday: number, patch: Partial<ScheduleDay>) => {
    setAnswer(null)
    setDraft((current) =>
      current.map((day, index) =>
        index === weekday ? { ...day, ...patch } : day
      )
    )
  }

  const save = async () => {
    if (pending) return
    const next = scheduleFromDraft(draft)
    if (next === null) {
      setShowProblems(true)
      return
    }
    setPending(true)
    setAnswer(null)
    let result: Answer
    try {
      const response = await updateScheduleAction({
        schedule: next,
        expectedVersion: version,
        idempotencyKey: key,
      })
      result = response.ok ? { ok: true } : { ok: false, code: response.code }
    } catch {
      result = { ok: false, code: "SERVER_ERROR" }
    }
    setKey(newIdempotencyKey())
    setPending(false)
    setAnswer(result)
    if (result.ok) {
      setShowProblems(false)
      router.refresh()
    }
  }

  return (
    <section
      aria-labelledby="marketing-schedule"
      className="flex flex-col gap-3"
    >
      <h2 id="marketing-schedule" className={sectionTitleClass}>
        {copy.schedule}
      </h2>
      <ul className="flex flex-col divide-y divide-border border-y border-border">
        {draft.map((day, weekday) => {
          const name = copy.days[weekday]
          const boxId = `marketing-day-${weekday}`
          const timeId = `marketing-time-${weekday}`
          const errorId = `${timeId}-error`
          const problem = showProblems && dayProblem(day)
          return (
            <li
              key={weekday}
              className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2"
            >
              <div className="flex min-h-11 items-center gap-3">
                <Checkbox
                  id={boxId}
                  checked={day.on}
                  onCheckedChange={(next) =>
                    setDay(weekday, {
                      on: next === true,
                      time: day.time === "" ? DEFAULT_TIME : day.time,
                    })
                  }
                  className="size-6 rounded-[4px] border-[1.5px] border-muted-foreground"
                />
                <label htmlFor={boxId} className="text-base">
                  {name}
                </label>
              </div>
              {day.on && (
                <div className="flex flex-col items-end gap-1">
                  <Input
                    id={timeId}
                    type="time"
                    value={day.time}
                    onChange={(event) =>
                      setDay(weekday, { time: event.target.value })
                    }
                    aria-label={copy.timeLabel(name)}
                    aria-invalid={problem ? true : undefined}
                    aria-describedby={problem ? errorId : undefined}
                    className="h-12 w-32 text-start text-base"
                  />
                  {problem && (
                    <p id={errorId} className="text-[15px] text-error">
                      {adminCopy.settings.timeInvalid}
                    </p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <div aria-live="polite" className="flex flex-col gap-3">
        {answer?.ok && (
          <InlineNotice tone="success">{copy.scheduleSaved}</InlineNotice>
        )}
        {answer && !answer.ok && (
          <InlineNotice tone="error">{errorMessage(answer.code)}</InlineNotice>
        )}
      </div>
      {changed && !answer?.ok && (
        <OnlineButton
          type="button"
          onClick={() => void save()}
          aria-disabled={pending ? true : undefined}
          className="h-12 self-start px-6 text-base"
        >
          {pending && <Spinner className="size-[18px]" />}
          {copy.save}
        </OnlineButton>
      )}
    </section>
  )
}
