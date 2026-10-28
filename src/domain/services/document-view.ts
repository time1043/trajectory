import type { NodeId } from '../model/identity'
import type { MessageNode } from '../model/message-node'
import type { WebResult } from '../model/part'
import type { Trajectory } from '../model/trajectory'
import { variantInfoOf } from './turn-builder'

/**
 * DocumentView — 会话详情的文档流读模型（与 analytics 用的 Turn 各司其职）。
 * UI 层禁止自建节点遍历，一律消费这里。
 */
export interface DocBlock {
  readonly node: MessageNode
  /** 父节点有多个 child 时标记分页器位置（1-based）；变体子树内部节点天然为 null */
  readonly variant: { readonly index: number; readonly count: number } | null
  /** 本轮输入 → 该回复的真实耗时；user 块或无时间差为 null */
  readonly latencyMs: number | null
  /** 改写链深度：0=原始提问，1..n=被改写重发的历史版本（数据保留，视觉降权） */
  readonly chainIndex: number
}

export interface DocumentView {
  readonly blocks: readonly DocBlock[]
  /** 会话级引用注册表：路径上全部搜索结果按 url 去重、按首次出现顺序编号（展示 1-based） */
  readonly references: readonly WebResult[]
  /** 每个含正文的 assistant 节点的 citation 解析窗口（本轮内的搜索结果，路径序） */
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
    if (!node)
      continue

    if (node.role === 'user') {
      turnStartAt = node.at
      // 连续 user 节点（父节点也是 user）= 改写重发链
      const parent = node.parentId !== null ? t.nodes.get(node.parentId) : undefined
      chainIndex = parent?.role === 'user' ? chainIndex + 1 : 0
    }

    const variant = variantInfoOf(t, nodeId)

    for (const part of node.parts) {
      if (part.kind === 'search') {
        // 窗口只增不减；去重服务于引用注册表，窗口本身保留原始顺序
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

    if (node.role === 'user')
      window = []

    if (node.role === 'assistant' && node.parts.some(p => p.kind === 'text')) {
      citationWindows.set(node.id, windowDirty ? [...window] : window)
      windowDirty = false
    }

    const latencyMs = node.role === 'assistant' && turnStartAt !== null && node.at >= turnStartAt
      ? node.at - turnStartAt
      : null
    blocks.push({ node, variant, latencyMs, chainIndex })
  }

  return { blocks, references, citationWindows }
}

export interface ResolvedCitation {
  readonly result: WebResult
  /** 注册表中的稳定编号（1-based） */
  readonly refIndex: number
}

/**
 * Citation 两级解析（实测归纳：编号是对"本轮搜索窗口"的 1-based 索引）：
 * 1. 在本 Turn 的搜索窗口内按序取第 N 条，再映射到会话注册表的稳定编号
 * 2. 超界/无窗口时若 N 恰好落在注册表长度内，按注册表兜底
 * 3. 仍查不到 → 返回 null，UI 渲染为降级纯文本标记
 */
export function resolveCitation(
  n: number,
  window: readonly WebResult[] | undefined,
  references: readonly WebResult[],
): ResolvedCitation | null {
  const refIndexOf = (r: WebResult) => references.findIndex(x => x.url === r.url)

  if (window && n >= 1 && n <= window.length) {
    const result = window[n - 1]
    const refIndex = refIndexOf(result)
    if (refIndex >= 0)
      return { result, refIndex: refIndex + 1 }
  }
  if (n >= 1 && n <= references.length)
    return { result: references[n - 1], refIndex: n }
  return null
}
