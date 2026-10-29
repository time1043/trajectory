import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import type { EpochMs } from '@/domain/model/identity'
import type { DailyActivity } from '@/domain/services/growth-analytics'

import FloatingTooltip from '@/components/floating-tooltip'
import { MONTH_SHORT, fmtDate } from '@/lib/format'

const WEEKS_PER_ROW = 53

interface HeatCell {
  day: string
  count: number
  level: 0 | 1 | 2 | 3 | 4
  inactive: boolean
}

const LEVEL_CLASS: Record<HeatCell['level'], string> = {
  0: 'bg-elevated',
  1: 'bg-accent/25',
  2: 'bg-accent/45',
  3: 'bg-accent/70',
  4: 'bg-accent',
}

function levelOf(count: number): HeatCell['level'] {
  if (count <= 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 9) return 3
  return 4
}

function mondayOf(d: Date): Date {
  const result = new Date(d)
  const offset = (result.getDay() + 6) % 7 // Monday = 0
  result.setDate(result.getDate() - offset)
  result.setHours(0, 0, 0, 0)
  return result
}

/**
 * GitHub-style heatmap over calendar years (Jan-Dec), the most recent year on
 * top. Days outside the data range render as invisible placeholders so every
 * row stays week-aligned with its month labels.
 */
export default function ActivityHeatmap({
  daily,
  firstAt,
  lastAt,
}: {
  daily: readonly DailyActivity[]
  firstAt: EpochMs
  lastAt: EpochMs
}) {
  const navigate = useNavigate()
  const [hover, setHover] = useState<{ x: number; y: number; count: number; day: string } | null>(
    null,
  )

  const rows = useMemo(() => {
    if (!firstAt || !lastAt) return []
    const counts = new Map(daily.map((d) => [d.day, d.turns]))

    const first = new Date(firstAt)
    first.setHours(0, 0, 0, 0)
    const last = new Date(lastAt)
    last.setHours(0, 0, 0, 0)

    // calendar years Jan-Dec, the most recent year on top
    const years: number[] = []
    for (let y = last.getFullYear(); y >= first.getFullYear(); y--) years.push(y)

    return years.map((year) => {
      const rowStart = mondayOf(new Date(year, 0, 1))
      const columns: { label: string | null; cells: HeatCell[] }[] = []
      let prevMonth = -1
      let lastLabelWeek = -99
      for (let w = 0; w < WEEKS_PER_ROW; w++) {
        const weekStart = new Date(rowStart)
        weekStart.setDate(rowStart.getDate() + 7 * w)
        if (weekStart.getFullYear() > year) break

        const cells: HeatCell[] = []
        for (let d = 0; d < 7; d++) {
          const date = new Date(weekStart)
          date.setDate(weekStart.getDate() + d)
          // days outside the data range keep the grid geometry but stay invisible
          const inactive = date < first || date > last
          const day = fmtDate(date.getTime())
          const count = counts.get(day) ?? 0
          cells.push({ day, count, level: levelOf(count), inactive })
        }

        // label on month change, at least 3 weeks after the previous one, or the text overlaps
        const month = weekStart.getMonth()
        const label =
          month !== prevMonth && w < WEEKS_PER_ROW - 1 && w - lastLabelWeek >= 3
            ? MONTH_SHORT[month]
            : null
        if (label) lastLabelWeek = w
        prevMonth = month
        columns.push({ label, cells })
      }
      return { year, columns }
    })
  }, [daily, firstAt, lastAt])

  if (!rows.length) return null

  return (
    <div className="flex flex-col gap-5 overflow-x-auto pb-2">
      <FloatingTooltip point={hover ? { x: hover.x, y: hover.y } : null}>
        {hover && (hover.count > 0 ? `${hover.count} turns · ${hover.day}` : hover.day)}
      </FloatingTooltip>
      {rows.map((row, ri) => (
        <div key={ri} className="flex items-start gap-3">
          <div className="w-20 shrink-0 font-mono text-xs whitespace-nowrap text-low">
            {row.year}
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
                  if (cell.inactive) return <div key={cell.day} className="size-[10px] opacity-0" />
                  return (
                    <button
                      key={cell.day}
                      type="button"
                      onClick={() =>
                        void navigate({ to: '/sessions', search: { from: cell.day, to: cell.day } })
                      }
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setHover({
                          x: rect.left + rect.width / 2,
                          y: rect.top,
                          count: cell.count,
                          day: cell.day,
                        })
                      }}
                      onMouseLeave={() => setHover(null)}
                      className={`size-[10px] rounded-[2px] transition-transform duration-100 hover:scale-125 ${LEVEL_CLASS[cell.level]}`}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-1.5 pl-[92px] font-mono text-[10px] text-faint">
        Less
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            className={`size-[10px] rounded-[2px] ${LEVEL_CLASS[level as HeatCell['level']]}`}
          />
        ))}
        More
      </div>
    </div>
  )
}
