import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Highlighter } from 'shiki'
import { isValidElement, useEffect, useState, type ReactNode } from 'react'

import type { WebResult } from '@/domain/model/part'
import CitationSup from './citation-sup'
import { CitationContext, remarkCitations, type CitationContextValue } from './remark-citations'

/**
 * markdown 渲染（react-markdown + gfm + 手写 prose 样式 + shiki 懒高亮）。
 * shiki 经动态 import 拆到独立 chunk，首个代码块渲染时才加载；
 * 高亮前先渲染纯 pre，加载完成后原位替换，不阻塞文档流。
 */

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter() {
  highlighterPromise ??= import('shiki').then(shiki =>
    shiki.createHighlighter({
      themes: ['github-light', 'github-dark'],
      langs: [
        'typescript', 'javascript', 'tsx', 'jsx', 'python', 'bash', 'json',
        'css', 'html', 'markdown', 'yaml', 'sql', 'go', 'rust', 'java',
        'kotlin', 'swift', 'dart', 'c', 'cpp', 'diff', 'shell',
      ],
    }),
  )
  return highlighterPromise
}

function extractCode(children: ReactNode): { code: string, lang: string | undefined } {
  if (isValidElement<{ className?: string, children?: ReactNode }>(children)) {
    const className = children.props.className ?? ''
    const lang = /language-([\w-]+)/.exec(className)?.[1]
    const code = String(children.props.children ?? '').replace(/\n$/, '')
    return { code, lang }
  }
  return { code: '', lang: undefined }
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const { code, lang } = extractCode(children)
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const highlighter = await getHighlighter()
        const out = highlighter.codeToHtml(code, {
          lang: lang ?? 'text',
          themes: { light: 'github-light', dark: 'github-dark' },
          defaultColor: false,
        })
        if (alive)
          setHtml(out)
      }
      catch {
        // 未支持的语言/主题加载失败 → 保持纯文本 pre
      }
    })()
    return () => {
      alive = false
    }
  }, [code, lang])

  if (html)
    return <div dangerouslySetInnerHTML={{ __html: html }} />
  return <pre><code>{code}</code></pre>
}

export default function MarkdownRenderer({ text, window, references }: {
  text: string
  window: readonly WebResult[] | undefined
  references: readonly WebResult[]
}) {
  const context: CitationContextValue = { window, references }
  return (
    <CitationContext.Provider value={context}>
      <div className="md">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkCitations]}
          components={{
            sup: CitationSup,
            pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noreferrer">{children}</a>
            ),
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
    </CitationContext.Provider>
  )
}
