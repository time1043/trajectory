import type { TrajectoryRow } from '@/app/derive'
import type { Trajectory } from '@/domain/model/trajectory'

import { buildTurns } from '@/domain/services/turn-builder'

/**
 * The session filter: four dimensions (q, sources, date window), all owned by
 * the /sessions search params — this module is the pure application and
 * serialization layer, so the URL stays the single source of truth and the
 * sidebar/list/grid compose on top of it.
 *
 * SessionSearch is the raw URL shape (validateSearch is an identity-ish
 * passthrough); applySessionFilters parses the sources dimension internally.
 */

export interface SessionSearch {
  q?: string
  /** Raw param: comma-joined source keys, 'provider/user,provider/user' */
  sources?: string
  from?: string
  to?: string
}

const DAY_MS = 86_400_000

/** The filter key of one source — colon-free so URLs never need encoding */
export function sourceKey(provider: string, user: string): string {
  return `${provider}/${user}`
}

/** Accepts the raw search-param value ('a/b,c/d', repeated keys, junk) */
export function parseSourcesParam(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value.join(',') : value
  if (typeof raw !== 'string') return undefined
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length ? list : undefined
}

/** Undefined when empty — the param disappears from the URL instead of 'sources=' */
export function stringifySourcesParam(sources: string[] | undefined): string | undefined {
  return sources?.length ? sources.join(',') : undefined
}

/** Sidebar-style toggle: add when absent, remove the specific one when present */
export function toggleSource(sources: string[] | undefined, key: string): string[] {
  const current = sources ?? []
  return current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
}

export interface FilterableRow {
  row: TrajectoryRow
  text: string
}

/** Apply all dimensions in a stable order: sources -> q -> date window */
export function applySessionFilters(
  items: readonly FilterableRow[],
  search: SessionSearch,
  trajectories: ReadonlyMap<string, Trajectory>,
): TrajectoryRow[] {
  let result = items

  const sourceKeys = parseSourcesParam(search.sources)
  if (sourceKeys?.length) {
    const keys = new Set(sourceKeys)
    result = result.filter((i) => keys.has(sourceKey(i.row.provider, i.row.user)))
  }

  const needle = search.q?.trim().toLowerCase()
  if (needle) result = result.filter((i) => i.text.toLowerCase().includes(needle))

  if (search.from || search.to) {
    const fromMs = search.from ? Date.parse(search.from) : Number.NEGATIVE_INFINITY
    const toMs = search.to ? Date.parse(search.to) + DAY_MS - 1 : Number.POSITIVE_INFINITY
    result = result.filter((item) => {
      const t = trajectories.get(item.row.id)
      if (!t) return false
      // any turn activity inside the window counts (heatmap accounting)
      return buildTurns(t).some((turn) => {
        const at = t.nodes.get(turn.inputNodeIds[0])?.at ?? t.startedAt
        return at >= fromMs && at <= toMs
      })
    })
  }

  return result.map((i) => i.row)
}
