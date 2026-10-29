/**
 * Provider brand colors (display-layer tokens, never domain/adapters).
 * antfu discipline: color only appears on "data" — UI chrome stays monochrome.
 */
export const PROVIDER_COLORS: Record<string, string> = {
  // Major models & labs
  deepseek: '#4D6BFE',
  openai: '#10A37F',
  chatgpt: '#10A37F',
  claude: '#D97757',
  anthropic: '#D97757',
  qwen: '#615CED',
  gemini: '#4285F4',
  google: '#4285F4',
  mistral: '#FF7000',
  meta: '#0668E1',
  llama: '#0668E1',

  // Coding agents & CLI tools
  codex: '#10A37F',
  opencode: '#06B6D4',
  pi: '#F59E0B',
  zcode: '#8B5CF6',
  cursor: '#3B82F6',
  copilot: '#238636',
  github: '#238636',

  // Fallbacks
  local: '#A3A3A3',
}

export function resolveProviderColor(sourceId: string): string {
  const normalized = sourceId.trim().toLowerCase()
  if (PROVIDER_COLORS[normalized] && normalized !== 'local') {
    return PROVIDER_COLORS[normalized]
  }

  // Match segmented path or compound names (e.g. "web/qwen-166543499...", "local/opencode-oswin-m4a")
  const tokens = normalized.split(/[/_:\s-]+/).filter(Boolean)
  for (const token of tokens) {
    if (PROVIDER_COLORS[token] && token !== 'local') {
      return PROVIDER_COLORS[token]
    }
  }

  return PROVIDER_COLORS[normalized] ?? '#A3A3A3'
}

export default function ProviderDot({
  sourceId,
  className = '',
}: {
  sourceId: string
  className?: string
}) {
  const color = resolveProviderColor(sourceId)
  return (
    <span
      aria-hidden
      className={`inline-block size-2 shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: color }}
    />
  )
}
