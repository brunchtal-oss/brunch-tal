"use client"

import { useId, useState } from "react"
import { PencilIcon } from "lucide-react"

import { whatsappShareHref } from "@/components/admin/link-share"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { adminCopy } from "@/lib/copy/admin"
import { newIdempotencyKey } from "@/lib/idempotency"
import { cn } from "@/lib/utils"

import {
  addShoppingItemsAction,
  deleteShoppingItemAction,
  setShoppingItemBoughtAction,
  setShoppingItemOrderAction,
  updateShoppingItemAction,
} from "./actions"
import { shoppingMessage, whatsappBlockedReason } from "./shopping-message"
import { useAnnounce, useWorkAction } from "./use-work-action"
import {
  DeleteStep,
  ErrorNotice,
  MoveButtons,
  TextForm,
  WorkPanel,
} from "./work-parts"
import {
  itemLines,
  itemLinesProblem,
  movedIds,
  type ShoppingItem,
} from "./work-sheet-data"

// "רשימת קניות" of the work sheet (story 4.10; EXPERIENCE › דף עבודה): a
// check-item per item (a real checkbox, saved at once and announced; a
// bought item stays in its place, struck through), "+ פריט" (a window with
// one text box, an item per line, all added in one call; round 2: no
// quantity, an existing one is kept and shown), the pencil's sheet (edit,
// up and down, delete), and "שליחת הרשימה בוואטסאפ" with the items not
// bought yet. No optimistic update: every control stays locked until the
// refreshed sheet arrives. ShoppingPrint is the printed list.

const copy = adminCopy.work

export function ShoppingList({
  eventId,
  conceptName,
  startsAt,
  items,
}: {
  eventId: string
  conceptName: string
  startsAt: string
  items: readonly ShoppingItem[]
}) {
  const ids = items.map((item) => item.id)
  return (
    <section
      aria-labelledby="work-shopping"
      className="flex flex-col gap-3 print:hidden"
    >
      <h2
        id="work-shopping"
        className="font-heading text-[22px] leading-[1.25] font-light"
      >
        {copy.shopping}
      </h2>
      {items.length === 0 ? (
        <p className="text-base text-muted-foreground">{copy.noShopping}</p>
      ) : (
        <ul className="flex flex-col border-t border-border">
          {items.map((item) => (
            <ShoppingRow key={item.id} item={item} ids={ids} />
          ))}
        </ul>
      )}
      <AddItems eventId={eventId} />
      <WhatsappButton
        conceptName={conceptName}
        startsAt={startsAt}
        items={items}
      />
    </section>
  )
}

// The printed list (DESIGN › worksheet-print): a box per item, a bought one
// struck through. Not printed when the list is empty.
export function ShoppingPrint({ items }: { items: readonly ShoppingItem[] }) {
  if (items.length === 0) return null
  return (
    <section
      data-work-sheet-print=""
      className="hidden break-inside-avoid flex-col gap-1 text-[12px] print:flex"
    >
      <h2 className="text-[15px] font-semibold">{copy.shopping}</h2>
      <ul className="columns-2 gap-6">
        {items.map((item) => (
          <li key={item.id} className={item.bought ? "line-through" : ""}>
            <span aria-hidden>{item.bought ? "☑ " : "☐ "}</span>
            <bdi>{copy.itemLine(item.body, item.quantity)}</bdi>
          </li>
        ))}
      </ul>
    </section>
  )
}

// check-item (DESIGN › check-item) with the pencil that opens the item's
// sheet.
function ShoppingRow({
  item,
  ids,
}: {
  item: ShoppingItem
  ids: readonly string[]
}) {
  const id = useId()
  const announce = useAnnounce()
  const { pending, error, run } = useWorkAction()
  const [open, setOpen] = useState(false)
  const line = copy.itemLine(item.body, item.quantity)

  return (
    <li className="flex flex-col gap-1 border-b border-border">
      <div className="flex min-h-11 items-start gap-2">
        <Checkbox
          id={`${id}-bought`}
          checked={item.bought}
          disabled={pending}
          aria-busy={pending || undefined}
          onCheckedChange={(value) => {
            const bought = value === true
            run(
              () => setShoppingItemBoughtAction({ itemId: item.id, bought }),
              () =>
                announce(
                  bought
                    ? copy.markedBought(item.body)
                    : copy.markedNotBought(item.body)
                )
            )
          }}
          className="mt-2.5 size-6 rounded-[4px] border-[1.5px] border-muted-foreground bg-card"
        />
        <label
          htmlFor={`${id}-bought`}
          className={cn(
            "min-w-0 flex-1 py-2.5 text-base leading-normal break-words",
            item.bought && "text-muted-foreground line-through"
          )}
        >
          <bdi>{line}</bdi>
        </label>
        <button
          type="button"
          aria-label={copy.editItem(item.body)}
          disabled={pending}
          onClick={() => setOpen(true)}
          className="-me-2.5 inline-flex size-11 shrink-0 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <PencilIcon aria-hidden strokeWidth={1.5} className="size-5" />
        </button>
      </div>
      <ErrorNotice code={error} />
      {open && (
        <ItemPanel item={item} ids={ids} onClose={() => setOpen(false)} />
      )}
    </li>
  )
}

// The item's sheet: its text (no quantity field; an existing quantity is
// sent back unchanged), up and down, delete.
function ItemPanel({
  item,
  ids,
  onClose,
}: {
  item: ShoppingItem
  ids: readonly string[]
  onClose: () => void
}) {
  const id = useId()
  const announce = useAnnounce()
  const { pending, error, run } = useWorkAction()
  const [body, setBody] = useState(item.body)
  const [key, setKey] = useState(newIdempotencyKey)
  const [deleteKey] = useState(newIdempotencyKey)
  const index = ids.indexOf(item.id)

  return (
    <WorkPanel
      open
      onOpenChange={(next) => !next && onClose()}
      busy={pending}
      title={<bdi>{copy.itemSheet(item.body)}</bdi>}
    >
      <TextForm
        id={`${id}-body`}
        label={copy.itemBody}
        value={body}
        onChange={(value) => {
          setBody(value)
          setKey(newIdempotencyKey())
        }}
        submitLabel={copy.save}
        pending={pending}
        onSubmit={() =>
          run(
            () =>
              updateShoppingItemAction({
                itemId: item.id,
                body,
                quantity: item.quantity ?? "",
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
        canDown={index >= 0 && index < ids.length - 1}
        pending={pending}
        onMove={(delta) => {
          const next = movedIds(ids, item.id, delta)
          if (!next) return
          run(
            () => setShoppingItemOrderAction({ ids: next }),
            () =>
              announce(
                copy.moved(item.body, next.indexOf(item.id) + 1, next.length)
              )
          )
        }}
      />
      <DeleteStep
        label={copy.deleteItem}
        question={copy.deleteItemNamed(item.body)}
        pending={pending}
        onDelete={() =>
          run(
            () =>
              deleteShoppingItemAction({
                itemId: item.id,
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

// "+ פריט": a window with one text box; every line (Enter) is an item,
// empty lines do not count, and "הוספה" adds them all at the end of the list
// in one call (admin_add_shopping_items).
function AddItems({ eventId }: { eventId: string }) {
  const { pending, error, run, clearError } = useWorkAction()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 w-full items-center justify-center rounded-[4px] bg-muted px-4 text-[15px] font-semibold text-foreground hover:bg-border"
      >
        {copy.addItem}
      </button>
      <WorkPanel
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) clearError()
        }}
        busy={pending}
        title={copy.addItemsTitle}
      >
        <AddItemsForm
          eventId={eventId}
          pending={pending}
          run={run}
          onAdded={() => setOpen(false)}
        />
        <ErrorNotice code={error} />
      </WorkPanel>
    </>
  )
}

// The window's form: the text box, its hint, and the problem (too many
// lines, a line too long, or nothing written once "הוספה" was pressed) as an
// alert under it. "הוספה" while blocked shows the problem and sends nothing.
export function AddItemsForm({
  eventId,
  pending,
  run,
  onAdded,
  initialText = "",
  initialTried = false,
}: {
  eventId: string
  pending: boolean
  run: ReturnType<typeof useWorkAction>["run"]
  onAdded: () => void
  // For the screen tests (a filled or tried state); the screen starts empty.
  initialText?: string
  initialTried?: boolean
}) {
  const id = useId()
  const announce = useAnnounce()
  const [text, setText] = useState(initialText)
  const [tried, setTried] = useState(initialTried)
  const [key, setKey] = useState(newIdempotencyKey)
  const lines = itemLines(text)
  const problem =
    itemLinesProblem(lines) ??
    (tried && lines.length === 0 ? copy.itemsProblemEmpty : null)
  const blocked = lines.length === 0 || problem !== null

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (pending) return
        if (blocked) {
          setTried(true)
          return
        }
        run(
          () =>
            addShoppingItemsAction({
              eventId,
              bodies: lines,
              idempotencyKey: key,
            }),
          () => {
            announce(copy.itemsAdded(lines.length))
            setText("")
            setTried(false)
            setKey(newIdempotencyKey())
            onAdded()
          }
        )
      }}
    >
      <Field>
        <FieldLabel htmlFor={`${id}-lines`}>{copy.itemLines}</FieldLabel>
        <Textarea
          id={`${id}-lines`}
          value={text}
          rows={6}
          autoComplete="off"
          aria-describedby={`${id}-hint ${id}-problem`}
          aria-invalid={problem !== null || undefined}
          onChange={(event) => {
            setText(event.target.value)
            setKey(newIdempotencyKey())
          }}
          className="min-h-36 text-base md:text-base"
        />
        <FieldDescription id={`${id}-hint`} className="text-[15px]">
          {copy.itemLinesHint}
        </FieldDescription>
        {/* Always in the page, so a new problem is announced. */}
        <p
          id={`${id}-problem`}
          role="alert"
          className="text-[15px] font-semibold text-error empty:hidden"
        >
          {problem}
        </p>
      </Field>
      <Button
        type="submit"
        size="lg"
        aria-busy={pending || undefined}
        aria-disabled={pending || blocked || undefined}
        className="h-12 rounded-[4px] text-base font-semibold"
      >
        {pending && <Spinner aria-hidden />}
        {copy.add}
      </Button>
    </form>
  )
}

// "שליחת הרשימה בוואטסאפ": wa.me/?text= without a number (Tal picks whom),
// built here from the sheet's data (AD-16). With nothing to send the link
// has no href, is aria-disabled, and the reason is shown next to it.
function WhatsappButton({
  conceptName,
  startsAt,
  items,
}: {
  conceptName: string
  startsAt: string
  items: readonly ShoppingItem[]
}) {
  const reasonId = useId()
  const reason = whatsappBlockedReason(items)
  const look =
    "inline-flex h-12 w-full items-center justify-center rounded-[4px] bg-success px-6 text-base font-semibold text-primary-foreground"

  if (reason !== null) {
    return (
      <div className="flex flex-col gap-1">
        <a
          role="link"
          tabIndex={0}
          aria-disabled="true"
          aria-describedby={reasonId}
          className={cn(look, "cursor-not-allowed opacity-50")}
        >
          {copy.sendWhatsapp}
        </a>
        <p id={reasonId} className="text-[15px] text-muted-foreground">
          {reason}
        </p>
      </div>
    )
  }

  return (
    <a
      // Not null: whatsappBlockedReason is null only when there is an item
      // to send.
      href={whatsappShareHref(
        shoppingMessage(conceptName, startsAt, items) ?? ""
      )}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(look, "hover:bg-success/90")}
    >
      {copy.sendWhatsapp}
    </a>
  )
}
