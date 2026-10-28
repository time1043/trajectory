import { useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'

import type { EpochMs } from '@/domain/model/identity'
import type { DailyActivity } from '@/domain/services/growth-analytics'

const DAY = 86_400_000
const WEEKS_PER_ROW = 53

interface HeatCell {
  day: string
  count: number
  level: 0 | 1 | 2 | 3 | 4
  future: boolean
}

const LEVEL_CLASS: Record<HeatCell['level'], string> = {
  0: 'bg-elevated',
  1: 'bg-accent/25',
  2: 'bg-accent/45',
  3: 'bg-accent/70',
  4: 'bg-accent',
}

function levelOf(count: number): HeatCell['level'] {
  if (count <= 0)
    return 0
  if (count <= 2)
    return 1
  if (count <= 5)
    return 2
  if (count <= 9)
    return 3
  return 4
}

function toDay(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function mondayOf(d: Date): Date {
  const result = new Date(d)
  const offset = (result.getDay() + 6) % 7 // Monday=0
  result.setDate(result.getDate() - offset)
  result.setHours(0, 0, 0, 0)
  return result
}

function formatLabel(d: Date): string {
  return `${d.getFullYear()}.${`${d.getMonth() + 1}`.padStart(2, '0')}`
}

const MONTH_SHORT = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

/**
 * GitHub 式热力图，"轨迹年"拆行：从首个活动日起锚，每行 53 周，
 * 行标签 `2024.10 →`。数据 <1 年退化为单行左对齐。
 */
export default function ActivityHeatmap({ daily, firstAt, lastAt }: {
  daily: readonly DailyActivity[]
  firstAt: EpochMs
  lastAt: EpochMs
}) {
  const navigate = useNavigate()

  const rows = useMemo(() => {
    if (!firstAt || !lastAt)
      return []
    const counts = new Map(daily.map(d => [d.day, d.turns]))

    const anchor = mondayOf(new Date(firstAt))
    anchor.setDate(1) // 首活动月月初，再 snap 回周一
    const rowStarts: Date[] = []
    const rowCount = Math.max(1, Math.ceil((lastAt - anchor.getTime()) / DAY / (7 * WEEKS_PER_ROW)))
    for (let r = 0; r < rowCount; r++) {
      const start = new Date(anchor)
      start.setMonth(anchor.getMonth() + 12 * r)
      rowStarts.push(mondayOf(start))
    }

    const last = new Date(lastAt)
    last.setHours(0, 0, 0, 0)

    return rowStarts.map((rowStart) => {
      const columns: { label: string | null, cells: HeatCell[] }[] = []
      let prevMonth = -1
      let lastLabelWeek = -99
      for (let w = 0; w < WEEKS_PER_ROW; w++) {
        const weekStart = new Date(rowStart)
        weekStart.setDate(rowStart.getDate() + 7 * w)
        if (weekStart.getTime() > last.getTime() + 7 * DAY)
          break

        const cells: HeatCell[] = []
        for (let d = 0; d < 7; d++) {
          const date = new Date(weekStart)
          date.setDate(weekStart.getDate() + d)
          const future = date.getTime() > last.getTime()
          const day = toDay(date)
          const count = counts.get(day) ?? 0
          cells.push({ day, count, level: levelOf(count), future })
        }

        // 月份标签：换月才标，且与上一个标签至少隔 3 周，避免文字重叠
        const month = weekStart.getMonth()
        const label = month !== prevMonth && w < WEEKS_PER_ROW - 1 && w - lastLabelWeek >= 3
          ? MONTH_SHORT[month]
          : null
        if (label)
          lastLabelWeek = w
        prevMonth = month
        columns.push({ label, cells })
      }
      return { start: rowStart, columns }
    })
  }, [daily, firstAt, lastAt])

  if (!rows.length)
    return null

  return (
    <div className="flex flex-col gap-5 overflow-x-auto pb-2">
      {rows.map((row, ri) => (
        <div key={ri} className="flex items-start gap-3">
          <div className="w-20 shrink-0 font-mono text-xs whitespace-nowrap text-low">
            {formatLabel(row.start)}
            {' '}
            →
          </div>
          <div className="flex gap-[3px]">
            {row.columns.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-[3px]">
                <div className="relative h-3">
                  {col.label && (
                    <span className="absolute left-0 font-mono text-[10px] whitespace-nowrap text-faint">
                      {col.label}
                    </span>
                  )}
                </div>
                {col.cells.map((cell) => {
                  if (cell.future)
                    return <div key={cell.day} className="size-[10px] opacity-0" />
                  return (
                    <button
                      key={cell.day}
                      type="button"
                      onClick={() => void navigate({ to: '/sessions', search: { from: cell.day, to: cell.day } })}
                      className={`group relative size-[10px] rounded-[2px] transition-transform duration-100 hover:scale-125 ${LEVEL_CLASS[cell.level]}`}
                    >
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 hidden -translate-x-1/2 pb-1.5 group-hover:block">
                        <span className="block rounded-md border border-line bg-panel px-2 py-1 font-mono text-xs whitespace-nowrap text-mid shadow-sm">
                          {cell.count > 0 ? `${cell.count} turns · ${cell.day}` : `${cell.day}`}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-1.5 pl-[92px] font-mono text-[10px] text-faint">
        Less
        {[0, 1, 2, 3, 4].map(level => (
          <span key={level} className={`size-[10px] rounded-[2px] ${LEVEL_CLASS[level as HeatCell['level']]}`} />
        ))}
        More
      </div>
    </div>
  )
}
