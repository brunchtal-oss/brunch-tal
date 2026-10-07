// Pure helpers of the testimonial carousel (components/public/
// testimonial-carousel.tsx), so its logic is tested without a DOM.

export type Edges = { left: number; right: number }

// The x of an element's centre on screen.
export function center(rect: Edges): number {
  return (rect.left + rect.right) / 2
}

// Which item is closest to the track's centre (`trackCenter`, an x on
// screen), by the items' on-screen rects. The current item is centred, so
// this is the same in RTL and LTR and never depends on the sign of
// scrollLeft. -1 when there are none.
export function nearestIndex(
  trackCenter: number,
  items: readonly Edges[]
): number {
  let best = -1
  let bestDistance = Infinity
  items.forEach((rect, index) => {
    const distance = Math.abs(center(rect) - trackCenter)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}

// An index kept within [0, count - 1] (0 when there are no items).
export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(Math.max(index, 0), count - 1)
}
