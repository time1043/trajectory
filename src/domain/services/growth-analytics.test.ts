import { describe, expect, it } from 'vitest'

import { computeGrowthOverview } from './growth-analytics'
import type { Trajectory } from '../model/trajectory'
import { toNodes } from '../../adapters/sources/local/common'
import type { NodeDraft } from '../../adapters/sources/local/common'

const HOUR = 3_600_000
const DAY = 86_400_000

function linear(id: string, turns: Array<{ at: number }>): Trajectory {
  const drafts: NodeDraft[] = []
  turns.forEach((turn, i) => {
    drafts.push({ id: `${id}:u${i}`, at: turn.at, role: 'user', parts: [{ kind: 'text', text: `q${i}` }] })
    drafts.push({ id: `${id}:a${i}`, at: turn.at + HOUR, role: 'assistant', parts: [{ kind: 'text', text: `r${i}` }] })
  })
  return {
    id: `test:${id}`,
    sourceId: 'test',
    title: id,
    startedAt: turns[0]?.at ?? 0,
    updatedAt: turns.length ? turns[turns.length - 1].at + HOUR : 0,
    nodes: toNodes(drafts),
    activePath: drafts.map(d => d.id),
  }
}

/** fixed local-midnight anchor so day bucketing is deterministic in the test TZ */
function localMidnight(dayOffset: number, hour = 10): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime() + dayOffset * DAY + hour * HOUR
}

describe('computeGrowthOverview', () => {
  it('buckets activity by local day and counts touched trajectories', () => {
    const day0 = localMidnight(-1, 9)
    const day1 = localMidnight(0, 22)
    const overview = computeGrowthOverview([
      linear('a', [{ at: day0 }, { at: day0 + 2 * HOUR }]),
      linear('b', [{ at: day0 + HOUR }]),
      linear('c', [{ at: day1 }]),
    ])
    const byDay = new Map(overview.daily.map(d => [d.day, d]))
    const key0 = new Date(day0).toISOString().slice(0, 10)
    const key1 = new Date(day1).toISOString().slice(0, 10)
    expect(byDay.get(key0)).toMatchObject({ turns: 3, trajectories: 2 })
    expect(byDay.get(key1)).toMatchObject({ turns: 1, trajectories: 1 })
    expect(overview.totalSessions).toBe(3)
    expect(overview.totalTurns).toBe(4)
    expect(overview.totalMessages).toBe(8)
  })

  it('fills the local-time hour histogram from turn starts', () => {
    const hour = new Date().getHours()
    const overview = computeGrowthOverview([linear('a', [{ at: localMidnight(-1, hour) }])])
    expect(overview.hourHistogram[hour]).toBe(1)
  })

  it('computes longest and current streaks across consecutive days', () => {
    const overview = computeGrowthOverview([
      linear('a', [{ at: localMidnight(-2, 10) }]),
      linear('b', [{ at: localMidnight(-1, 10) }]),
      linear('c', [{ at: localMidnight(0, 10) }]),
      linear('gap', [{ at: localMidnight(-30, 10) }]),
    ])
    expect(overview.longestStreak).toBe(3)
    expect(overview.currentStreak).toBe(3)
    expect(overview.activeDays).toBe(4)
    expect(overview.spanDays).toBe(31)
  })

  it('tolerates "not active yet today" by anchoring the current streak at yesterday', () => {
    const overview = computeGrowthOverview([
      linear('a', [{ at: localMidnight(-2, 10) }]),
      linear('b', [{ at: localMidnight(-1, 10) }]),
    ])
    expect(overview.currentStreak).toBe(2)
  })
})
