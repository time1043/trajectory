import type { ParsedSource } from '@/domain/model/trajectory'
import type { SqliteQueryResult } from '@/domain/ports/data-host'
import type { Sanitizer } from '@/domain/ports/sanitizer'
import type { SourceAdapter, SourceManifest } from '@/domain/ports/source-adapter'

import { checkInvariants } from '@/domain/model/invariants'

/**
 * Ingest pipeline: adapter.parse -> sanitize -> invariant checks -> deep
 * freeze. The pipeline output is immutable fact — React Compiler memoization
 * relies on it, so any "change" (variant switching etc.) must go through pure
 * functions returning new values, never in-place mutation.
 */
export async function ingest(
  adapter: SourceAdapter,
  manifest: SourceManifest,
  sanitizer: Sanitizer,
): Promise<ParsedSource> {
  const raw = await adapter.parse({
    manifest,
    fetchFile: async (path) => {
      const res = await fetch(`/@api/file?path=${encodeURIComponent(path)}`)
      if (!res.ok) throw new Error(`[trajectory] fetch ${path}: ${res.status}`)
      return res.arrayBuffer()
    },
    querySqlite: async (path, sql, params) => {
      const res = await fetch('/@api/sqlite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, sql, params }),
      })
      if (!res.ok) throw new Error(`[trajectory] sqlite ${path}: ${res.status}`)
      return (await res.json()) as SqliteQueryResult
    },
  })

  const sanitized = sanitizer.sanitize(raw)

  const violations: string[] = []
  for (const t of sanitized.trajectories) violations.push(...checkInvariants(t))

  const checked: ParsedSource = {
    ...sanitized,
    diagnostics: {
      unknownPartCounts: sanitized.diagnostics.unknownPartCounts,
      invariantViolations: [...sanitized.diagnostics.invariantViolations, ...violations],
    },
  }
  return deepFreeze(checked)
}

function deepFreeze<T>(value: T): T {
  if (value instanceof Map) {
    Object.freeze(value)
    for (const [key, item] of value) {
      deepFreeze(key)
      deepFreeze(item)
    }
  } else if (value instanceof Set) {
    Object.freeze(value)
    for (const item of value) deepFreeze(item)
  } else if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value as Record<string, unknown>))
      deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

/** First adapter that claims the manifest; null leaves the directory "unrecognized" instead of crashing */
export function detectAdapter(
  adapters: readonly SourceAdapter[],
  manifest: SourceManifest,
): SourceAdapter | null {
  return adapters.find((a) => a.detect(manifest)) ?? null
}
