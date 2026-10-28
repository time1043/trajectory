import type { SourceId } from '@/domain/model/identity'
import { checkInvariants } from '@/domain/model/invariants'
import type { ParsedSource } from '@/domain/model/trajectory'
import type { Sanitizer } from '@/domain/ports/sanitizer'
import type { SourceAdapter, SourceManifest } from '@/domain/ports/source-adapter'

/**
 * ingest 管道：adapter.parse → sanitize → invariants 校验 → 深冻结。
 * 管道出口的 ParsedSource 是不可变事实，React Compiler 的 memo 依赖这一点；
 * 任何"变化"（变体切换等）都必须通过纯函数返回新值，绝不就地改写。
 */
export async function ingest(adapter: SourceAdapter, manifest: SourceManifest, sanitizer: Sanitizer): Promise<ParsedSource> {
  const raw = await adapter.parse({
    manifest,
    fetchFile: async (path) => {
      const res = await fetch(`/@api/file?path=${encodeURIComponent(path)}`)
      if (!res.ok)
        throw new Error(`[trajectory] fetch ${path}: ${res.status}`)
      return res.arrayBuffer()
    },
  })

  const sanitized = sanitizer.sanitize(raw)

  const violations: string[] = []
  for (const t of sanitized.trajectories)
    violations.push(...checkInvariants(t))

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
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value as Record<string, unknown>))
      deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

/** 按来源找到能认领该 manifest 的 adapter；无认领者返回 null（UI 显示"未识别"而非崩溃） */
export function detectAdapter(adapters: readonly SourceAdapter[], manifest: SourceManifest): SourceAdapter | null {
  return adapters.find(a => a.detect(manifest)) ?? null
}

export function manifestSourceId(manifest: SourceManifest): SourceId {
  return manifest.dirName.split('/').pop() ?? manifest.dirName
}
