import { Outlet, createFileRoute, useParams, useRouter } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import { Suspense, useEffect, useState } from 'react'

import Loading from '@/components/loading'
import SessionList from '@/components/session-list'
import { paletteOpenAtom } from '@/app/stores/ui'
import { useSessionRows, type SessionSearch } from '@/app/stores/sessions'

export const Route = createFileRoute('/sessions')({
  validateSearch: (search: Record<string, unknown>): SessionSearch => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    from: typeof search.from === 'string' ? search.from : undefined,
    to: typeof search.to === 'string' ? search.to : undefined,
  }),
  component: SessionsSuspense,
})

function SessionsLayout() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const { id } = useParams({ strict: false }) as { id?: string }
  const paletteOpen = useAtomValue(paletteOpenAtom)
  const rows = useSessionRows(search)
  const [query, setQuery] = useState(search.q ?? '')

  // 输入防抖 → URL（真源）。必须用 history.replace 保留完整 pathname：
  // route-bound navigate 会把布局路由当作目标，丢掉 /sessions/$id 子路由
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams()
      if (query.trim())
        params.set('q', query.trim())
      if (search.from)
        params.set('from', search.from)
      if (search.to)
        params.set('to', search.to)
      const qs = params.toString()
      router.history.replace(`${window.location.pathname}${qs ? `?${qs}` : ''}`)
    }, 250)
    return () => clearTimeout(timer)
  }, [query, search.from, search.to, router])

  // 外部变化（热力图跳转/返回）→ 输入框回显；render 期调整，不走 effect
  const [prevQ, setPrevQ] = useState(search.q)
  if (search.q !== prevQ) {
    setPrevQ(search.q)
    setQuery(search.q ?? '')
  }

  // j/k 在过滤列表上移动；palette 打开或输入时跳过
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (paletteOpen || e.metaKey || e.ctrlKey || e.altKey)
        return
      if (e.key !== 'j' && e.key !== 'k')
        return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return
      e.preventDefault()
      const idx = rows.findIndex(r => r.id === id)
      let nextIdx: number
      if (e.key === 'j')
        nextIdx = idx < 0 ? 0 : Math.min(idx + 1, rows.length - 1)
      else if (idx <= 0)
        return
      else
        nextIdx = idx - 1
      const next = rows[nextIdx]
      if (next && next.id !== id)
        void navigate({ to: '/sessions/$id', params: { id: next.id }, search: (prev: SessionSearch) => prev })
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [rows, id, paletteOpen, navigate])

  const filtering = !!(search.q || search.from || search.to)

  return (
    <div className="flex h-screen">
      <div className={`w-80 shrink-0 flex-col border-r border-line ${id ? 'hidden md:flex' : 'flex'}`}>
        <div className="border-b border-line px-3 py-3">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && rows[0])
                void navigate({ to: '/sessions/$id', params: { id: rows[0].id }, search: (prev: SessionSearch) => prev })
            }}
            placeholder="搜索标题与提问…"
            className="w-full border-b border-line bg-transparent py-1.5 text-sm text-hi outline-none transition-colors duration-200 placeholder:text-faint focus:border-accent"
          />
          <div className="mt-2 flex items-center justify-between font-mono text-xs text-low">
            <span>
              {rows.length}
              {' '}
              conversations
            </span>
            {search.from && search.to && (
              <button
                type="button"
                onClick={() => void navigate({ search: (prev: SessionSearch) => ({ q: prev.q }) })}
                className="text-low transition-colors duration-200 hover:text-hi"
                title="清除日期筛选"
              >
                {search.from} ~ {search.to} ×
              </button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.length === 0
            ? <div className="pt-8 text-center font-mono text-sm text-low select-none">{filtering ? '{ 0 matches }' : '{ no sessions }'}</div>
            : <SessionList rows={rows} search={search} activeId={id} />}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}

function SessionsSuspense() {
  // useSessionRows 依赖 async atom，必须在 Suspense 内求值
  return (
    <Suspense fallback={<Loading />}>
      <SessionsLayout />
    </Suspense>
  )
}
