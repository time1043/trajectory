import { Suspense } from 'react'

export default function Loading() {
  return (
    <div className="flex h-40 items-center justify-center font-mono text-sm text-low select-none">
      loading…
    </div>
  )
}

/** Route components read async atoms — every route wraps its content in this.
 *  Pass a hoisted function declaration so the route can reference it above. */
export function withSuspense(Component: React.ComponentType): React.FC {
  return () => (
    <Suspense fallback={<Loading />}>
      <Component />
    </Suspense>
  )
}
