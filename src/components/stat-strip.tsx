export interface StatItem {
  value: string
  label: string
}

/** Stats divided by hairlines — not four rounded cards */
export default function StatStrip({ items }: { items: readonly StatItem[] }) {
  return (
    <div className="flex flex-wrap divide-x divide-line">
      {items.map((item, i) => (
        <div key={item.label} className={i === 0 ? 'pr-8' : 'px-8'}>
          <div className="text-3xl font-medium tracking-tight text-hi tabular-nums">
            {item.value}
          </div>
          <div className="mt-1 font-mono text-xs text-low">{item.label}</div>
        </div>
      ))}
    </div>
  )
}
