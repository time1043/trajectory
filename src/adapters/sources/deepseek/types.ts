/** Raw shapes of the DeepSeek official export — visible only inside this adapter */

export interface RawUser {
  user_id: string
  email: string
  mobile: { mobile_number: string; area_code: string }
  oauth_profiles: { provider: string; profile_json: string }[]
}

export type RawFragmentType =
  | 'REQUEST'
  | 'RESPONSE'
  | 'THINK'
  | 'FILE'
  | 'SEARCH'
  | 'TOOL_SEARCH'
  | 'TOOL_OPEN'
  | (string & {})

export interface RawWebResult {
  url: string
  title: string
}
export interface RawFileRef {
  file_id: string
  file_name: string
  file_size: number
}

export interface RawFragment {
  type: RawFragmentType
  content?: string
  results?: RawWebResult[]
  files?: RawFileRef[]
  [key: string]: unknown
}

export interface RawMessage {
  model: string
  inserted_at: string
  fragments: RawFragment[]
}

export interface RawMappingNode {
  id: string
  parent: string | null
  children: string[]
  message: RawMessage | null
}

export interface RawConversation {
  id: string
  title: string
  inserted_at: string
  updated_at: string
  mapping: Record<string, RawMappingNode>
}
