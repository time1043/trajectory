/** antfu empty-state signature: literal braces + mono */
export default function EmptyState({ children = '{ nothing here yet }' }: { children?: string }) {
  return (
    <div className="flex h-40 items-center justify-center font-mono text-sm text-low select-none">
      {children}
    </div>
  )
}
