/** hour-of-day 活跃分布（本地时间）——确定性的"习惯"画像 */
export default function HourDistribution({ histogram }: { histogram: readonly number[] }) {
  const max = Math.max(...histogram, 1)
  const labels = [0, 6, 12, 18]

  return (
    <div>
      <div className="flex h-24 items-end gap-[3px]">
        {histogram.map((count, hour) => (
          <div key={hour} className="group relative flex-1">
            <div
              className={`w-full rounded-t-[2px] transition-colors duration-150 ${count > 0 ? 'bg-accent/60 group-hover:bg-accent' : 'bg-elevated'}`}
              style={{ height: `${Math.max(count > 0 ? 4 : 2, (count / max) * 96)}px` }}
            />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 group-hover:block">
              <span className="block rounded-md border border-line bg-panel px-2 py-1 font-mono text-xs whitespace-nowrap text-mid shadow-sm">
                {`${hour}`.padStart(2, '0')}
                :00 · {count} turns
              </span>
            </span>
          </div>
        ))}
      </div>
      <div className="relative mt-2 h-4">
        {labels.map(hour => (
          <span
            key={hour}
            className="absolute font-mono text-[10px] text-faint"
            style={{ left: `${(hour / 24) * 100}%` }}
          >
            {`${hour}`.padStart(2, '0')}
            :00
          </span>
        ))}
      </div>
    </div>
  )
}
