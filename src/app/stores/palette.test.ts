import { describe, expect, it } from 'vitest'

import type { PaletteItem } from './palette'
import { scorePaletteItem } from './palette'
import type { TrajectoryRow } from '@/app/derive'

function item(title: string, text: string): PaletteItem {
  const row = { id: 't:1', sourceId: 't', title, startedAt: 0, updatedAt: 0, turnCount: 1, msgCount: 1, primaryTopic: 'other' } as TrajectoryRow
  return { row, text: `${title}\n${text}` }
}

describe('scorePaletteItem', () => {
  it('ranks title hits over body hits', () => {
    expect(scorePaletteItem(item('React ref guide', 'unrelated'), 'react')).toBe(100)
    expect(scorePaletteItem(item('untitled', 'react all day'), 'react')).toBe(10)
  })

  it('matches title subsequences above body substring', () => {
    expect(scorePaletteItem(item('react ref guide', 'nothing'), 'rgd')).toBe(40)
  })

  it('scores zero when neither matches and one for the empty query', () => {
    expect(scorePaletteItem(item('a', 'b'), 'zzz')).toBe(0)
    expect(scorePaletteItem(item('a', 'b'), '  ')).toBe(1)
  })
})
