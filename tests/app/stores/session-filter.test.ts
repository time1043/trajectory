import { describe, expect, it } from 'vitest'

import type { TrajectoryRow } from '@/app/derive'

import {
  applySessionFilters,
  parseListParam,
  sourceKey,
  stringifyListParam,
  toggleSource,
} from '@/app/stores/session-filter'

function row(
  provider: string,
  user: string,
  sessionId: string,
  title: string,
  turnStarts: number[] = [],
): TrajectoryRow {
  return {
    id: `${provider}:${user}:${sessionId}`,
    sourceId: `${provider}:${user}`,
    provider,
    user,
    sessionId,
    title,
    startedAt: turnStarts[0] ?? 0,
    updatedAt: turnStarts[turnStarts.length - 1] ?? 0,
    turnCount: turnStarts.length,
    turnStarts,
    primaryTopic: 'other',
  }
}

function items(...rows: TrajectoryRow[]) {
  return rows.map((row) => ({ row, text: `${row.title}\nprompt of ${row.sessionId}` }))
}

const deepl = row('deepseek', '1665434994-qq', 'c1', 'deepseek session')
const claude = row('claude-code', 'oswin-m4a', 'a1', 'claude session')
const zcode = row('zcode', 'oswin-m4a', 'z1', 'zcode session')
const all = items(deepl, claude, zcode)

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

  it('keys sources by provider/user', () => {
    expect(sourceKey('claude-code', 'oswin-m4a')).toBe('claude-code/oswin-m4a')
  })
})

describe('applySessionFilters', () => {
  it('filters by one or many source keys', () => {
    expect(applySessionFilters(all, { sources: 'claude-code/oswin-m4a' })).toEqual([claude])
    expect(applySessionFilters(all, { sources: 'claude-code/oswin-m4a,zcode/oswin-m4a' })).toEqual([
      claude,
      zcode,
    ])
  })

  it('filters by q across title and prompt', () => {
    expect(applySessionFilters(all, { q: 'PROMPT OF a1' })).toEqual([claude])
  })

  it('narrows by tags with AND semantics', () => {
    const tagsBySession = new Map([
      [claude.id, ['react', 'ddd']],
      [zcode.id, ['react']],
    ])
    expect(applySessionFilters(all, { tags: 'react' }, tagsBySession)).toEqual([claude, zcode])
    expect(applySessionFilters(all, { tags: 'react,ddd' }, tagsBySession)).toEqual([claude])
    expect(applySessionFilters(all, { tags: 'nonexistent' }, tagsBySession)).toEqual([])
  })

  it('combines dimensions', () => {
    const tagsBySession = new Map([
      [zcode.id, ['zcode-tag']],
      [claude.id, ['zcode-tag']],
    ])
    expect(
      applySessionFilters(
        all,
        { sources: 'claude-code/oswin-m4a,zcode/oswin-m4a', tags: 'zcode-tag' },
        tagsBySession,
      ),
    ).toEqual([claude, zcode])
    expect(
      applySessionFilters(
        all,
        { sources: 'deepseek/1665434994-qq', tags: 'zcode-tag' },
        tagsBySession,
      ),
    ).toEqual([])
  })

  it('matches date windows by turn activity', () => {
    // anchor the turn at UTC noon so the window is timezone-independent
    const day = new Date()
    day.setUTCHours(12, 0, 0, 0)
    const dayStr = day.toISOString().slice(0, 10)
    const inside = row('deepseek', '1665434994-qq', 'inside', 'inside window', [day.getTime()])
    const outside = row('deepseek', '1665434994-qq', 'outside', 'outside window', [
      day.getTime() - 400 * 86_400_000,
    ])
    const result = applySessionFilters(items(inside, outside), { from: dayStr, to: dayStr })
    expect(result.map((r) => r.sessionId)).toEqual(['inside'])
  })
})
