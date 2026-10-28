import { createFileRoute } from '@tanstack/react-router'

import Kbd from '@/components/kbd'
import { withSuspense } from '@/components/loading'

export const Route = createFileRoute('/sessions/')({
  component: withSuspense(SessionsWelcome),
})

function SessionsWelcome() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 pb-24">
      <div className="text-accent">◆</div>
      <div className="mt-3 font-mono text-sm text-mid">trajectory</div>
      <p className="mt-6 max-w-md text-center text-sm leading-7 text-low">
        Record a person's growth path — all of one's potential lives in the conversations with AI.
      </p>
      <div className="mt-8 flex items-center gap-2 font-mono text-xs text-faint">
        <Kbd>⌘K</Kbd>
        <span>search</span>
        <span className="px-1">·</span>
        <Kbd>j</Kbd>
        <Kbd>k</Kbd>
        <span>browse</span>
      </div>
    </div>
  )
}
