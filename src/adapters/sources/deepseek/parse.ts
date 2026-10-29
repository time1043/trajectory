import type { MessageNode } from '@/domain/model/message-node'
import type { Part, WebResult } from '@/domain/model/part'
import type { PersonaProfile, ParsedSource, Trajectory } from '@/domain/model/trajectory'
import type { SourceManifest } from '@/domain/ports/data-host'
import type { SourceIdentity } from '@/domain/ports/source-adapter'

import { trajectoryId } from '@/domain/model/identity'
import { defaultActivePath } from '@/domain/services/turn-builder'

import type { RawConversation, RawFragment, RawUser } from './types'

const CONVERSATIONS_FILE = 'conversations.json'
const USER_FILE = 'user.json'

// Data audit: user/assistant fragments never mix within one message
function roleOf(fragments: RawFragment[]): MessageNode['role'] {
  return fragments.some((f) => f.type === 'REQUEST' || f.type === 'FILE') ? 'user' : 'assistant'
}

function toPart(fragment: RawFragment): Part {
  switch (fragment.type) {
    case 'REQUEST':
    case 'RESPONSE':
      return { kind: 'text', text: fragment.content ?? '' }
    case 'THINK':
      return { kind: 'reasoning', text: fragment.content ?? '' }
    case 'FILE':
      return {
        kind: 'attachment',
        files: (fragment.files ?? []).map((f) => ({
          fileId: f.file_id,
          fileName: f.file_name,
          fileSize: f.file_size,
        })),
      }
    case 'SEARCH':
    case 'TOOL_SEARCH':
      return { kind: 'search', results: (fragment.results ?? []) as WebResult[] }
    case 'TOOL_OPEN':
      return { kind: 'tool-call', tool: 'open' }
    default:
      return { kind: 'unknown', rawType: String(fragment.type) }
  }
}

function toEpochMs(iso: string): number {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? 0 : ms
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  return `${local.slice(0, 3)}****@${domain}`
}

function maskPhone(phone: string): string {
  return phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-3)}` : '***'
}

function safeParse(json: string): { name?: string } | undefined {
  try {
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

function safeParseUser(json: string): RawUser | undefined {
  try {
    return JSON.parse(json) as RawUser
  } catch {
    return undefined
  }
}

function buildProfile(raw: RawUser | undefined): PersonaProfile | null {
  if (!raw) return null
  const oauthName = raw.oauth_profiles
    ?.map((p) => safeParse(p.profile_json))
    .find((profile) => !!profile?.name)?.name as string | undefined
  return {
    displayName: oauthName ?? (raw.user_id ? raw.user_id.slice(0, 8) : 'unknown'),
    identifiers: [
      ...(raw.email ? [maskEmail(raw.email)] : []),
      ...(raw.mobile?.mobile_number ? [maskPhone(raw.mobile.mobile_number)] : []),
    ],
  }
}

export function parseDeepseek(
  manifest: SourceManifest,
  files: Map<string, ArrayBuffer>,
  identity: SourceIdentity,
): ParsedSource {
  const conversationsPath = manifest.files.find((f) => f.path.endsWith(CONVERSATIONS_FILE))?.path
  const conversationsRaw = conversationsPath ? files.get(conversationsPath) : undefined
  if (!conversationsPath || !conversationsRaw)
    throw new Error('deepseek: conversations.json not found in manifest')

  const conversations = JSON.parse(new TextDecoder().decode(conversationsRaw)) as RawConversation[]
  const userPath = manifest.files.find((f) => f.path.endsWith(USER_FILE))?.path
  const userRaw = userPath ? files.get(userPath) : undefined
  const profile = buildProfile(
    userRaw ? safeParseUser(new TextDecoder().decode(userRaw)) : undefined,
  )

  const unknownPartCounts: Record<string, number> = {}
  const invariantViolations: string[] = []
  const trajectories: Trajectory[] = []

  for (const raw of conversations) {
    const nodes = new Map<string, MessageNode>()

    for (const [nodeId, rawNode] of Object.entries(raw.mapping)) {
      if (!rawNode.message || nodeId === 'root') continue
      const parts = rawNode.message.fragments.map(toPart)
      for (const part of parts) {
        if (part.kind === 'unknown')
          unknownPartCounts[part.rawType] = (unknownPartCounts[part.rawType] ?? 0) + 1
      }
      // childIds ascending by at (I4; normalized here, the export does not guarantee it)
      const childIds = [...rawNode.children].sort(
        (a, b) =>
          (raw.mapping[a]?.message ? toEpochMs(raw.mapping[a].message!.inserted_at) : 0) -
          (raw.mapping[b]?.message ? toEpochMs(raw.mapping[b].message!.inserted_at) : 0),
      )
      nodes.set(nodeId, {
        id: nodeId,
        // root's children become top-level nodes (I2: the sentinel is erased)
        parentId: rawNode.parent === 'root' || rawNode.parent === null ? null : rawNode.parent,
        childIds,
        role: roleOf(rawNode.message.fragments),
        model: rawNode.message.model || null,
        at: toEpochMs(rawNode.message.inserted_at),
        parts,
      })
    }

    const activePath = defaultActivePath(nodes)
    const startedAt = activePath.length
      ? (nodes.get(activePath[0])?.at ?? toEpochMs(raw.inserted_at))
      : toEpochMs(raw.inserted_at)

    trajectories.push({
      id: trajectoryId(identity.sourceId, raw.id),
      sourceId: identity.sourceId,
      title: raw.title || '(untitled)',
      startedAt,
      updatedAt: toEpochMs(raw.updated_at),
      nodes,
      activePath,
    })
  }

  return {
    sourceId: identity.sourceId,
    label: identity.label,
    profile,
    trajectories,
    diagnostics: { unknownPartCounts, invariantViolations },
  }
}
