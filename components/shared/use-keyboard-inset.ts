import { useEffect, useState } from "react"

// The on-screen keyboard (fix 24). Android Chrome (resizes-visual, the
// default since Chrome 108) and iOS Safari shrink only the visual viewport
// when the keyboard opens: a fixed bottom sheet stays on the bottom of the
// layout viewport, so its lower part (the confirm button) sits under the
// keyboard. This measures the layout viewport's part hidden below the visual
// one, so a sheet can stand on the keyboard instead.

export type KeyboardInset = {
  // From the layout viewport's bottom to the visible area's bottom.
  bottom: number
  // The visible area's height.
  height: number
}

type Viewport = { height: number; offsetTop: number; scale: number }

// Less than this is a browser bar, not a keyboard.
const MIN_KEYBOARD = 100

export function keyboardInset(
  layoutHeight: number,
  viewport: Viewport
): KeyboardInset | null {
  // A pinch zoom also shrinks the visual viewport; that is not a keyboard.
  if (viewport.scale > 1.01) return null
  const bottom = Math.round(layoutHeight - viewport.height - viewport.offsetTop)
  if (bottom < MIN_KEYBOARD) return null
  return { bottom, height: Math.round(viewport.height) }
}

function sameInset(a: KeyboardInset | null, b: KeyboardInset | null) {
  return a?.bottom === b?.bottom && a?.height === b?.height
}

// The keyboard's inset while active (an open sheet), null when there is no
// keyboard or no visualViewport.
export function useKeyboardInset(active: boolean): KeyboardInset | null {
  const [inset, setInset] = useState<KeyboardInset | null>(null)

  useEffect(() => {
    const viewport =
      typeof window === "undefined" ? null : window.visualViewport
    if (!active || !viewport) return
    const measure = () => {
      // documentElement.clientHeight is the layout viewport (the initial
      // containing block), which the keyboard does not resize.
      const next = keyboardInset(
        document.documentElement.clientHeight,
        viewport
      )
      setInset((current) => (sameInset(current, next) ? current : next))
    }
    measure()
    viewport.addEventListener("resize", measure)
    viewport.addEventListener("scroll", measure)
    return () => {
      viewport.removeEventListener("resize", measure)
      viewport.removeEventListener("scroll", measure)
      setInset(null)
    }
  }, [active])

  return active ? inset : null
}
