import { useNavigate } from '@tanstack/react-router'
import { useAtom, useAtomValue } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { PaletteItem } from '@/app/stores/palette'

import { paletteIndexAtom, paletteOpenAtom, scorePaletteItem } from '@/app/stores/palette'
import EmptyState from '@/components/empty-state'
import { IconSearch } from '@/components/icons'
import Kbd from '@/components/kbd'
import ProviderDot from '@/components/provider-dot'

const MAX_RESULTS = 12

export default function CommandPalette() {
  const [open, setOpen] = useAtom(paletteOpenAtom)
  const paletteIndex = useAtomValue(paletteIndexAtom)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // adjust state during render (React-recommended, compiler-friendly): reset on open
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setQuery('')
      setSelected(0)
    }
  }
  const [prevQuery, setPrevQuery] = useState(query)
  if (query !== prevQuery) {
    setPrevQuery(query)
    setSelected(0)
  }

  const results = useMemo(() => {
    const scored = paletteIndex
      .map((item) => ({ item, score: scorePaletteItem(item, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.item.row.updatedAt - a.item.row.updatedAt)
    return scored.slice(0, MAX_RESULTS).map((entry) => entry.item)
  }, [paletteIndex, query])

  // DOM focus is external-system sync, so an effect is fine here
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  if (!open) return null

  const openItem = (item: PaletteItem) => {
    setOpen(false)
    void navigate({
      to: '/sessions/$source/$user/$session',
      params: { source: item.row.provider, user: item.row.user, session: item.row.sessionId },
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh] backdrop-blur-[2px]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-[560px] max-w-[90vw] overflow-hidden rounded-md border border-line bg-panel shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <IconSearch className="size-4 shrink-0 text-low" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelected((s) => Math.min(s + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelected((s) => Math.max(s - 1, 0))
              } else if (e.key === 'Enter' && results[selected]) {
                openItem(results[selected])
              } else if (e.key === 'Escape') {
                setOpen(false)
              }
            }}
            placeholder="Search sessions (title + first prompt)…"
            className="w-full bg-transparent text-sm text-hi outline-none placeholder:text-faint"
          />
          <Kbd>esc</Kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 ? (
            <EmptyState>{query ? '{ 0 matches }' : '{ nothing here yet }'}</EmptyState>
          ) : (
            results.map((item, i) => (
              <button
                key={item.row.id}
                type="button"
                onClick={() => openItem(item)}
                onMouseEnter={() => setSelected(i)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-150 ${
                  i === selected ? 'bg-elevated' : ''
                }`}
              >
                <ProviderDot sourceId={item.row.sourceId} />
                <span className="min-w-0 flex-1 truncate text-sm text-hi">{item.row.title}</span>
                <span className="shrink-0 font-mono text-xs text-low">
                  {new Date(item.row.updatedAt).toLocaleDateString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                  })}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

/** Sidebar search button, equivalent to ⌘K */
export function PaletteTrigger() {
  const [, setOpen] = useAtom(paletteOpenAtom)
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex w-full items-center gap-2 rounded-sm border border-line px-2.5 py-1.5 text-left text-low transition-colors duration-200 hover:border-line-strong hover:text-mid"
    >
      <IconSearch className="size-3.5" />
      <span className="flex-1 text-xs">Search…</span>
      <Kbd>⌘K</Kbd>
    </button>
  )
}
