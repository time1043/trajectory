import type { EpochMs, NodeId } from '../model/identity'
import type { MessageNode } from '../model/message-node'
import type { Part, WebResult } from '../model/part'
import type { Trajectory } from '../model/trajectory'

/**
 * Turn — 从路径线性化的分析单元（读模型）。仅供 analytics/streak/统计消费；
 * 会话详情的文档流消费 document-view.ts 的 DocumentView，两套粒度各司其职。
 *
 * 口径：
 * - 一个 Turn 从路径上一个 user 节点开始；连续 user 节点（改写重发链）并入同一 Turn；
 * - 直到下一个 user 节点前的所有 assistant 节点归入 outputs；
 * - 路径途经节点的非活跃 sibling 子树统一记为 variant（改写重发与重新生成不做语义区分）。
 */
export interface Turn {
  readonly index: number
  /** ≥1，时间升序；主显示取最后一个，历史改写全部保留（不可丢弃） */
  readonly inputNodeIds: readonly NodeId[]
  /** 可为 0（用户发了但无回复） */
  readonly outputNodeIds: readonly NodeId[]
  /** 分支点上的兄弟子树（siblingOf 是活跃路径节点） */
  readonly variants: readonly VariantRef[]
  /** 本轮输入到首个输出的真实耗时；无输出或时钟回拨为 null */
  readonly totalLatencyMs: number | null
  /** 路径顺序上本轮内的全部搜索结果（citation 的第一优先解析窗口） */
  readonly searchWindow: readonly WebResult[]
  /** 文本量估算（字符数），供懒渲染占位防跳动 */
  readonly approxChars: number
}

export interface VariantRef {
  /** 变体子树入口 */
  readonly nodeId: NodeId
  /** 它是路径上哪个节点的兄弟 */
  readonly siblingOf: NodeId
}

/** 从指定节点沿"末位 child"走到叶，返回完整路径（祖先由调用方拼接） */
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
 * 节点所在的完整兄弟序列（含自身，按 at 升序）。
 * 顶层节点视为"虚拟 root"的孩子——52/520 会话的分支在开题处，
 * adapter 抹掉 root 哨兵后，顶层兄弟关系必须在这里重建。
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

/** 分页器信息（1-based）；无分支返回 null */
export function variantInfoOf(t: Trajectory, nodeId: NodeId): { index: number, count: number } | null {
  const ordered = orderedSiblingsOf(t, nodeId)
  if (ordered.length <= 1)
    return null
  const idx = ordered.indexOf(nodeId)
  return idx >= 0 ? { index: idx + 1, count: ordered.length } : null
}

/**
 * 切换变体：把路径中 siblingOf 的位置替换为变体子树。
 * 变体子树自身的分支延续其默认活跃路径；切换点之后原路径的后续选择一并丢弃
 * （它们属于被抛弃的子树）。前缀（切换点之前）保持逐节点不变——UI memo 依赖这一点。
 */
export function switchVariant(t: Trajectory, currentPath: readonly NodeId[], variant: VariantRef): readonly NodeId[] {
  const branchNode = t.nodes.get(variant.siblingOf)
  if (!branchNode)
    return t.activePath
  // 顶层分支：前缀为空，直接从变体子树展开
  if (branchNode.parentId === null)
    return activePathFrom(t, variant.nodeId)
  const prefix: NodeId[] = []
  for (const id of currentPath) {
    prefix.push(id)
    if (id === variant.siblingOf)
      break
  }
  // 去掉分支节点本身，从其父级的另一个孩子重新展开
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

    // user 节点开启新 Turn；变体属于"它所在的 Turn"，
    // 所以必须先 flush 再收集，否则会记进上一个 Turn
    if (node.role === 'user')
      flush()

    // 路径节点存在兄弟分支（含顶层虚拟 root 分支）→ 记为变体
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
        // 罕见：路径以 assistant 开头（异常导出）——容错为独立 turn
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
