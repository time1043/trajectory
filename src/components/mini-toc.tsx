import { useEffect, useState } from 'react'

export interface MiniTocEntry {
  /** DOM id of the scroll target */
  id: string
  label: string
}

/**
 * Scrollspy minimap pinned to the right viewport edge. Collapsed: one dash per
 * entry, the active one accented. Hover: expands to labeled rows. Click:
 * smooth-scrolls the entry into view. The scroll container is auto-detected
 * from the first target (works for window scroll and inner panes alike).
 */
export default function MiniToc({
  entries,
  minCount = 5,
}: {
  entries: readonly MiniTocEntry[]
  minCount?: number
}) {
  const [activeId, setActiveId] = useState<string | null>(entries[0]?.id ?? null)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (!entries.length) return

    // climb from the first target to its scrollable ancestor, else the window
    let scroller: HTMLElement | Window = window
    const first = document.getElementById(entries[0].id)
    let node = first?.parentElement
    while (node) {
      const style = getComputedStyle(node)
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) {
        scroller = node
        break
      }
      node = node.parentElement
    }

    const update = () => {
      // the active entry is the last one whose top is above the reading line
      let current = entries[0]?.id ?? null
      for (const entry of entries) {
        const el = document.getElementById(entry.id)
        if (el && el.getBoundingClientRect().top <= 160) current = entry.id
      }
      setActiveId(current)
    }

    update()
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [entries])

  if (entries.length < minCount) return null

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div
      className="fixed top-1/2 right-0 z-30 hidden -translate-y-1/2 xl:block"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered ? (
        <div className="max-h-[70vh] w-72 overflow-y-auto border border-line bg-panel py-2 shadow-lg">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => scrollTo(entry.id)}
              className={`flex w-full items-center border-l-2 px-3 py-1.5 text-left text-xs transition-colors duration-150 ${
                activeId === entry.id
                  ? 'border-accent text-hi'
                  : 'border-transparent text-mid hover:text-hi'
              }`}
            >
              <span className="truncate">{entry.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-end gap-2 pr-2">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-label={entry.label}
              onClick={() => scrollTo(entry.id)}
              className={`h-0.5 rounded-full transition-all duration-150 ${
                activeId === entry.id ? 'w-5 bg-accent' : 'w-3.5 bg-faint hover:bg-low'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
