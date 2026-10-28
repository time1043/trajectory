import type { ParsedSource } from '@/domain/model/trajectory'
import type { Sanitizer } from '@/domain/ports/sanitizer'

/**
 * Prepared text redaction (email / mainland phone / national id). The adapter
 * already masks user-record PII at the type boundary, so the default pipeline
 * does not inject this; arm it at the ingest call site when sharing lands.
 */
const PATTERNS: readonly { re: RegExp, replace: string }[] = [
  { re: /[\w.+-]+@[\w-]+\.[\w.]+/g, replace: '[email]' },
  { re: /(?<!\d)1[3-9]\d{9}(?!\d)/g, replace: '[phone]' },
  { re: /(?<!\d)\d{17}[\dXx](?!\d)/g, replace: '[id]' },
]

export function createRegexSanitizer(options: { sanitizeText?: boolean } = {}): Sanitizer {
  const sanitizeText = options.sanitizeText ?? false
  return {
    sanitize(source: ParsedSource): ParsedSource {
      if (!sanitizeText)
        return source
      const trajectories = source.trajectories.map(t => ({
        ...t,
        nodes: new Map(
          [...t.nodes.entries()].map(([id, node]) => [
            id,
            {
              ...node,
              parts: node.parts.map((p) => {
                if (p.kind === 'text' || p.kind === 'reasoning') {
                  let text = p.text
                  for (const { re, replace } of PATTERNS)
                    text = text.replace(re, replace)
                  return { ...p, text }
                }
                return p
              }),
            },
          ]),
        ),
      }))
      return { ...source, trajectories }
    },
  }
}
