import type { NodeId } from '../model/identity'
import type { MessageNode } from '../model/message-node'
import type { WebResult } from '../model/part'
import type { Trajectory } from '../model/trajectory'

import { variantInfoOf } from './turn-builder'

/**
 * DocumentView — the reading UI's model over the active path (Turn serves
 * analytics only). The UI must not traverse nodes itself; it consumes this.
 */
export interface DocBlock {
  readonly node: MessageNode
  /** Pager position (1-based) when the parent has several children; inner variant nodes are naturally null */
  readonly variant: { readonly index: number; readonly count: number } | null
  /** Real turn-input -> this reply latency; null on user blocks */
  readonly latencyMs: number | null
  /** Rewrite depth: 0 = original question, 1..n = replaced resubmissions (kept, visually downgraded) */
  readonly chainIndex: number
}

export interface DocumentView {
  readonly blocks: readonly DocBlock[]
  /** Session-level reference registry: path search results deduped by url, first-appearance order */
  readonly references: readonly WebResult[]
  /** Citation resolution window per assistant node carrying text (this turn's searches, path order) */
  readonly citationWindows: ReadonlyMap<NodeId, readonly WebResult[]>
}

export function buildDocumentView(t: Trajectory, path?: readonly NodeId[]): DocumentView {
  const activePath = path ?? t.activePath
  const blocks: DocBlock[] = []
  const references: WebResult[] = []
  const seenUrls = new Set<string>()
  const citationWindows = new Map<NodeId, WebResult[]>()

  let window: WebResult[] = []
  let windowDirty = true
  let turnStartAt: number | null = null
  let chainIndex = 0

  for (const nodeId of activePath) {
    const node = t.nodes.get(nodeId)
    if (!node) continue

    if (node.role === 'user') {
      turnStartAt = node.at
      // consecutive user nodes (parent is also a user) form the rewrite chain
      const parent = node.parentId !== null ? t.nodes.get(node.parentId) : undefined
      chainIndex = parent?.role === 'user' ? chainIndex + 1 : 0
    }

    const variant = variantInfoOf(t, nodeId)

    for (const part of node.parts) {
      if (part.kind === 'search') {
        for (const r of part.results) {
          window.push(r)
          if (!seenUrls.has(r.url)) {
            seenUrls.add(r.url)
            references.push(r)
          }
        }
        windowDirty = true
      }
    }

    if (node.role === 'user') window = []

    if (node.role === 'assistant' && node.parts.some((p) => p.kind === 'text')) {
      citationWindows.set(node.id, windowDirty ? [...window] : window)
      windowDirty = false
    }

    const latencyMs =
      node.role === 'assistant' && turnStartAt !== null && node.at >= turnStartAt
        ? node.at - turnStartAt
        : null
    // rewrite depth is a user-node property; assistant blocks reset it
    blocks.push({ node, variant, latencyMs, chainIndex: node.role === 'user' ? chainIndex : 0 })
  }

  return { blocks, references, citationWindows }
}

export interface ResolvedCitation {
  readonly result: WebResult
  /** Stable registry number (1-based) */
  readonly refIndex: number
}

/**
 * Two-level citation resolution (empirical: numbers index the turn's search
 * window, 1-based): resolve within the turn window, map the hit to the stable
 * session registry number, fall back to the registry itself, else null — the
 * UI renders a degraded plain marker.
 */
export function resolveCitation(
  n: number,
  window: readonly WebResult[] | undefined,
  references: readonly WebResult[],
): ResolvedCitation | null {
  const refIndexOf = (r: WebResult) => references.findIndex((x) => x.url === r.url)

  if (window && n >= 1 && n <= window.length) {
    const result = window[n - 1]
    const refIndex = refIndexOf(result)
    if (refIndex >= 0) return { result, refIndex: refIndex + 1 }
  }
  if (n >= 1 && n <= references.length) return { result: references[n - 1], refIndex: n }
  return null
}
