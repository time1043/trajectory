import { createContext } from 'react'

import type { WebResult } from '@/domain/model/part'

/**
 * remark plugin: splits `[citation:N]` text nodes into custom citation nodes;
 * mdast->hast turns them into <sup class="citation" data-citation="N">N</sup>
 * via data.hName, and react-markdown's components.sup (citation-sup.tsx) takes
 * over rendering and resolution.
 */
const CITATION_RE = /\[citation:(\d+)\]/g

interface MdastNode {
  type: string
  value?: string
  children?: MdastNode[]
  data?: Record<string, unknown>
}

export function remarkCitations() {
  return (tree: MdastNode) => {
    const walk = (parent: MdastNode) => {
      if (!parent.children) return
      const next: MdastNode[] = []
      for (const child of parent.children) {
        if (child.type === 'text' && child.value && child.value.includes('[citation:')) {
          CITATION_RE.lastIndex = 0
          const matches = [...child.value.matchAll(CITATION_RE)]
          if (matches.length === 0) {
            next.push(child)
            continue
          }
          let last = 0
          for (const match of matches) {
            const start = match.index ?? 0
            if (start > last) next.push({ type: 'text', value: child.value.slice(last, start) })
            next.push({
              type: 'citation',
              value: match[1],
              children: [{ type: 'text', value: match[1] ?? '' }],
              data: {
                hName: 'sup',
                hProperties: { className: ['citation'], 'data-citation': match[1] },
              },
            })
            last = start + match[0].length
          }
          if (last < child.value.length) next.push({ type: 'text', value: child.value.slice(last) })
          continue
        }
        if (child.children) walk(child)
        next.push(child)
      }
      parent.children = next
    }
    walk(tree)
  }
}

export interface CitationContextValue {
  window: readonly WebResult[] | undefined
  references: readonly WebResult[]
}

export const CitationContext = createContext<CitationContextValue>({
  window: undefined,
  references: [],
})
