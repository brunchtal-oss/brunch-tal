"use client"

import { useCallback, useId, useState } from "react"
import { PrinterIcon, XIcon } from "lucide-react"

import type { Attendee } from "@/components/admin/attendee-row"
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
import { formatLocalDate } from "@/lib/time"
import { cn } from "@/lib/utils"

import { dayText } from "../../session-draft"

import {
  addPrepDayAction,
  addWorkDishAction,
  movePrepDayAction,
  removePrepDayAction,
} from "./actions"
import { RegistrantsTable } from "./attendee-sections"
import { ShoppingList, ShoppingPrint } from "./shopping-list"
import {
  AnnounceContext,
  useAnnounce,
  useKeyFor,
  useWorkAction,
} from "./use-work-action"
import {
  AddTask,
  DishEditButton,
  ErrorNotice,
  OUTLINE,
  TaskItem,
  TextForm,
  WorkPanel,
} from "./work-parts"
import {
  cardDays,
  dayDate,
  dayLabel,
  nextPrepDay,
  tasksOn,
  tasksOnDay,
  type PrepDay,
  type WorkDish,
  type WorkSheet,
} from "./work-sheet-data"

// The interactive part of the work sheet (stories 4.9 and 4.10, CAP-38;
// mockup key-admin-worksheet; user decisions 2026-10-07, two phone checks):
// "מנות", then one row: on the phone "+ מנה" and "+ יום הכנה" at the inline
// start, on desktop only "+ יום הכנה", and "הדפסה" at the end; on the phone
// a dish-card per dish; from lg a <table> with "+ מנה" under it. Only an added
// day (not one of the sheet's base days) has an X and a tap on its weekday
// and date that moves it: on the phone next to the day's heading in each
// dish card, on desktop in the table's column head (a plain days row only
// while there are no dishes). Then the registrants table ("נרשמות, תמונות
// ותזונה") and the shopping list. Print (DESIGN › worksheet-print) is
// @media print on this same page: a printed head, the dishes' table with
// only the days that have tasks, the registrants table and the shopping
// list (an empty part is not printed); app/globals.css removes the shell.

const copy = adminCopy.work

// "+ מנה" and "+ יום הכנה" in the tools row are the same size (second
// phone check); "+ מנה" keeps the primary fill.
const TOOL_SIZE = "h-11 w-28 justify-center px-2"
const TOOL_PRIMARY = cn(TOOL_SIZE, "rounded-[4px] text-[15px] font-semibold")

export function WorkSheetView({
  sheet,
  attendees,
}: {
  sheet: WorkSheet
  attendees: readonly Attendee[]
}) {
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
      <div data-work-sheet="" className="contents">
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <PrintHead sheet={sheet} bookings={attendees.length} />

        <section
          aria-labelledby="work-dishes"
          className={cn("flex flex-col gap-3", empty && "print:hidden")}
        >
          {/* On the phone "הדפסה" shares the line of "מנות", at the inline
              end; on desktop it is at the end of the tools row. */}
          <div className="flex items-center justify-between gap-3 print:hidden">
            <h2
              id="work-dishes"
              className="font-heading text-[22px] leading-[1.25] font-light"
            >
              {copy.dishes}
            </h2>
            <span data-print-phone="" className="lg:hidden">
              <PrintButton />
            </span>
          </div>

          {/* The tools row, right above the first dish. On the phone "+ מנה"
              then "+ יום הכנה" (the same size) at the inline start; on
              desktop "+ יום הכנה" and "הדפסה" at the inline end ("+ מנה" is
              under the table). The add-day reason or error wraps under it. */}
          <div
            data-work-tools=""
            className="flex flex-wrap items-center gap-2 print:hidden"
          >
            {!empty && (
              <span className="contents lg:hidden">
                <AddDishButton eventId={eventId} className={TOOL_PRIMARY} />
              </span>
            )}
            <AddDayButton
              eventId={eventId}
              prepDays={sheet.prepDays}
              addableDays={sheet.addableDays}
            />
            <span data-print-desktop="" className="ms-auto hidden lg:inline">
              <PrintButton />
            </span>
          </div>

          {/* Without dishes there is no card or column head to hold an added
              day's X and move, so they show in a plain row. */}
          {empty && sheet.prepDays.some((day) => day.added) && (
            <DaysRow
              eventId={eventId}
              prepDays={sheet.prepDays}
              addableDays={sheet.addableDays}
              dishes={sheet.dishes}
            />
          )}

          {empty ? (
            <EmptyDishes eventId={eventId} />
          ) : (
            <>
              <ul className="flex flex-col gap-3 lg:hidden print:hidden">
                {sheet.dishes.map((dish) => (
                  <li key={dish.id}>
                    <DishCard
                      eventId={eventId}
                      dish={dish}
                      dishes={sheet.dishes}
                      dishIds={dishIds}
                      prepDays={sheet.prepDays}
                      addableDays={sheet.addableDays}
                    />
                  </li>
                ))}
              </ul>
              <WorkTable
                eventId={eventId}
                dishes={sheet.dishes}
                dishIds={dishIds}
                prepDays={sheet.prepDays}
                addableDays={sheet.addableDays}
              />
              <div className="hidden lg:block print:hidden">
                <AddDishButton eventId={eventId} />
              </div>
            </>
          )}
        </section>

        <RegistrantsTable
          attendees={attendees}
          startsAt={sheet.event.startsAt}
        />
        <ShoppingList
          eventId={eventId}
          conceptName={sheet.event.conceptName}
          startsAt={sheet.event.startsAt}
          items={sheet.shopping}
        />
        <ShoppingPrint items={sheet.shopping} />
      </div>
    </AnnounceContext>
  )
}

// The printed head (mockup key-admin-worksheet 195): "דף עבודה · {קונספט}"
// and the session's line with the number of bookings, in the uniform type
// (no concept theme). Print only; on screen WorkSheetHead is the head.
function PrintHead({
  sheet,
  bookings,
}: {
  sheet: WorkSheet
  bookings: number
}) {
  const day = formatLocalDate(sheet.event.startsAt)
  return (
    <div className="hidden border-b-2 pb-2 print:block">
      <h2 className="font-heading text-[22px] leading-[1.25] font-light">
        <bdi>{copy.printTitle(sheet.event.conceptName)}</bdi>
      </h2>
      <p className="text-[13px]">
        <bdi>{copy.printMeta(dayText(day), bookings)}</bdi>
      </p>
    </div>
  )
}

// "הדפסה": the browser's print of this page (no PDF on the server, no
// separate route; AD-16).
function PrintButton() {
  return (
    <button type="button" className={OUTLINE} onClick={() => window.print()}>
      <PrinterIcon aria-hidden strokeWidth={1.5} className="size-5" />
      {copy.print}
    </button>
  )
}

// empty-state (DESIGN › empty-state): the heading and one action.
function EmptyDishes({ eventId }: { eventId: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg bg-muted px-4 py-6 text-center">
      <p className="font-heading text-[26px] leading-[1.2] font-light text-balance">
        {copy.empty}
      </p>
      <AddDishButton eventId={eventId} />
    </div>
  )
}

// "+ מנה": the page's one primary button (and the empty-state's action).
// className: the button's look where it differs (the phone's narrow one).
function AddDishButton({
  eventId,
  className,
}: {
  eventId: string
  className?: string
}) {
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
        className={
          className ??
          "h-12 w-full rounded-[4px] px-6 text-base font-semibold sm:w-auto"
        }
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
        <ErrorNotice code={error} />
      </WorkPanel>
    </>
  )
}

// "+ יום הכנה": adds the day before the sheet's earliest at once, without a
// choice (user decision 2026-10-07). When the earliest is already six days
// before, it is aria-disabled with the reason under the row.
function AddDayButton({
  eventId,
  prepDays,
  addableDays,
}: {
  eventId: string
  prepDays: readonly PrepDay[]
  addableDays: readonly PrepDay[]
}) {
  const reasonId = useId()
  const announce = useAnnounce()
  const { pending, error, run } = useWorkAction()
  const keys = useKeyFor()
  const next = nextPrepDay(prepDays, addableDays)

  // A fragment inside the tools row: the button in the row, the reason and
  // the error last, on a line of their own under it (order-last basis-full).
  return (
    <>
      <button
        type="button"
        className={cn(
          OUTLINE,
          TOOL_SIZE,
          !next && "cursor-not-allowed opacity-50"
        )}
        aria-disabled={!next || pending || undefined}
        aria-busy={pending || undefined}
        aria-describedby={next ? undefined : reasonId}
        onClick={() => {
          if (!next || pending) return
          run(
            () =>
              addPrepDayAction({
                eventId,
                dayOffset: next.offset,
                idempotencyKey: keys.keyFor(String(next.offset)),
              }),
            () => {
              keys.clear()
              announce(copy.dayAdded(dayDate(next)))
            }
          )
        }}
      >
        {pending && <Spinner aria-hidden />}
        {copy.addDay}
      </button>
      {!next && (
        <p
          id={reasonId}
          className="order-last basis-full text-[15px] text-muted-foreground"
        >
          {copy.addDayLimit}
        </p>
      )}
      {error && (
        <div className="order-last basis-full">
          <ErrorNotice code={error} />
        </div>
      )}
    </>
  )
}

// A base day's name: the weekday and date, bold, and under it how long
// before the session it is.
function DayTitle({ day }: { day: PrepDay }) {
  return (
    <time dateTime={day.date} className="flex flex-col">
      <bdi className="text-[15px] leading-[1.35] font-semibold text-foreground">
        {dayDate(day)}
      </bdi>
      <span className="text-[13px] leading-[1.4] font-normal text-muted-foreground">
        {dayLabel(day.offset)}
      </span>
    </time>
  )
}

// The prep days as a plain text row, only while the sheet has no dishes
// and has an added day (with dishes, an added day's X and move sit in each
// dish card on the phone and in the column head on desktop). A base day
// is text; an added day is its weekday and date as a button that moves it,
// and an X.
function DaysRow({
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
  const labelId = useId()
  return (
    <div className="flex flex-col gap-1 print:hidden">
      <h3
        id={labelId}
        className="text-[13px] font-semibold text-muted-foreground"
      >
        {copy.days}
      </h3>
      <ul
        aria-labelledby={labelId}
        className="flex flex-wrap items-center gap-x-6 gap-y-1"
      >
        {prepDays.map((day) => (
          <li key={day.offset} className="flex min-h-11 items-center">
            {day.added ? (
              <AddedDay
                eventId={eventId}
                day={day}
                addableDays={addableDays}
                dishes={dishes}
              />
            ) : (
              <time dateTime={day.date} className="text-[15px]">
                <bdi className="font-semibold">{dayDate(day)}</bdi>
                <span className="text-muted-foreground">
                  {" · "}
                  {dayLabel(day.offset)}
                </span>
              </time>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// An added day: its weekday and date (a button that moves it to a free day,
// its tasks with it) and an X that removes it (a day with tasks asks first;
// the tasks go with it). In print only the date is left.
function AddedDay({
  eventId,
  day,
  addableDays,
  dishes,
}: {
  eventId: string
  day: PrepDay
  addableDays: readonly PrepDay[]
  dishes: readonly WorkDish[]
}) {
  const announce = useAnnounce()
  const { pending, error, run } = useWorkAction()
  const keys = useKeyFor()
  const [asking, setAsking] = useState(false)
  const [moving, setMoving] = useState(false)
  const tasks = tasksOnDay(dishes, day.offset)
  const name = dayDate(day)

  function remove() {
    run(
      () =>
        removePrepDayAction({
          eventId,
          dayOffset: day.offset,
          idempotencyKey: keys.keyFor(String(day.offset)),
        }),
      () => {
        keys.clear()
        announce(copy.dayRemoved(name))
        setAsking(false)
      }
    )
  }

  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex flex-wrap items-center">
        <time dateTime={day.date} className="hidden font-semibold print:inline">
          <bdi>{name}</bdi>
        </time>
        {addableDays.length > 0 ? (
          <button
            type="button"
            aria-label={copy.moveDayNamed(name)}
            onClick={() => setMoving(true)}
            className="inline-flex min-h-11 items-center rounded-[4px] text-[15px] font-semibold text-foreground underline decoration-dotted underline-offset-[5px] hover:decoration-solid print:hidden"
          >
            <time dateTime={day.date}>
              <bdi>{name}</bdi>
            </time>
          </button>
        ) : (
          // No free day to move to: the date is plain text.
          <time
            dateTime={day.date}
            className="inline-flex min-h-11 items-center text-[15px] font-semibold text-foreground print:hidden"
          >
            <bdi>{name}</bdi>
          </time>
        )}
        <button
          type="button"
          aria-label={copy.removeDayNamed(name)}
          disabled={pending}
          onClick={() => (tasks > 0 ? setAsking(true) : remove())}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <XIcon aria-hidden strokeWidth={1.5} className="size-[18px]" />
        </button>
      </span>
      {error && !asking && (
        <InlineNotice tone="error">{errorMessage(error)}</InlineNotice>
      )}

      <AlertDialog
        open={asking}
        onOpenChange={(open) => {
          if (!open && !pending) setAsking(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading text-[22px] leading-[1.25] font-light">
              {copy.removeDayTitle(name)}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[15px]">
              {copy.removeDayTasks(tasks)}
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
              onClick={() => !pending && remove()}
            >
              {pending && <Spinner aria-hidden />}
              {copy.removeDay}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {moving && (
        <MoveDayPanel
          eventId={eventId}
          day={day}
          addableDays={addableDays}
          onClose={() => setMoving(false)}
        />
      )}
    </span>
  )
}

// Moving an added day: a one-tap choice among the free days of the week
// before (dates from the server); its tasks move with it.
function MoveDayPanel({
  eventId,
  day,
  addableDays,
  onClose,
}: {
  eventId: string
  day: PrepDay
  addableDays: readonly PrepDay[]
  onClose: () => void
}) {
  const id = useId()
  const announce = useAnnounce()
  const { pending, error, run } = useWorkAction()
  const [choice, setChoice] = useState("")
  const [key, setKey] = useState(newIdempotencyKey)
  const chosen = addableDays.find((d) => String(d.offset) === choice)

  return (
    <WorkPanel
      open
      onOpenChange={(next) => !next && onClose()}
      busy={pending}
      title={copy.moveDayTitle(dayDate(day))}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (pending || !chosen) return
          run(
            () =>
              movePrepDayAction({
                eventId,
                from: day.offset,
                to: chosen.offset,
                idempotencyKey: key,
              }),
            () => {
              announce(copy.dayMoved(dayDate(day), dayDate(chosen)))
              onClose()
            }
          )
        }}
      >
        <RadioCardGroup
          legend={copy.moveDayLegend}
          name={`${id}-day`}
          options={addableDays.map((d) => ({
            value: String(d.offset),
            label: dayDate(d),
          }))}
          value={choice}
          onChange={(value) => {
            setChoice(value)
            setKey(newIdempotencyKey())
          }}
        />
        <p className="text-[15px] text-muted-foreground">{copy.moveDayNote}</p>
        <Button
          type="submit"
          size="lg"
          aria-busy={pending || undefined}
          aria-disabled={pending || !chosen || undefined}
          className="h-12 rounded-[4px] text-base font-semibold"
        >
          {pending && <Spinner aria-hidden />}
          {copy.moveDay}
        </Button>
      </form>
      <ErrorNotice code={error} />
    </WorkPanel>
  )
}

// dish-card (DESIGN › dish-card): the name and "עריכה", then a group for
// each day on which the dish has tasks, and after all of them one
// "+ משימה" with a choice of day (user decision 2026-10-07, phone check: no
// "+ משימה" inside a day's group). Each day's heading stands out (round 2).
// An added day is in every card, with its X and move next to its heading,
// as in the desktop column head (second phone check: no days row).
function DishCard({
  eventId,
  dish,
  dishes,
  dishIds,
  prepDays,
  addableDays,
}: {
  eventId: string
  dish: WorkDish
  dishes: readonly WorkDish[]
  dishIds: readonly string[]
  prepDays: readonly PrepDay[]
  addableDays: readonly PrepDay[]
}) {
  const days = cardDays(dish, prepDays)
  return (
    <article className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 pt-1 pb-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 py-2.5 text-base leading-[1.35] font-semibold break-words">
          <bdi>{dish.name}</bdi>
        </h3>
        <DishEditButton dish={dish} dishIds={dishIds} />
      </div>
      {days.length > 0 && (
        // The days in order, earlier day to the session day, on a rail at
        // the inline start; the session day's dot is primary.
        <ol className="relative mb-2 flex flex-col gap-3 before:absolute before:inset-y-2 before:start-[4px] before:w-px before:bg-border">
          {days.map((day) => {
            const tasks = tasksOn(dish, day.offset)
            return (
              <li key={day.offset} className="relative flex flex-col ps-6">
                <span
                  aria-hidden
                  className={cn(
                    "absolute start-0 size-[9px] rounded-full border",
                    day.added ? "top-[17px]" : "top-[7px]",
                    day.offset === 0
                      ? "border-primary bg-primary"
                      : "border-muted-foreground bg-card"
                  )}
                />
                {day.added ? (
                  // The heading is the day's text only; its controls (the
                  // date that moves it, the X) are next to it, outside.
                  <>
                    <h4 className="sr-only">
                      <time dateTime={day.date}>
                        <bdi>{dayDate(day)}</bdi>
                      </time>
                    </h4>
                    <AddedDay
                      eventId={eventId}
                      day={day}
                      addableDays={addableDays}
                      dishes={dishes}
                    />
                  </>
                ) : (
                  <h4 className="text-[15px] leading-[1.4] font-semibold text-foreground">
                    <time dateTime={day.date}>
                      <bdi>{dayDate(day)}</bdi>
                      <span className="font-normal text-muted-foreground">
                        {" · "}
                        {dayLabel(day.offset)}
                      </span>
                    </time>
                  </h4>
                )}
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
// prep day, with caption and scope. An added day's head holds its move
// button and its X.
function WorkTable({
  eventId,
  dishes,
  dishIds,
  prepDays,
  addableDays,
}: {
  eventId: string
  dishes: readonly WorkDish[]
  dishIds: readonly string[]
  prepDays: readonly PrepDay[]
  addableDays: readonly PrepDay[]
}) {
  const usedDays = new Set(
    prepDays
      .filter((day) => tasksOnDay(dishes, day.offset) > 0)
      .map((day) => day.offset)
  )
  return (
    // In print the table shows on every width, with only the days that
    // have tasks (an empty column is not printed). table-fixed: the dish
    // column keeps 28% and the day columns share the rest equally, so an
    // added day is as wide as the others; a column hidden in print gives
    // its share to the ones left.
    <div className="hidden overflow-x-auto lg:block print:block print:overflow-visible">
      <table className="w-full table-fixed border-collapse text-[15px] print:text-[12px]">
        <caption className="sr-only">{copy.tableCaption}</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="w-[28%] border border-border bg-muted p-2 text-start align-bottom text-[13px] font-semibold text-muted-foreground"
            >
              {copy.dishColumn}
            </th>
            {prepDays.map((day) => (
              <th
                key={day.offset}
                scope="col"
                className={cn(
                  "border border-border bg-muted p-2 text-start align-bottom break-words",
                  !usedDays.has(day.offset) && "print:hidden"
                )}
              >
                {day.added ? (
                  <AddedDay
                    eventId={eventId}
                    day={day}
                    addableDays={addableDays}
                    dishes={dishes}
                  />
                ) : (
                  <DayTitle day={day} />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dishes.map((dish) => (
            <tr key={dish.id}>
              <th
                scope="row"
                className="border border-border p-2 text-start align-top font-semibold"
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
                    className={cn(
                      "border border-border p-2 text-start align-top break-words",
                      !usedDays.has(day.offset) && "print:hidden"
                    )}
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
