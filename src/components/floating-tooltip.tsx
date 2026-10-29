import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Fixed-position tooltip rendered through a portal — never clipped by scroll
 * containers and always on top of the content stack. Anchored at a viewport
 * point; sits above it (flips below when there is no room) and is clamped to
 * the viewport edges.
 */
export default function FloatingTooltip({
  point,
  children,
}: {
  point: { x: number; y: number } | null
  children?: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    if (point && ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setSize({ w: rect.width, h: rect.height })
    }
  }, [point])

  if (!point) return null

  const margin = 8
  const left = Math.min(
    Math.max(point.x - size.w / 2, margin),
    Math.max(window.innerWidth - size.w - margin, margin),
  )
  const fitsAbove = point.y - size.h - 12 > margin
  const top = fitsAbove ? point.y - size.h - 10 : point.y + 14

  return createPortal(
    <div
      ref={ref}
      className="pointer-events-none fixed z-[70] rounded-md border border-line bg-panel px-2 py-1 font-mono text-xs whitespace-nowrap text-mid shadow-sm"
      style={{ left, top }}
    >
      {children}
    </div>,
    document.body,
  )
}
