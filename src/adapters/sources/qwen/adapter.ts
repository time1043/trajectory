import type { Part } from '@/domain/model/part'
import type { SourceManifest } from '@/domain/ports/data-host'
import type { SourceAdapter, SessionSummary } from '@/domain/ports/source-adapter'

import { sourceIdentity } from '@/domain/ports/source-adapter'

import { buildTrajectory, truncatedText, titleFromPrompt, type NodeDraft } from '../local/common'

const CHAT_EXPORT = /chat-export-\d+\.json$/

interface QwenMessage {
  id: string
  role: string
  content: string
  contentList?: { content: string; phase?: string }[]
  models?: string[]
  parentId?: string | null
  childrenIds?: string[]
  timestamp?: number
}

interface QwenConversation {
  id: string
  title: string
  created_at: number
  updated_at: number
  chat: { history: { messages: Record<string, QwenMessage> } }
}

interface QwenExport {
  data: QwenConversation[]
}

function readExport(text: string): QwenConversation[] {
  const parsed = JSON.parse(text) as QwenExport
  return parsed.data ?? []
}

/** Walk the message tree along the last-child chain (same as the active path) */
function activeChain(messages: Record<string, QwenMessage>): QwenMessage[] {
  const roots = Object.values(messages)
    .filter((m) => !m.parentId)
    .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
  if (!roots.length) return []
  const path: QwenMessage[] = []
  let current = roots[roots.length - 1]
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.push(current)
    const children = (current.childrenIds ?? [])
      .map((id) => messages[id])
      .filter(Boolean)
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0))
    current = children[children.length - 1]
  }
  return path
}

/** Assistant text from content_list (the export puts responses there, not `content`) */
function assistantText(msg: QwenMessage): string {
  if (msg.content && msg.content.trim()) return msg.content
  const list =
    msg.contentList ??
    (msg as unknown as { content_list?: { content: string; phase?: string }[] }).content_list
  if (!Array.isArray(list)) return ''
  return list
    .filter((item) => item.phase !== 'thinking_summary' && typeof item.content === 'string')
    .map((item) => item.content)
    .join('')
}

/** Extract model name from the user message that triggered this exchange */
function modelFromMessages(messages: Record<string, QwenMessage>): string | null {
  for (const msg of Object.values(messages)) {
    if (msg.role === 'user' && Array.isArray(msg.models) && msg.models.length) return msg.models[0]
  }
  return null
}

export const qwenAdapter: SourceAdapter = {
  id: 'qwen',
  label: 'Qwen',
  detect(manifest: SourceManifest): boolean {
    if (!manifest.dirName.includes('qwen')) return false
    return manifest.files.some((f) => CHAT_EXPORT.test(f.path))
  },
  async index({ manifest, fetchFile }) {
    const identity = sourceIdentity(manifest, 'qwen', 'Qwen')
    const exportFile = manifest.files.find((f) => CHAT_EXPORT.test(f.path))
    if (!exportFile)
      return {
        ...identity,
        profile: null,
        sessions: [],
        diagnostics: { unknownPartCounts: {}, invariantViolations: [] },
      }

    const text = new TextDecoder().decode(await fetchFile(exportFile.path))
    const conversations = readExport(text)
    const summaries: SessionSummary[] = []

    for (const convo of conversations) {
      const messages = convo.chat?.history?.messages ?? {}
      const chain = activeChain(messages)
      if (!chain.length) continue

      const turnStarts: number[] = []
      let previousRole: string | null = null
      let firstPrompt = ''
      let messageCount = 0
      let model: string | null = null

      for (const msg of chain) {
        const at = (msg.timestamp ?? 0) * 1000 // seconds -> ms
        const hasContent = msg.role === 'user' ? !!msg.content?.trim() : !!assistantText(msg).trim()
        if (!hasContent) continue
        messageCount++

        if (msg.role === 'user') {
          if (previousRole !== 'user') turnStarts.push(at)
          if (!firstPrompt) firstPrompt = msg.content
          if (!model) model = msg.models?.[0] ?? null
        }
        previousRole = msg.role
      }

      if (!turnStarts.length) continue

      summaries.push({
        id: `${identity.sourceId}:${convo.id}`,
        sessionId: convo.id,
        title: convo.title || titleFromPrompt(firstPrompt) || '(untitled)',
        startedAt: (convo.created_at ?? 0) * 1000,
        updatedAt: (convo.updated_at ?? 0) * 1000,
        turnStarts,
        messageCount,
        firstPrompt,
      })
      void model
    }

    return {
      sourceId: identity.sourceId,
      provider: identity.provider,
      providerLabel: identity.providerLabel,
      user: identity.user,
      profile: null,
      sessions: summaries,
      diagnostics: { unknownPartCounts: {}, invariantViolations: [] },
    }
  },

  async loadSession({ manifest, fetchFile }, sessionId) {
    const identity = sourceIdentity(manifest, 'qwen', 'Qwen')
    const exportFile = manifest.files.find((f) => CHAT_EXPORT.test(f.path))
    if (!exportFile) return null

    const text = new TextDecoder().decode(await fetchFile(exportFile.path))
    const conversations = readExport(text)
    const convo = conversations.find((c) => c.id === sessionId)
    if (!convo) return null

    const messages = convo.chat?.history?.messages ?? {}
    const chain = activeChain(messages)
    if (!chain.length) return null

    const model = modelFromMessages(messages)
    const drafts: NodeDraft[] = []
    let previousRole: string | null = null

    for (const msg of chain) {
      const at = (msg.timestamp ?? 0) * 1000
      const hasContent = msg.role === 'user' ? !!msg.content?.trim() : !!assistantText(msg).trim()
      if (!hasContent) continue

      if (msg.role === 'user') {
        drafts.push({
          id: msg.id,
          at,
          role: 'user',
          parts: [truncatedText(msg.content)],
        })
        previousRole = 'user'
      } else {
        const responseText = assistantText(msg)
        const parts: Part[] = []
        if (responseText) parts.push(truncatedText(responseText))
        if (!parts.length) continue
        drafts.push({
          id: msg.id,
          at,
          role: 'assistant',
          model,
          parts,
        })
        previousRole = 'assistant'
      }
    }
    void previousRole

    if (!drafts.length) return null

    return buildTrajectory({
      identity,
      rawId: convo.id,
      title: convo.title || '(untitled)',
      startedAt: (convo.created_at ?? 0) * 1000,
      updatedAt: (convo.updated_at ?? 0) * 1000,
      drafts,
    })
  },

  piiHints: ['user_id'],
}
