import { Outlet, createFileRoute, useParams, useRouter } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'

import type { SessionSearch } from '@/app/stores/session-filter'

import { sourceMetasAtom } from '@/app/stores/data'
import { paletteOpenAtom } from '@/app/stores/palette'
import {
  parseListParam,
  sourceKey,
  stringifyListParam,
  toggleSource,
} from '@/app/stores/session-filter'
import { useSessionRows } from '@/app/stores/sessions'
import { withSuspense } from '@/components/loading'
import SessionList from '@/components/session-list'

export const Route = createFileRoute('/sessions')({
  // raw passthrough — session-filter.ts owns parsing
  validateSearch: (search: Record<string, unknown>): SessionSearch => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    sources: typeof search.sources === 'string' ? search.sources : undefined,
    tags: typeof search.tags === 'string' ? search.tags : undefined,
    from: typeof search.from === 'string' ? search.from : undefined,
    to: typeof search.to === 'string' ? search.to : undefined,
  }),
  component: withSuspense(SessionsLayout),
})

function SessionsLayout() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const { id } = useParams({ strict: false }) as { id?: string }
  const paletteOpen = useAtomValue(paletteOpenAtom)
  const rows = useSessionRows(search)
  const sourceMetas = useAtomValue(sourceMetasAtom)
  const activeSourceKeys = parseListParam(search.sources) ?? []
  const [query, setQuery] = useState(search.q ?? '')

  // debounced input -> URL (the truth). Must use history.replace to keep the
  // full pathname: a route-bound navigate targets the layout route and drops
  // the child route params.
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (search.sources) params.set('sources', search.sources)
      if (search.tags) params.set('tags', search.tags)
      if (search.from) params.set('from', search.from)
      if (search.to) params.set('to', search.to)
      const qs = params.toString()
      router.history.replace(`${window.location.pathname}${qs ? `?${qs}` : ''}`)
    }, 250)
    return () => clearTimeout(timer)
  }, [query, search.sources, search.tags, search.from, search.to, router])

  // external changes (heatmap jump, sidebar toggle) -> echo into the input;
  // render-phase adjust, no effect
  const [prevQ, setPrevQ] = useState(search.q)
  if (search.q !== prevQ) {
    setPrevQ(search.q)
    setQuery(search.q ?? '')
  }

  const removeSource = (key: string) => {
    void navigate({
      search: (prev: SessionSearch) => ({
        ...prev,
        sources: stringifyListParam(toggleSource(parseListParam(prev.sources), key)),
      }),
    })
  }

  // j/k moves across the filtered list; skip when the palette is open or typing
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (paletteOpen || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'j' && e.key !== 'k') return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return
      e.preventDefault()
      const idx = rows.findIndex((r) => r.id === id)
      let nextIdx: number
      if (e.key === 'j') nextIdx = idx < 0 ? 0 : Math.min(idx + 1, rows.length - 1)
      else if (idx <= 0) return
      else nextIdx = idx - 1
      const next = rows[nextIdx]
      if (next && next.id !== id)
        void navigate({
          to: '/sessions/$source/$user/$session',
          params: { source: next.provider, user: next.user, session: next.sessionId },
          search: (prev: SessionSearch) => prev,
        })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [rows, id, paletteOpen, navigate])

  const activeTagList = parseListParam(search.tags) ?? []
  const removeTag = (tag: string) => {
    void navigate({
      search: (prev: SessionSearch) => ({
        ...prev,
        tags: stringifyListParam((parseListParam(prev.tags) ?? []).filter((t) => t !== tag)),
      }),
    })
  }

  const filtering = !!(
    search.q ||
    search.sources ||
    activeTagList.length ||
    search.from ||
    search.to
  )

  return (
    <div className="flex h-screen">
      <div
        className={`w-80 shrink-0 flex-col border-r border-line ${id ? 'hidden md:flex' : 'flex'}`}
      >
        <div className="border-b border-line px-3 py-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && rows[0])
                void navigate({
                  to: '/sessions/$source/$user/$session',
                  params: {
                    source: rows[0].provider,
                    user: rows[0].user,
                    session: rows[0].sessionId,
                  },
                  search: (prev: SessionSearch) => prev,
                })
            }}
            placeholder="Search title & prompt…"
            className="w-full border-b border-line bg-transparent py-1.5 text-sm text-hi transition-colors duration-200 outline-none placeholder:text-faint focus:border-accent"
          />
          <div className="mt-2 flex items-center justify-between font-mono text-xs text-low">
            <span>{rows.length} conversations</span>
            {search.from && search.to && (
              <button
                type="button"
                onClick={() =>
                  void navigate({
                    search: (prev: SessionSearch) => ({ q: prev.q, sources: prev.sources }),
                  })
                }
                className="text-low transition-colors duration-200 hover:text-hi"
                title="Clear date filter"
              >
                {search.from} ~ {search.to} ×
              </button>
            )}
          </div>
          {(activeSourceKeys.length > 0 || activeTagList.length > 0) && (
            <div className="mt-2 flex flex-wrap gap-1">
              {activeSourceKeys.map((key) => {
                const meta = sourceMetas.find((m) => m.ok && sourceKey(m.provider, m.user) === key)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => removeSource(key)}
                    className="flex items-center gap-1 rounded-sm border border-line px-1.5 py-0.5 font-mono text-[11px] text-low transition-colors duration-200 hover:text-hi"
                    title="Remove source filter"
                  >
                    {meta?.label ?? key} ×
                  </button>
                )
              })}
              {activeTagList.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="flex items-center gap-1 rounded-sm border border-line bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] text-mid transition-colors duration-200 hover:text-hi"
                  title="Remove tag filter"
                >
                  <span className="text-accent">#</span>
                  {tag} ×
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="pt-8 text-center font-mono text-sm text-low select-none">
              {filtering ? '{ 0 matches }' : '{ no sessions }'}
            </div>
          ) : (
            <SessionList rows={rows} search={search} activeId={id} />
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
