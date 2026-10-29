import { useAtomValue, useSetAtom } from 'jotai'
import { useState } from 'react'

import { publishedIdsAtom, setPublishedAtom } from '@/app/stores/publish'

/**
 * Publish/unpublish one session. Published sessions are copied under
 * data-public/ — the dataset a static deployment serves. The state lives in
 * the public dataset itself (presence = published).
 */
export default function PublishToggle({
  provider,
  user,
  sessionId,
}: {
  provider: string
  user: string
  sessionId: string
}) {
  const publishedIds = useAtomValue(publishedIdsAtom)
  const setPublished = useSetAtom(setPublishedAtom)
  const [pending, setPending] = useState(false)

  const published = publishedIds.has(
    // the ':'-joined internal id never appears in a URL
    `${provider}:${user}:${sessionId}`,
  )

  const onClick = async () => {
    setPending(true)
    try {
      await setPublished({ provider, user, sessionId, publish: !published })
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={pending}
      className={`rounded-sm border px-1.5 py-0.5 font-mono text-[11px] transition-colors duration-200 disabled:opacity-50 ${
        published
          ? 'border-accent bg-accent-soft text-mid hover:text-hi'
          : 'border-line text-faint hover:text-mid'
      }`}
      title={
        published
          ? 'Published — click to unpublish'
          : 'Copy this session into data-public for static deployment'
      }
    >
      {pending ? '…' : published ? 'published' : 'publish'}
    </button>
  )
}
