import { useContext } from 'react'

import type { ResolvedCitation } from '@/domain/services/document-view'

import { resolveCitation } from '@/domain/services/document-view'

import { CitationContext } from './remark-citations'

type MdSupProps = React.ClassAttributes<HTMLElement> &
  React.HTMLAttributes<HTMLElement> & { node?: unknown }

/** Citation rendering: window resolution -> stable registry number; degraded plain marker when unresolvable */
export default function CitationSup(props: MdSupProps) {
  const context = useContext(CitationContext)
  const raw = (props as { 'data-citation'?: string })['data-citation']
  const n = Number(raw)
  const resolved: ResolvedCitation | null = Number.isInteger(n)
    ? resolveCitation(n, context.window, context.references)
    : null

  if (!resolved) return <sup className="citation text-low">[{raw}]</sup>

  return (
    <sup className="citation">
      <a
        href={`#ref-${resolved.refIndex}`}
        title={resolved.result.title || resolved.result.url}
        onClick={(e) => {
          e.preventDefault()
          document
            .getElementById(`ref-${resolved.refIndex}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }}
      >
        {resolved.refIndex}
      </a>
    </sup>
  )
}
