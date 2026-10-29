import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { useSetAtom } from 'jotai'
import { useEffect } from 'react'

import { paletteOpenAtom } from '@/app/stores/palette'
import AppSidebar from '@/components/app-sidebar'
import CommandPalette from '@/components/command-palette'
import ScrollTop from '@/components/scroll-top'

const RootLayout = () => {
  const setPaletteOpen = useSetAtom(paletteOpenAtom)

  // global ⌘K
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
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
