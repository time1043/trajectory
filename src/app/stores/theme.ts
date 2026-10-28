import { atom, useAtom, useAtomValue } from 'jotai'
import { useCallback } from 'react'

export type Theme = 'light' | 'dark'

export const THEME_KEY = 'trajectory.theme'

/** Resolved synchronously before first paint in main.tsx; this is the fallback */
export function initialTheme(): Theme {
  if (typeof window === 'undefined')
    return 'dark'
  const raw = localStorage.getItem(THEME_KEY)
  if (raw === 'dark' || raw === 'light')
    return raw
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const themeAtom = atom<Theme>(initialTheme())

export function applyThemeClass(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function useTheme() {
  const theme = useAtomValue(themeAtom)
  const [, setTheme] = useAtom(themeAtom)
  const toggle = useCallback((event?: { clientX: number, clientY: number }) => {
    const next = theme === 'dark' ? 'light' : 'dark'
    const apply = () => applyThemeClass(next)

    // circular reveal from the click position (antfu-style), plain switch when unsupported
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void> }
    }
    if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const transition = doc.startViewTransition(apply)
      void transition.ready.then(() => {
        const x = event?.clientX ?? window.innerWidth
        const y = event?.clientY ?? 0
        const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 450, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' },
        )
      }).catch(() => {})
    }
    else {
      apply()
    }

    setTheme(next)
    localStorage.setItem(THEME_KEY, next)
  }, [theme, setTheme])
  return { theme, toggle }
}
