import { describe, expect, it } from 'vitest'

import type { SessionSummary } from '@/domain/ports/source-adapter'

import { computeGrowthOverview } from '@/domain/services/growth-analytics'

const HOUR = 3_600_000
const DAY = 86_400_000

function summary(id: string, turnAts: number[]): SessionSummary {
  const sorted = [...turnAts].sort((a, b) => a - b)
  return {
    id: `test:${id}`,
    sessionId: id,
    title: id,
    startedAt: sorted[0] ?? 0,
    updatedAt: sorted.length ? sorted[sorted.length - 1] + HOUR : 0,
    turnStarts: sorted,
    messageCount: sorted.length * 2,
    firstPrompt: '',
  }
}

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
      summary('a', [day0, day0 + 2 * HOUR]),
      summary('b', [day0 + HOUR]),
      summary('c', [day1]),
    ])
    const byDay = new Map(overview.daily.map((d) => [d.day, d]))
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
    const overview = computeGrowthOverview([summary('a', [localMidnight(-1, hour)])])
    expect(overview.hourHistogram[hour]).toBe(1)
  })

  it('computes longest and current streaks across consecutive days', () => {
    const overview = computeGrowthOverview([
      summary('a', [localMidnight(-2, 10)]),
      summary('b', [localMidnight(-1, 10)]),
      summary('c', [localMidnight(0, 10)]),
      summary('gap', [localMidnight(-30, 10)]),
    ])
    expect(overview.longestStreak).toBe(3)
    expect(overview.currentStreak).toBe(3)
    expect(overview.activeDays).toBe(4)
    expect(overview.spanDays).toBe(31)
  })

  it('tolerates "not active yet today" by anchoring the current streak at yesterday', () => {
    const overview = computeGrowthOverview([
      summary('a', [localMidnight(-2, 10)]),
      summary('b', [localMidnight(-1, 10)]),
    ])
    expect(overview.currentStreak).toBe(2)
  })
})
