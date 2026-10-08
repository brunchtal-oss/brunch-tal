import { TaskRow } from "@/components/admin/task-row"
import { adminCopy } from "@/lib/copy/admin"

import {
  HOME_ATTENTION_LIMIT,
  toAttentionItems,
  type AttentionItem,
} from "../home-items"
import { CubeCounter, HomeLink, HomeSection, cubeRows } from "./home-section"
import { loadAttentionItems } from "./load-home"

const copy = adminCopy.home

// "לטיפול" on the home (story 4.1, AD-22): admin_get_attention_items is the
// only source, newest first. A cube with a saffron counter pill (design
// round 2026-10-07) and "{n} דברים מחכים לך" count
// every item; only the three newest are listed, and with more,
// "לכל הדברים לטיפול ({n})" leads to /admin/attention (user decision
// 2026-10-06). Empty: one line, no counter.
export async function AttentionList() {
  const items = toAttentionItems(await loadAttentionItems())

  return (
    <HomeSection
      id="home-attention"
      title={copy.attention}
      aside={items.length > 0 ? <CubeCounter count={items.length} /> : null}
    >
      <AttentionRows items={items} limit={HOME_ATTENTION_LIMIT} inCube />
      {items.length > HOME_ATTENTION_LIMIT && (
        <HomeLink href="/admin/attention">
          {copy.attentionAll(items.length)}
        </HomeLink>
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
  inCube = false,
}: {
  items: AttentionItem[]
  limit?: number
  // On the home the rows sit in a cube: no rule above the first or under
  // the last.
  inCube?: boolean
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
      <ul className={inCube ? cubeRows : "flex flex-col"}>
        {items.slice(0, limit ?? items.length).map(({ key, ...item }) => (
          <TaskRow key={key} {...item} />
        ))}
      </ul>
    </>
  )
}
