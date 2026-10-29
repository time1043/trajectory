import { Link } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'

import { sourceMetasAtom } from '@/app/stores/data'
import { PaletteTrigger } from '@/components/command-palette'
import Kbd from '@/components/kbd'
import ProviderDot from '@/components/provider-dot'
import ThemeController from '@/components/theme-controller'

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/timeline', label: 'Timeline' },
  { to: '/sessions', label: 'Sessions' },
] as const

export default function AppSidebar() {
  const sourceMetas = useAtomValue(sourceMetasAtom)

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-base md:flex">
      <div className="px-5 pt-6 pb-4">
        <Link
          to="/"
          className="flex items-center gap-2 text-hi transition-opacity duration-200 hover:opacity-80"
        >
          <span className="text-accent">◆</span>
          <span className="font-mono text-sm font-medium tracking-tight">trajectory</span>
        </Link>
      </div>

      <div className="px-4 pb-4">
        <PaletteTrigger />
      </div>

      <nav className="flex flex-col gap-0.5 px-3">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="rounded-sm px-2 py-1.5 text-sm text-mid transition-colors duration-200 hover:text-hi [&.active]:text-hi"
            activeProps={{ className: 'active' }}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-3">
        <div className="px-2 font-mono text-[11px] tracking-wider text-faint uppercase select-none">
          Sources
        </div>
        <div className="mt-2 flex flex-col gap-0.5">
          {sourceMetas.map((meta) => (
            <div
              key={meta.id}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-mid"
            >
              <ProviderDot sourceId={meta.id} />
              <span className="min-w-0 flex-1 truncate">{meta.label}</span>
              <span className="font-mono text-xs text-low">{meta.ok ? meta.count : '·'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-line px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-faint">
            <Kbd>⌘K</Kbd>
            <span>search</span>
            <Kbd>j</Kbd>
            <Kbd>k</Kbd>
            <span>move</span>
          </div>
          <ThemeController />
        </div>
      </div>
    </aside>
  )
}
