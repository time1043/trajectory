import { useTheme } from '@/app/stores/theme'

import { IconMoon, IconSun } from './icons'

export default function ThemeController() {
  const { theme, toggle } = useTheme()
  return (
    <button
      type="button"
      onClick={(e) => toggle({ clientX: e.clientX, clientY: e.clientY })}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
      className="rounded-sm p-1.5 text-low transition-colors duration-200 hover:text-hi"
    >
      {theme === 'dark' ? <IconSun className="size-4" /> : <IconMoon className="size-4" />}
    </button>
  )
}
