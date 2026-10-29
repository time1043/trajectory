import { describe, expect, it } from 'vitest'

import type { TrajectoryRow } from '@/app/derive'
import type { Trajectory } from '@/domain/model/trajectory'

import {
  applySessionFilters,
  parseListParam,
  sourceKey,
  stringifyListParam,
  toggleSource,
} from '@/app/stores/session-filter'

import { makeTrajectory, text, at } from '../../fixtures'

function row(provider: string, user: string, sessionId: string, title: string): TrajectoryRow {
  return {
    id: `${provider}:${user}:${sessionId}`,
    sourceId: `${provider}:${user}`,
    provider,
    user,
    sessionId,
    title,
    startedAt: 0,
    updatedAt: 0,
    turnCount: 1,
    primaryTopic: 'other',
  }
}

function items(...rows: TrajectoryRow[]) {
  return rows.map((row) => ({ row, text: `${row.title}\nprompt of ${row.sessionId}` }))
}

const deepl = row('deepseek', '1665434994-qq', 'c1', 'deepseek session')
const claude = row('claude-code', 'oswin-m4a', 'a1', 'claude session')
const zcode = row('zcode', 'oswin-m4a', 'z1', 'zcode session')

describe('sources param serialization', () => {
  it('round-trips comma-joined keys', () => {
    const list = ['claude-code/oswin-m4a', 'deepseek/1665434994-qq']
    expect(parseListParam(stringifyListParam(list))).toEqual(list)
  })

  it('yields undefined for empty, absent and junk values', () => {
    expect(parseListParam(undefined)).toBeUndefined()
    expect(parseListParam('')).toBeUndefined()
    expect(parseListParam(',,')).toBeUndefined()
    expect(stringifyListParam([])).toBeUndefined()
  })

  it('tolerates repeated keys and arrays from hand-built urls', () => {
    expect(parseListParam(['a/b', 'c/d'])).toEqual(['a/b', 'c/d'])
    expect(parseListParam('a/b')).toEqual(['a/b'])
  })

  it('toggles without duplicates', () => {
    expect(toggleSource(undefined, 'a/b')).toEqual(['a/b'])
    expect(toggleSource(['a/b'], 'c/d')).toEqual(['a/b', 'c/d'])
    expect(toggleSource(['a/b', 'c/d'], 'a/b')).toEqual(['c/d'])
  })
})

describe('applySessionFilters', () => {
  const all = items(deepl, claude, zcode)
  const trajectories = new Map<string, Trajectory>()

  it('filters by one or many source keys', () => {
    expect(applySessionFilters(all, { sources: 'claude-code/oswin-m4a' }, trajectories)).toEqual([
      claude,
    ])
    expect(
      applySessionFilters(all, { sources: 'claude-code/oswin-m4a,zcode/oswin-m4a' }, trajectories),
    ).toEqual([claude, zcode])
  })

  it('filters by q across title and prompt', () => {
    expect(applySessionFilters(all, { q: 'PROMPT OF a1' }, trajectories)).toEqual([claude])
  })

  it('combines dimensions', () => {
    expect(
      applySessionFilters(
        all,
        { sources: 'claude-code/oswin-m4a,zcode/oswin-m4a', q: 'zcode' },
        trajectories,
      ),
    ).toEqual([zcode])
  })

  it('matches date windows by turn activity', () => {
    const inside = row('deepseek', '1665434994-qq', 'inside', 'inside window')
    const outside = row('deepseek', '1665434994-qq', 'outside', 'outside window')
    // two trajectories: one active on the window's day, one far past it
    const active = {
      ...makeTrajectory([{ id: 'u1', role: 'user', at: at(0), parent: null, parts: [text('q')] }]),
      id: inside.id,
    }
    const stale = {
      ...makeTrajectory([
        { id: 'u1', role: 'user', at: at(0) - 400 * 86_400_000, parent: null, parts: [text('q')] },
      ]),
      id: outside.id,
    }
    const from = new Date(at(0)).toISOString().slice(0, 10)
    const to = new Date(at(0) + 86_400_000).toISOString().slice(0, 10)
    const result = applySessionFilters(
      items(inside, outside),
      { from, to },
      new Map([
        [inside.id, active],
        [outside.id, stale],
      ]),
    )
    expect(result.map((r) => r.sessionId)).toEqual(['inside'])
  })

  it('keys sources by provider/user', () => {
    expect(sourceKey('claude-code', 'oswin-m4a')).toBe('claude-code/oswin-m4a')
  })

  it('narrows by tags with AND semantics', () => {
    const tagsBySession = new Map([
      [claude.id, ['react', 'ddd']],
      [zcode.id, ['react']],
    ])
    expect(applySessionFilters(all, { tags: 'react' }, trajectories, tagsBySession)).toEqual([
      claude,
      zcode,
    ])
    expect(applySessionFilters(all, { tags: 'react,ddd' }, trajectories, tagsBySession)).toEqual([
      claude,
    ])
    expect(applySessionFilters(all, { tags: 'nonexistent' }, trajectories, tagsBySession)).toEqual(
      [],
    )
  })
})
