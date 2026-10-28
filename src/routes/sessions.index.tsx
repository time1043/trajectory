import { createFileRoute } from '@tanstack/react-router'
import { Suspense } from 'react'

import Loading from '@/components/loading'
import Kbd from '@/components/kbd'

export const Route = createFileRoute('/sessions/')({
  component: () => (
    <Suspense fallback={<Loading />}>
      <SessionsWelcome />
    </Suspense>
  ),
})

function SessionsWelcome() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 pb-24">
      <div className="text-accent">◆</div>
      <div className="mt-3 font-mono text-sm text-mid">trajectory</div>
      <p className="mt-6 max-w-md text-center text-sm leading-7 text-low">
        记录一个人的成长路径——所有的人格潜力，都在他与 AI 的对话中。
      </p>
      <div className="mt-8 flex items-center gap-2 font-mono text-xs text-faint">
        <Kbd>⌘K</Kbd>
        <span>搜索</span>
        <span className="px-1">·</span>
        <Kbd>j</Kbd>
        <Kbd>k</Kbd>
        <span>浏览列表</span>
      </div>
    </div>
  )
}
