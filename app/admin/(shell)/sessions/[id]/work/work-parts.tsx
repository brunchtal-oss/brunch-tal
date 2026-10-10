"use client"

import { useEffect, useId, useRef, useState } from "react"
import { PencilIcon } from "lucide-react"

import {
  DeleteStep,
  ErrorNotice,
  MoveButtons,
  TEXT_BUTTON,
  TextForm,
  WorkPanel,
} from "@/components/admin/edit-kit"
import { RadioCardGroup } from "@/components/admin/radio-card"
import { useAnnounce, useWorkAction } from "@/components/admin/use-work-action"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { adminCopy } from "@/lib/copy/admin"
import { newIdempotencyKey } from "@/lib/idempotency"
import { cn } from "@/lib/utils"

import {
  addWorkTaskAction,
  deleteWorkDishAction,
  deleteWorkTaskAction,
  setWorkDishOrderAction,
  setWorkTaskDoneAction,
  setWorkTaskOrderAction,
  updateWorkDishAction,
  updateWorkTaskAction,
} from "./actions"
import {
  dayDate,
  dayHeading,
  movedIds,
  type PrepDay,
  type WorkDish,
  type WorkTask,
} from "./work-sheet-data"

// The work sheet's controls (story 4.9): a task's check-item, the forms and
// the bottom-sheets of a dish and a task. Every write locks its control
// until the refreshed sheet arrives (no optimistic update); a failure shows
// an inline-notice next to it.

const copy = adminCopy.work

function DaySelect({
  id,
  prepDays,
  value,
  onChange,
}: {
  id: string
  prepDays: readonly PrepDay[]
  value: number
  onChange: (value: number) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{copy.taskDay}</FieldLabel>
      <NativeSelect
        id={id}
        value={String(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-12 w-full text-base"
      >
        {prepDays.map((day) => (
          <NativeSelectOption key={day.offset} value={String(day.offset)}>
            {dayHeading(day)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  )
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

// check-item (DESIGN › check-item): a real checkbox with its label; the save
// is immediate and announced; a done task is struck through and muted. The
// pencil opens the task's sheet.
export function TaskItem({
  task,
  cellIds,
  prepDays,
}: {
  task: WorkTask
  cellIds: readonly string[]
  prepDays: readonly PrepDay[]
}) {
  const id = useId()
  const announce = useAnnounce()
  const { pending, error, run } = useWorkAction()
  const [open, setOpen] = useState(false)

  return (
    <li className="flex flex-col gap-1">
      <div className="flex min-h-11 items-start gap-2">
        <Checkbox
          id={`${id}-done`}
          checked={task.done}
          disabled={pending}
          aria-busy={pending || undefined}
          onCheckedChange={(value) => {
            const done = value === true
            run(
              () => setWorkTaskDoneAction({ taskId: task.id, done }),
              () =>
                announce(
                  done
                    ? copy.markedDone(task.body)
                    : copy.markedNotDone(task.body)
                )
            )
          }}
          className="mt-2.5 size-6 rounded-[4px] border-[1.5px] border-muted-foreground bg-card"
        />
        <label
          htmlFor={`${id}-done`}
          className={cn(
            "min-w-0 flex-1 py-2.5 text-base leading-normal break-words",
            task.done && "text-muted-foreground line-through"
          )}
        >
          <bdi>{task.body}</bdi>
        </label>
        <button
          type="button"
          aria-label={copy.editTask(task.body)}
          onClick={() => setOpen(true)}
          className="-me-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-muted print:hidden"
        >
          <PencilIcon aria-hidden strokeWidth={1.5} className="size-5" />
        </button>
      </div>
      <ErrorNotice code={error} />
      {open && (
        <TaskPanel
          task={task}
          cellIds={cellIds}
          prepDays={prepDays}
          onClose={() => setOpen(false)}
        />
      )}
    </li>
  )
}

function TaskPanel({
  task,
  cellIds,
  prepDays,
  onClose,
}: {
  task: WorkTask
  cellIds: readonly string[]
  prepDays: readonly PrepDay[]
  onClose: () => void
}) {
  const id = useId()
  const announce = useAnnounce()
  const { pending, error, run } = useWorkAction()
  const [body, setBody] = useState(task.body)
  const [day, setDay] = useState(task.dayOffset)
  const [key, setKey] = useState(newIdempotencyKey)
  const [deleteKey] = useState(newIdempotencyKey)
  const index = cellIds.indexOf(task.id)

  return (
    <WorkPanel
      open
      onOpenChange={(next) => !next && onClose()}
      busy={pending}
      title={copy.taskSheet}
    >
      <TextForm
        id={`${id}-body`}
        label={copy.taskBody}
        value={body}
        onChange={setBody}
        submitLabel={copy.save}
        pending={pending}
        onSubmit={() =>
          run(
            () =>
              updateWorkTaskAction({
                taskId: task.id,
                body,
                dayOffset: day,
                idempotencyKey: key,
              }),
            () => {
              setKey(newIdempotencyKey())
              onClose()
            }
          )
        }
      >
        <DaySelect
          id={`${id}-day`}
          prepDays={prepDays}
          value={day}
          onChange={setDay}
        />
      </TextForm>
      <MoveButtons
        canUp={index > 0}
        canDown={index >= 0 && index < cellIds.length - 1}
        pending={pending}
        onMove={(delta) => {
          const ids = movedIds(cellIds, task.id, delta)
          if (!ids) return
          run(
            () => setWorkTaskOrderAction({ ids }),
            () =>
              announce(
                copy.moved(task.body, ids.indexOf(task.id) + 1, ids.length)
              )
          )
        }}
      />
      <DeleteStep
        label={copy.deleteTask}
        question={`${copy.deleteTask}?`}
        pending={pending}
        onDelete={() =>
          run(
            () =>
              deleteWorkTaskAction({
                taskId: task.id,
                idempotencyKey: deleteKey,
              }),
            onClose
          )
        }
      />
      <ErrorNotice code={error} />
    </WorkPanel>
  )
}

// "+ משימה": opens a short form in place. A successful add closes it and
// returns focus to the opener; the next task starts with "+ משימה" again
// (user decision 2026-10-07, phone check). "ביטול" closes it without
// adding. With a fixed day (a
// table cell) it adds to that day. Otherwise (the one at the end of a dish
// card) the day is a one-tap radio choice of the sheet's days: the day last
// used in this card, else the session day, else the last prep day.
export function AddTask({
  dishId,
  prepDays,
  day,
}: {
  dishId: string
  prepDays: readonly PrepDay[]
  day?: PrepDay
}) {
  const id = useId()
  const { pending, error, run, clearError } = useWorkAction()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState("")
  const [offset, setOffset] = useState<number>(0)
  // The chosen day, or the last prep day when it is not (or no longer) on
  // the sheet.
  const effectiveOffset = prepDays.some((d) => d.offset === offset)
    ? offset
    : (prepDays[prepDays.length - 1]?.offset ?? 0)
  const [key, setKey] = useState(newIdempotencyKey)
  const inputRef = useRef<HTMLInputElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)
  // Focus goes back to "+ משימה" once the closed form has been replaced.
  const refocus = useRef(false)
  useEffect(() => {
    if (open || !refocus.current) return
    refocus.current = false
    openerRef.current?.focus()
  }, [open])

  if (!open) {
    return (
      <button
        ref={openerRef}
        type="button"
        aria-label={day ? copy.addTaskFor(dayHeading(day)) : undefined}
        onClick={() => {
          setOpen(true)
          queueMicrotask(() => inputRef.current?.focus())
        }}
        className={
          day
            ? cn(TEXT_BUTTON, "self-start print:hidden")
            : "inline-flex min-h-11 w-full items-center justify-center rounded-[4px] bg-muted px-4 text-[15px] font-semibold text-foreground hover:bg-border print:hidden"
        }
      >
        {copy.addTask}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted px-3 py-3 print:hidden">
      <TextForm
        id={`${id}-body`}
        label={day ? copy.addTaskFor(dayHeading(day)) : copy.taskBody}
        value={body}
        onChange={setBody}
        submitLabel={copy.add}
        pending={pending}
        inputRef={inputRef}
        onSubmit={() =>
          run(
            () =>
              addWorkTaskAction({
                dishId,
                dayOffset: day?.offset ?? effectiveOffset,
                body,
                idempotencyKey: key,
              }),
            () => {
              setBody("")
              setKey(newIdempotencyKey())
              setOpen(false)
              refocus.current = true
            }
          )
        }
      >
        {!day && (
          <RadioCardGroup
            legend={copy.taskDay}
            name={`${id}-day`}
            options={prepDays.map((d) => ({
              value: String(d.offset),
              label: dayDate(d),
            }))}
            value={String(effectiveOffset)}
            onChange={(value) => setOffset(Number(value))}
          />
        )}
      </TextForm>
      <ErrorNotice code={error} />
      <button
        type="button"
        className={cn(TEXT_BUTTON, "self-start")}
        disabled={pending}
        onClick={() => {
          setOpen(false)
          setBody("")
          clearError()
          refocus.current = true
        }}
      >
        {copy.cancel}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Dishes
// ---------------------------------------------------------------------------

// "עריכה" of a dish: its own button (outside the task list) that opens the
// dish's sheet: rename, up and down, delete.
export function DishEditButton({
  dish,
  dishIds,
}: {
  dish: WorkDish
  dishIds: readonly string[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label={copy.editDish(dish.name)}
        onClick={() => setOpen(true)}
        className={cn(TEXT_BUTTON, "shrink-0 print:hidden")}
      >
        {copy.edit}
      </button>
      {open && (
        <DishPanel
          dish={dish}
          dishIds={dishIds}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function DishPanel({
  dish,
  dishIds,
  onClose,
}: {
  dish: WorkDish
  dishIds: readonly string[]
  onClose: () => void
}) {
  const id = useId()
  const announce = useAnnounce()
  const { pending, error, run } = useWorkAction()
  const [name, setName] = useState(dish.name)
  const [key, setKey] = useState(newIdempotencyKey)
  const [deleteKey] = useState(newIdempotencyKey)
  const index = dishIds.indexOf(dish.id)

  return (
    <WorkPanel
      open
      onOpenChange={(next) => !next && onClose()}
      busy={pending}
      title={<bdi>{dish.name}</bdi>}
    >
      <TextForm
        id={`${id}-name`}
        label={copy.dishName}
        value={name}
        onChange={setName}
        submitLabel={copy.save}
        pending={pending}
        onSubmit={() =>
          run(
            () =>
              updateWorkDishAction({
                dishId: dish.id,
                name,
                idempotencyKey: key,
              }),
            () => {
              setKey(newIdempotencyKey())
              onClose()
            }
          )
        }
      />
      <MoveButtons
        canUp={index > 0}
        canDown={index >= 0 && index < dishIds.length - 1}
        pending={pending}
        onMove={(delta) => {
          const ids = movedIds(dishIds, dish.id, delta)
          if (!ids) return
          run(
            () => setWorkDishOrderAction({ ids }),
            () =>
              announce(
                copy.moved(dish.name, ids.indexOf(dish.id) + 1, ids.length)
              )
          )
        }}
      />
      <DeleteStep
        label={copy.deleteDish}
        question={copy.deleteDishConfirm(dish.tasks.length)}
        pending={pending}
        onDelete={() =>
          run(
            () =>
              deleteWorkDishAction({
                dishId: dish.id,
                idempotencyKey: deleteKey,
              }),
            onClose
          )
        }
      />
      <ErrorNotice code={error} />
    </WorkPanel>
  )
}
