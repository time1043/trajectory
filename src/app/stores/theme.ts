import { atom, useAtom, useAtomValue } from 'jotai'
import { useCallback } from 'react'

export type Theme = 'light' | 'dark'

/** 初始值在 main.tsx 渲染前同步写好（防 FOUC），此处兜底 */
function initialTheme(): Theme {
  if (typeof window === 'undefined')
    return 'dark'
  const raw = localStorage.getItem('trajectory.theme')
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

    // antfu 同款：从按钮坐标出发的圆形揭示（不支持时直切）
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
    localStorage.setItem('trajectory.theme', next)
  }, [theme, setTheme])
  return { theme, toggle }
}
