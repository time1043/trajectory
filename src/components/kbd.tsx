export default function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-xs border border-line px-1 py-px font-mono text-[11px] leading-4 text-low">
      {children}
    </kbd>
  )
}
