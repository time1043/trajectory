import type { ParsedSource } from '@/domain/model/trajectory'
import type { Sanitizer } from '@/domain/ports/sanitizer'

/**
 * RegexSanitizer — 文本脱敏的预备实现（email/手机号/中国大陆身份证）。
 * adapter 已在类型边界掩码 user.json 的 PII（PersonaProfile 无明文字段），
 * 因此默认管道不注入本实现；"脱敏分享"需求落地时在 ingest 调用处打开即可。
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
