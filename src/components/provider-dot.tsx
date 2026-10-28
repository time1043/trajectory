/**
 * provider 品牌色映射（展示层 token，不进 domain/adapters）。
 * antfu 式纪律：颜色只出现在"数据"上 —— UI chrome 永远单色。
 */
const PROVIDER_COLORS: Record<string, string> = {
  deepseek: '#4D6BFE',
  openai: '#10A37F',
  chatgpt: '#10A37F',
  claude: '#D97757',
  anthropic: '#D97757',
  local: '#A3A3A3',
}

export default function ProviderDot({ sourceId, className = '' }: { sourceId: string, className?: string }) {
  const color = PROVIDER_COLORS[sourceId.toLowerCase()] ?? '#A3A3A3'
  return (
    <span
      aria-hidden
      className={`inline-block size-2 shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: color }}
    />
  )
}
