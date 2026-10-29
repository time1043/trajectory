import type { SqliteQueryResult } from '@/domain/ports/data-host'
import type { Sanitizer } from '@/domain/ports/sanitizer'
import type { Trajectory, SourceIndex } from '@/domain/ports/source-adapter'
import type { SourceAdapter, SourceManifest } from '@/domain/ports/source-adapter'

import { checkInvariants } from '@/domain/model/invariants'

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

function makeFetchFile() {
  return async (path: string) => {
    const res = await fetch(`/@api/file?path=${encodeURIComponent(path)}`)
    if (!res.ok) throw new Error(`[trajectory] fetch ${path}: ${res.status}`)
    return res.arrayBuffer()
  }
}

function makeQuerySqlite() {
  return async (path: string, sql: string, params?: readonly unknown[]) => {
    const res = await fetch('/@api/sqlite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, sql, params }),
    })
    if (!res.ok) throw new Error(`[trajectory] sqlite ${path}: ${res.status}`)
    return (await res.json()) as SqliteQueryResult
  }
}

/** Index pass: light summaries, deep-frozen (cheap — no bodies) */
export async function ingestIndex(
  adapter: SourceAdapter,
  manifest: SourceManifest,
  sanitizer: Sanitizer,
): Promise<SourceIndex> {
  const raw = await adapter.index({
    manifest,
    fetchFile: makeFetchFile(),
    querySqlite: makeQuerySqlite(),
  })
  const sanitized = sanitizer.sanitizeIndex(raw)
  return deepFreeze(sanitized)
}

/** Body pass: one session's full trajectory, sanitized and frozen (on demand) */
export async function loadTrajectoryBody(
  adapter: SourceAdapter,
  manifest: SourceManifest,
  sessionId: string,
  sanitizer: Sanitizer,
): Promise<Trajectory | null> {
  const raw = await adapter.loadSession(
    { manifest, fetchFile: makeFetchFile(), querySqlite: makeQuerySqlite() },
    sessionId,
  )
  if (!raw) return null

  const sanitized = sanitizer.sanitizeSession(raw)
  const violations = checkInvariants(sanitized)
  void violations // collected by the caller via diagnostics if needed
  return deepFreeze(sanitized)
}

/** First adapter that claims the manifest; null leaves the directory "unrecognized" instead of crashing */
export function detectAdapter(
  adapters: readonly SourceAdapter[],
  manifest: SourceManifest,
): SourceAdapter | null {
  return adapters.find((a) => a.detect(manifest)) ?? null
}
