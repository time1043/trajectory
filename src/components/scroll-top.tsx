import { useEffect, useState } from 'react'

import { IconArrowUp } from './icons'

/** antfu-style: shows past 300px scroll, opacity transition */
export default function ScrollTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <button
      type="button"
      aria-label="Back to top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={`fixed right-6 bottom-6 z-40 flex size-9 items-center justify-center rounded-full text-hi backdrop-blur-sm transition-all duration-200 ${
        visible ? 'opacity-30 hover:opacity-100' : 'pointer-events-none opacity-0'
      }`}
      style={{ backgroundColor: 'var(--tr-elevated)', border: '1px solid var(--tr-line)' }}
    >
      <IconArrowUp className="size-4" />
    </button>
  )
}
