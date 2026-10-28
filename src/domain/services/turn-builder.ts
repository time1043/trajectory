import type { EpochMs, NodeId } from '../model/identity'
import type { MessageNode } from '../model/message-node'
import type { Part, WebResult } from '../model/part'
import type { Trajectory } from '../model/trajectory'

/**
 * Turn — analytics read model (streaks, activity, counts). The reading UI
 * consumes document-view's DocumentView instead; two granularities, two jobs.
 *
 * Rules: a turn starts at a user node; consecutive user nodes (question
 * rewrites) merge into the same turn; assistant nodes until the next user
 * node are its outputs; non-active sibling subtrees at forks are variants —
 * rewrites and regenerations are not distinguished.
 */
export interface Turn {
  readonly index: number
  /** Ascending, >= 1; the last one is the live input, earlier ones are kept history */
  readonly inputNodeIds: readonly NodeId[]
  /** May be empty (user sent, no reply) */
  readonly outputNodeIds: readonly NodeId[]
  readonly variants: readonly VariantRef[]
  /** Real input -> first output latency; null without an output or on clock rollback */
  readonly totalLatencyMs: number | null
  /** All search results within the turn, path order (first-priority citation window) */
  readonly searchWindow: readonly WebResult[]
  /** Approx text volume, for lazy-render placeholders */
  readonly approxChars: number
}

export interface VariantRef {
  readonly nodeId: NodeId
  readonly siblingOf: NodeId
}

/** Walk "last child" from a node down to a leaf (ancestors are the caller's job) */
export function activePathFrom(t: Trajectory, start: NodeId): readonly NodeId[] {
  const path: NodeId[] = []
  const seen = new Set<NodeId>()
  let current: MessageNode | undefined = t.nodes.get(start)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.push(current.id)
    const children = current.childIds
      .map(id => t.nodes.get(id))
      .filter((n): n is MessageNode => !!n)
      .sort((a, b) => a.at - b.at)
    current = children[children.length - 1]
  }
  return path
}

/**
 * Full sibling sequence containing the node itself, ascending by `at`.
 * Top-level nodes are children of a virtual root — 52/520 deepseek
 * conversations branch at the opening question, and the erased root sentinel
 * loses that relation, so it is rebuilt here.
 */
export function orderedSiblingsOf(t: Trajectory, nodeId: NodeId): readonly NodeId[] {
  const node = t.nodes.get(nodeId)
  if (!node)
    return []
  if (node.parentId === null) {
    return [...t.nodes.values()]
      .filter(n => n.parentId === null)
      .sort((a, b) => a.at - b.at)
      .map(n => n.id)
  }
  return t.nodes.get(node.parentId)?.childIds ?? []
}

/** Pager info (1-based); null when there is no branch */
export function variantInfoOf(t: Trajectory, nodeId: NodeId): { index: number, count: number } | null {
  const ordered = orderedSiblingsOf(t, nodeId)
  if (ordered.length <= 1)
    return null
  const idx = ordered.indexOf(nodeId)
  return idx >= 0 ? { index: idx + 1, count: ordered.length } : null
}

/**
 * Swap a variant subtree into the path. The variant subtree continues on its
 * own default active path; choices below the switch point belong to the
 * discarded subtree and are dropped. The prefix before the fork stays
 * node-identical — UI memoization depends on that.
 */
export function switchVariant(t: Trajectory, currentPath: readonly NodeId[], variant: VariantRef): readonly NodeId[] {
  const branchNode = t.nodes.get(variant.siblingOf)
  if (!branchNode)
    return t.activePath
  // top-level fork: empty prefix, expand from the variant subtree
  if (branchNode.parentId === null)
    return activePathFrom(t, variant.nodeId)
  const prefix: NodeId[] = []
  for (const id of currentPath) {
    prefix.push(id)
    if (id === variant.siblingOf)
      break
  }
  prefix.pop()
  return [...prefix, ...activePathFrom(t, variant.nodeId)]
}

function partChars(parts: readonly Part[]): number {
  let sum = 0
  for (const p of parts) {
    if (p.kind === 'text' || p.kind === 'reasoning')
      sum += p.text.length
    else if (p.kind === 'attachment')
      sum += p.files.length * 40
    else if (p.kind === 'search')
      sum += p.results.length * 80
  }
  return sum
}

export function buildTurns(t: Trajectory, path?: readonly NodeId[]): readonly Turn[] {
  const activePath = path ?? t.activePath
  const turns: Turn[] = []

  let inputNodeIds: NodeId[] = []
  let outputNodeIds: NodeId[] = []
  let variants: VariantRef[] = []
  let searchWindow: WebResult[] = []
  let approxChars = 0
  let firstInputAt: EpochMs | null = null
  let firstOutputAt: EpochMs | null = null

  const flush = () => {
    if (!inputNodeIds.length && !outputNodeIds.length)
      return
    turns.push({
      index: turns.length,
      inputNodeIds,
      outputNodeIds,
      variants,
      searchWindow,
      approxChars,
      totalLatencyMs:
        firstInputAt !== null && firstOutputAt !== null && firstOutputAt >= firstInputAt
          ? firstOutputAt - firstInputAt
          : null,
    })
    inputNodeIds = []
    outputNodeIds = []
    variants = []
    searchWindow = []
    approxChars = 0
    firstInputAt = null
    firstOutputAt = null
  }

  for (const nodeId of activePath) {
    const node = t.nodes.get(nodeId)
    if (!node)
      continue

    // a user node opens a new turn; variants belong to the turn they sit in,
    // so flush first — otherwise they land in the previous turn
    if (node.role === 'user')
      flush()

    for (const siblingId of orderedSiblingsOf(t, nodeId)) {
      if (siblingId !== nodeId)
        variants.push({ nodeId: siblingId, siblingOf: nodeId })
    }

    if (node.role === 'user') {
      inputNodeIds.push(node.id)
      firstInputAt = node.at
    }
    else {
      if (!inputNodeIds.length) {
        // rare: path starts with an assistant node (malformed export)
        inputNodeIds.push(node.id)
      }
      else {
        outputNodeIds.push(node.id)
        if (firstOutputAt === null)
          firstOutputAt = node.at
      }
    }
    approxChars += partChars(node.parts)

    for (const part of node.parts) {
      if (part.kind === 'search')
        searchWindow.push(...part.results)
    }
  }
  flush()

  return turns
}
