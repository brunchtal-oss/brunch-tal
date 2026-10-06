"use client"

import { useCallback, useId, useState } from "react"
import { XIcon } from "lucide-react"

import { RadioCardGroup } from "@/components/admin/radio-card"
import { InlineNotice } from "@/components/shared/inline-notice"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { adminCopy } from "@/lib/copy/admin"
import { errorMessage } from "@/lib/errors"
import { newIdempotencyKey } from "@/lib/idempotency"
import { cn } from "@/lib/utils"

import {
  addPrepDayAction,
  addWorkDishAction,
  removePrepDayAction,
} from "./actions"
import { AnnounceContext, useAnnounce, useWorkAction } from "./use-work-action"
import {
  AddTask,
  DishEditButton,
  TaskItem,
  TextForm,
  WorkPanel,
} from "./work-parts"
import {
  cardDays,
  dayDate,
  dayHeading,
  dayLabel,
  tasksOn,
  tasksOnDay,
  type PrepDay,
  type WorkDish,
  type WorkSheet,
} from "./work-sheet-data"

// The interactive part of the work sheet (story 4.9, CAP-38; mockup
// key-admin-worksheet): "+ מנה" and "+ יום הכנה", the prep days (remove,
// with a confirm when the day has tasks), then the dishes: a dish-card each
// on the phone, a <table> from lg. 4.10 adds its sections after the dishes.

const copy = adminCopy.work

export function WorkSheetView({ sheet }: { sheet: WorkSheet }) {
  const [announcement, setAnnouncement] = useState("")
  const announce = useCallback((text: string) => {
    // A repeated text is announced again.
    setAnnouncement("")
    queueMicrotask(() => setAnnouncement(text))
  }, [])
  const eventId = sheet.event.id
  const dishIds = sheet.dishes.map((dish) => dish.id)
  const empty = sheet.dishes.length === 0

  return (
    <AnnounceContext value={announce}>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {!empty && (
        <div className="print:hidden">
          <AddDishButton eventId={eventId} />
        </div>
      )}

      <PrepDays
        eventId={eventId}
        prepDays={sheet.prepDays}
        addableDays={sheet.addableDays}
        dishes={sheet.dishes}
      />

      <section aria-labelledby="work-dishes" className="flex flex-col gap-3">
        <h2
          id="work-dishes"
          className="font-heading text-[22px] leading-[1.25] font-light"
        >
          {copy.dishes}
        </h2>
        {empty ? (
          <EmptyDishes eventId={eventId} />
        ) : (
          <>
            <ul className="flex flex-col gap-3 lg:hidden">
              {sheet.dishes.map((dish) => (
                <li key={dish.id}>
                  <DishCard
                    dish={dish}
                    dishIds={dishIds}
                    prepDays={sheet.prepDays}
                  />
                </li>
              ))}
            </ul>
            <WorkTable
              dishes={sheet.dishes}
              dishIds={dishIds}
              prepDays={sheet.prepDays}
            />
          </>
        )}
      </section>
    </AnnounceContext>
  )
}

// empty-state (DESIGN › empty-state): the heading and one action.
function EmptyDishes({ eventId }: { eventId: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg bg-muted px-4 py-7 text-center">
      <p className="font-heading text-[26px] leading-[1.2] font-light text-balance">
        {copy.empty}
      </p>
      <AddDishButton eventId={eventId} />
    </div>
  )
}

// "+ מנה": the page's one primary button (and the empty-state's action).
function AddDishButton({ eventId }: { eventId: string }) {
  const id = useId()
  const { pending, error, run, clearError } = useWorkAction()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [key, setKey] = useState(newIdempotencyKey)

  return (
    <>
      <Button
        type="button"
        size="lg"
        onClick={() => setOpen(true)}
        className="h-12 w-full rounded-[4px] px-6 text-base font-semibold sm:w-auto"
      >
        {copy.addDish}
      </Button>
      <WorkPanel
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) clearError()
        }}
        busy={pending}
        title={copy.addDish}
      >
        <TextForm
          id={`${id}-name`}
          label={copy.dishName}
          value={name}
          onChange={setName}
          submitLabel={copy.add}
          pending={pending}
          onSubmit={() =>
            run(
              () => addWorkDishAction({ eventId, name, idempotencyKey: key }),
              () => {
                setName("")
                setKey(newIdempotencyKey())
                setOpen(false)
              }
            )
          }
        />
        {error && (
          <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>
        )}
      </WorkPanel>
    </>
  )
}

// "+ יום הכנה": a choice among the days of -6..0 that are not on the sheet
// yet (dates from the server). Hidden when every day is there.
function AddDayButton({
  eventId,
  addableDays,
}: {
  eventId: string
  addableDays: readonly PrepDay[]
}) {
  const id = useId()
  const announce = useAnnounce()
  const { pending, error, run, clearError } = useWorkAction()
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState("")
  const [key, setKey] = useState(newIdempotencyKey)

  if (addableDays.length === 0) return null
  const chosen = addableDays.find((day) => String(day.offset) === choice)

  return (
    <>
      <button
        type="button"
        className="inline-flex min-h-11 items-center rounded-full border border-dashed border-muted-foreground px-4 text-[15px] font-semibold text-foreground hover:bg-muted"
        onClick={() => {
          setChoice(String(addableDays[addableDays.length - 1].offset))
          setOpen(true)
        }}
      >
        {copy.addDay}
      </button>
      <WorkPanel
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) clearError()
        }}
        busy={pending}
        title={copy.addDay}
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (pending || !chosen) return
            run(
              () =>
                addPrepDayAction({
                  eventId,
                  dayOffset: chosen.offset,
                  idempotencyKey: key,
                }),
              () => {
                announce(copy.dayAdded(dayDate(chosen)))
                setKey(newIdempotencyKey())
                setOpen(false)
              }
            )
          }}
        >
          <RadioCardGroup
            legend={copy.pickDay}
            name={`${id}-day`}
            options={addableDays.map((day) => ({
              value: String(day.offset),
              label: dayHeading(day),
            }))}
            value={choice}
            onChange={setChoice}
          />
          <Button
            type="submit"
            size="lg"
            aria-busy={pending || undefined}
            aria-disabled={pending || !chosen || undefined}
            className="h-12 rounded-[4px] text-base font-semibold"
          >
            {pending && <Spinner aria-hidden />}
            {copy.add}
          </Button>
        </form>
        {error && (
          <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>
        )}
      </WorkPanel>
    </>
  )
}

// The sheet's prep days as a wrapping row of chips ("ד׳ 07.10 · יום לפני"),
// each with a remove button while more than one is left (a day with tasks
// asks first; the tasks go with it), and "+ יום הכנה" at the end.
function PrepDays({
  eventId,
  prepDays,
  addableDays,
  dishes,
}: {
  eventId: string
  prepDays: readonly PrepDay[]
  addableDays: readonly PrepDay[]
  dishes: readonly WorkDish[]
}) {
  const announce = useAnnounce()
  const { pending, error, run } = useWorkAction()
  const [asking, setAsking] = useState<PrepDay | null>(null)
  const [key, setKey] = useState(newIdempotencyKey)
  const removable = prepDays.length > 1
  const askingTasks = asking ? tasksOnDay(dishes, asking.offset) : 0

  function remove(day: PrepDay) {
    run(
      () =>
        removePrepDayAction({
          eventId,
          dayOffset: day.offset,
          idempotencyKey: key,
        }),
      () => {
        announce(copy.dayRemoved(dayDate(day)))
        setKey(newIdempotencyKey())
        setAsking(null)
      }
    )
  }

  return (
    <section aria-labelledby="work-days" className="flex flex-col gap-2">
      <h2 id="work-days" className="text-[15px] font-semibold">
        {copy.days}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {prepDays.map((day) => (
          <li
            key={day.offset}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border border-border bg-card ps-4 text-[15px]",
              removable ? "pe-0.5" : "pe-4"
            )}
          >
            <span>
              <time dateTime={day.date} className="font-semibold">
                <bdi>{dayDate(day)}</bdi>
              </time>
              <span className="text-muted-foreground">
                {" · "}
                {dayLabel(day.offset)}
              </span>
            </span>
            {removable && (
              <button
                type="button"
                aria-label={copy.removeDayNamed(dayDate(day))}
                disabled={pending}
                onClick={() =>
                  tasksOnDay(dishes, day.offset) > 0
                    ? setAsking(day)
                    : remove(day)
                }
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 print:hidden"
              >
                <XIcon aria-hidden strokeWidth={1.5} className="size-[18px]" />
              </button>
            )}
          </li>
        ))}
        {addableDays.length > 0 && (
          <li className="print:hidden">
            <AddDayButton eventId={eventId} addableDays={addableDays} />
          </li>
        )}
      </ul>
      {error && !asking && (
        <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>
      )}

      <AlertDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setAsking(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[20px] font-light">
              {asking && copy.removeDayTitle(dayDate(asking))}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[15px]">
              {copy.removeDayTasks(askingTasks)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && asking && (
            <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 text-base" disabled={pending}>
              {copy.cancel}
            </AlertDialogCancel>
            <Button
              type="button"
              className="h-11 text-base"
              aria-busy={pending || undefined}
              aria-disabled={pending || undefined}
              onClick={() => asking && !pending && remove(asking)}
            >
              {pending && <Spinner aria-hidden />}
              {copy.removeDay}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// dish-card (DESIGN › dish-card): the name and "עריכה", then a group for
// each day on which the dish has tasks, and after all of them one
// "+ משימה" with a choice of day (user decision 2026-10-07, phone check: no
// "+ משימה" inside a day's group).
function DishCard({
  dish,
  dishIds,
  prepDays,
}: {
  dish: WorkDish
  dishIds: readonly string[]
  prepDays: readonly PrepDay[]
}) {
  const days = cardDays(dish, prepDays)
  return (
    <article className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 pt-1 pb-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 py-2.5 text-lg leading-[1.35] font-semibold break-words">
          <bdi>{dish.name}</bdi>
        </h3>
        <DishEditButton dish={dish} dishIds={dishIds} />
      </div>
      {days.length > 0 && (
        // The days in order, earlier day to the session day, on a rail at
        // the inline start; the session day's dot is primary.
        <ol className="relative mb-2 flex flex-col gap-2 before:absolute before:inset-y-2 before:start-[4px] before:w-px before:bg-border">
          {days.map((day) => {
            const tasks = tasksOn(dish, day.offset)
            return (
              <li key={day.offset} className="relative flex flex-col ps-5">
                <span
                  aria-hidden
                  className={cn(
                    "absolute start-0 top-[6px] size-[9px] rounded-full border",
                    day.offset === 0
                      ? "border-primary bg-primary"
                      : "border-muted-foreground bg-card"
                  )}
                />
                <h4 className="text-[13px] leading-[1.4] font-semibold text-muted-foreground">
                  <time dateTime={day.date}>
                    <bdi>{dayHeading(day)}</bdi>
                  </time>
                </h4>
                <ul className="flex flex-col">
                  {tasks.map((task) => (
                    <TaskItem
                      key={task.id}
                      task={task}
                      cellIds={tasks.map((t) => t.id)}
                      prepDays={prepDays}
                    />
                  ))}
                </ul>
              </li>
            )
          })}
        </ol>
      )}
      <AddTask dishId={dish.id} prepDays={prepDays} />
    </article>
  )
}

// From lg (DESIGN › worksheet-print): a dish column and a column for each
// prep day, with caption and scope.
function WorkTable({
  dishes,
  dishIds,
  prepDays,
}: {
  dishes: readonly WorkDish[]
  dishIds: readonly string[]
  prepDays: readonly PrepDay[]
}) {
  return (
    <div className="hidden overflow-x-auto lg:block">
      <table className="w-full border-collapse text-[15px]">
        <caption className="sr-only">{copy.tableCaption}</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="border border-border bg-muted p-2 text-start font-semibold"
            >
              {copy.dishColumn}
            </th>
            {prepDays.map((day) => (
              <th
                key={day.offset}
                scope="col"
                className="border border-border bg-muted p-2 text-start font-semibold"
              >
                <time dateTime={day.date}>
                  <bdi>{dayHeading(day)}</bdi>
                </time>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dishes.map((dish) => (
            <tr key={dish.id}>
              <th
                scope="row"
                className="w-[28%] border border-border p-2 text-start align-top font-semibold"
              >
                <div className="flex items-start justify-between gap-2">
                  <bdi className="min-w-0 py-2.5 break-words">{dish.name}</bdi>
                  <DishEditButton dish={dish} dishIds={dishIds} />
                </div>
              </th>
              {prepDays.map((day) => {
                const tasks = tasksOn(dish, day.offset)
                return (
                  <td
                    key={day.offset}
                    className="border border-border p-2 text-start align-top"
                  >
                    <div className="flex flex-col">
                      {tasks.length > 0 && (
                        <ul className="flex flex-col">
                          {tasks.map((task) => (
                            <TaskItem
                              key={task.id}
                              task={task}
                              cellIds={tasks.map((t) => t.id)}
                              prepDays={prepDays}
                            />
                          ))}
                        </ul>
                      )}
                      <AddTask dishId={dish.id} prepDays={prepDays} day={day} />
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
