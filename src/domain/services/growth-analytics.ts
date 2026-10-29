import type { EpochMs } from '../model/identity'
import type { Trajectory } from '../model/trajectory'

import { buildTurns } from './turn-builder'

export interface DailyActivity {
  /** 'YYYY-MM-DD' in the viewer's local timezone */
  day: string
  turns: number
  trajectories: number
}

export interface GrowthOverview {
  totalSessions: number
  totalMessages: number
  totalTurns: number
  firstAt: EpochMs | null
  lastAt: EpochMs | null
  activeDays: number
  spanDays: number
  currentStreak: number
  longestStreak: number
  daily: readonly DailyActivity[]
  /** Local-time hour-of-day histogram over turn start times */
  hourHistogram: readonly number[]
}

function localDay(at: EpochMs): string {
  const d = new Date(at)
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function computeStreaks(days: readonly string[]): { current: number; longest: number } {
  if (!days.length) return { current: 0, longest: 0 }
  const sorted = [...days].sort()
  const DAY = 86_400_000
  let longest = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    const gap = Math.round((Date.parse(sorted[i]) - Date.parse(sorted[i - 1])) / DAY)
    run = gap === 1 ? run + 1 : 1
    if (run > longest) longest = run
  }
  // current streak: walk back from today, tolerating "not active yet today"
  const today = new Date()
  const todayStr = localDay(today.getTime())
  const set = new Set(sorted)
  let current = 0
  let cursor = set.has(todayStr) ? todayStr : localDay(today.getTime() - DAY)
  while (set.has(cursor)) {
    current++
    cursor = localDay(Date.parse(cursor) - DAY)
  }
  return { current, longest }
}

/** Merged across sources; derived purely from Trajectory (via Turns), no IO */
export function computeGrowthOverview(trajectories: readonly Trajectory[]): GrowthOverview {
  const byDay = new Map<string, DailyActivity>()
  const hourHistogram = new Array<number>(24).fill(0)
  let totalMessages = 0
  let totalTurns = 0
  let firstAt: EpochMs | null = null
  let lastAt: EpochMs | null = null

  for (const t of trajectories) {
    totalMessages += t.nodes.size
    if (firstAt === null || t.startedAt < firstAt) firstAt = t.startedAt
    if (lastAt === null || t.updatedAt > lastAt) lastAt = t.updatedAt

    const turns = buildTurns(t)
    totalTurns += turns.length
    const touched = new Set<string>()
    for (const turn of turns) {
      const at = t.nodes.get(turn.inputNodeIds[0])?.at ?? t.startedAt
      const day = localDay(at)
      touched.add(day)
      hourHistogram[new Date(at).getHours()]++
      const entry = byDay.get(day) ?? { day, turns: 0, trajectories: 0 }
      entry.turns++
      byDay.set(day, entry)
    }
    for (const day of touched) {
      const entry = byDay.get(day)
      if (entry) entry.trajectories++
    }
  }

  const daily = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
  const { current, longest } = computeStreaks(daily.map((d) => d.day))
  const spanDays =
    firstAt !== null && lastAt !== null
      ? Math.max(1, Math.round((lastAt - firstAt) / 86_400_000) + 1)
      : 0

  return {
    totalSessions: trajectories.length,
    totalMessages,
    totalTurns,
    firstAt,
    lastAt,
    activeDays: daily.length,
    spanDays,
    currentStreak: current,
    longestStreak: longest,
    daily,
    hourHistogram,
  }
}
