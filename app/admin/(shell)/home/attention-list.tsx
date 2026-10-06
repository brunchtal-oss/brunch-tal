import { TaskRow } from "@/components/admin/task-row"
import { adminCopy } from "@/lib/copy/admin"

import {
  HOME_ATTENTION_LIMIT,
  toAttentionItems,
  type AttentionItem,
} from "../home-items"
import { HomeLink, HomeSection } from "./home-section"
import { loadAttentionItems } from "./load-home"

const copy = adminCopy.home

// "לטיפול" on the home (story 4.1, AD-22): admin_get_attention_items is the
// only source, newest first. A counter pill and "{n} דברים מחכים לך" count
// every item; only the three newest are listed, and with more,
// "לכל הדברים לטיפול ({n})" leads to /admin/attention (user decision
// 2026-10-06). Empty: one line, no counter.
export async function AttentionList() {
  const items = toAttentionItems(await loadAttentionItems())

  return (
    <HomeSection
      id="home-attention"
      title={copy.attention}
      aside={
        items.length > 0 ? (
          <span
            aria-hidden
            className="rounded-full bg-primary px-2.5 py-px text-[13px] font-semibold text-primary-foreground tabular-nums"
          >
            {items.length}
          </span>
        ) : null
      }
    >
      <AttentionRows items={items} limit={HOME_ATTENTION_LIMIT} />
      {items.length > HOME_ATTENTION_LIMIT && (
        <div>
          <HomeLink href="/admin/attention">
            {copy.attentionAll(items.length)}
          </HomeLink>
        </div>
      )}
    </HomeSection>
  )
}

// /admin/attention: every item, with the same count line and task-row.
export async function AllAttentionItems() {
  const items = toAttentionItems(await loadAttentionItems())
  return (
    <div className="flex flex-col gap-3">
      <AttentionRows items={items} />
    </div>
  )
}

// The count line and the task-rows (the home and /admin/attention).
export function AttentionRows({
  items,
  limit,
}: {
  items: AttentionItem[]
  limit?: number
}) {
  if (items.length === 0) {
    return (
      <p className="text-base text-muted-foreground">{copy.attentionEmpty}</p>
    )
  }
  return (
    <>
      <p className="text-[15px] text-muted-foreground">
        {copy.attentionCount(items.length)}
      </p>
      <ul className="flex flex-col">
        {items.slice(0, limit ?? items.length).map(({ key, ...item }) => (
          <TaskRow key={key} {...item} />
        ))}
      </ul>
    </>
  )
}
