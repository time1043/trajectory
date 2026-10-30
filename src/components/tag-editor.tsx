import { useAtom, useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'

import { allTagCountsAtom, sessionTagsAtom } from '@/app/stores/tags'

/**
 * Inline tag editor for one session: chips with remove buttons plus a
 * type-ahead input fed by every tag the user has ever used (most used first).
 * `t` focuses it from anywhere on the page; Enter adds and keeps typing;
 * Esc closes. Persisted under data/tags.json via sessionTagsAtom.
 * Dev-only: in preview/production builds, tags render read-only.
 */
export default function TagEditor({
  trajectoryId,
  shortcut = false,
}: {
  trajectoryId: string
  shortcut?: boolean
}) {
  const [tagsBySession, setTagsBySession] = useAtom(sessionTagsAtom)
  const tagCounts = useAtomValue(allTagCountsAtom)
  const tags = tagsBySession[trajectoryId] ?? []

  const isDev = import.meta.env.DEV

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!shortcut || !isDev) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 't' || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return
      e.preventDefault()
      setEditing(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shortcut, isDev])

  useEffect(() => {
    if (editing && isDev) requestAnimationFrame(() => inputRef.current?.focus())
  }, [editing, isDev])

  if (!isDev) {
    if (!tags.length) return null
    return (
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-sm border border-line bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] text-mid"
          >
            <span className="text-accent">#</span>
            {tag}
          </span>
        ))}
      </div>
    )
  }

  const commit = (raw: string) => {
    const tag = raw.trim().toLowerCase().replace(/,/g, '')
    if (!tag) return
    if (!tags.includes(tag)) setTagsBySession({ ...tagsBySession, [trajectoryId]: [...tags, tag] })
    setDraft('')
  }
  const remove = (tag: string) => {
    const next = tags.filter((t) => t !== tag)
    const nextMap = { ...tagsBySession }
    if (next.length) nextMap[trajectoryId] = next
    else delete nextMap[trajectoryId]
    setTagsBySession(nextMap)
  }

  const needle = draft.trim().toLowerCase()
  const suggestions = needle
    ? [...tagCounts.keys()].filter((t) => t.includes(needle) && !tags.includes(t)).slice(0, 6)
    : []

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-1 rounded-sm border border-line bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] text-mid"
        >
          <span className="text-accent">#</span>
          {tag}
          <button
            type="button"
            onClick={() => remove(tag)}
            className="text-faint transition-colors duration-150 hover:text-hi"
            aria-label={`Remove tag ${tag}`}
          >
            ×
          </button>
        </span>
      ))}
      {editing ? (
        <span className="relative">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit(draft)
              else if (e.key === 'Escape') {
                setEditing(false)
                setDraft('')
              }
            }}
            onBlur={() => {
              // commit what was typed, then close
              commit(draft)
              setEditing(false)
              setDraft('')
            }}
            placeholder="tag…"
            className="w-28 rounded-sm border border-line bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-hi outline-none placeholder:text-faint focus:border-accent"
          />
          {suggestions.length > 0 && (
            <div className="absolute top-full left-0 z-40 mt-1 w-44 overflow-y-auto rounded-md border border-line bg-panel py-1 shadow-lg">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  // mousedown fires before the input's blur, keeping the editor mounted
                  onMouseDown={(e) => {
                    e.preventDefault()
                    commit(s)
                  }}
                  className="block w-full px-2 py-1 text-left font-mono text-[11px] text-mid transition-colors duration-150 hover:bg-elevated hover:text-hi"
                >
                  <span className="text-accent">#</span>
                  {s}
                  <span className="ml-1.5 text-faint">{tagCounts.get(s)}</span>
                </button>
              ))}
            </div>
          )}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-sm border border-dashed border-line px-1.5 py-0.5 font-mono text-[11px] text-faint transition-colors duration-200 hover:border-accent hover:text-mid"
          title="Add a tag (t)"
        >
          + tag
          <span className="ml-1 opacity-60">t</span>
        </button>
      )}
    </div>
  )
}
