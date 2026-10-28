export interface StatItem {
  value: string
  label: string
}

/** hairline 竖线分隔的统计条 —— 不是四张圆角卡片 */
export default function StatStrip({ items }: { items: readonly StatItem[] }) {
  return (
    <div className="flex flex-wrap divide-x divide-line">
      {items.map((item, i) => (
        <div key={item.label} className={i === 0 ? 'pr-8' : 'px-8'}>
          <div className="text-3xl font-medium tracking-tight text-hi tabular-nums">{item.value}</div>
          <div className="mt-1 font-mono text-xs text-low">{item.label}</div>
        </div>
      ))}
    </div>
  )
}
