import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { useEffect } from 'react'

import CommandPalette from '@/components/command-palette'
import AppSidebar from '@/components/app-sidebar'
import ScrollTop from '@/components/scroll-top'
import { paletteOpenAtom } from '@/app/stores/ui'
import { useSetAtom } from 'jotai'

const RootLayout = () => {
  const setPaletteOpen = useSetAtom(paletteOpenAtom)

  // 全局 ⌘K
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(open => !open)
      }
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  }, [setPaletteOpen])

  return (
    <div className="min-h-screen bg-base text-hi antialiased">
      <AppSidebar />
      <main className="md:pl-60">
        <Outlet />
      </main>
      <CommandPalette />
      <ScrollTop />
      <TanStackRouterDevtools position="bottom-right" />
    </div>
  )
}

export const Route = createRootRoute({ component: RootLayout })
