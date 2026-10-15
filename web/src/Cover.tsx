import { useState } from 'react'
import { coverUrl } from './library/openlibrary'

const SIZES = { S: 'h-16 w-11', M: 'h-24 w-16' } as const

/**
 * A book's Open Library cover, or a plain placeholder when it has none, the
 * image is missing (covers are requested with default=false, so that's a 404)
 * or the device is offline.
 */
export function Cover({ coverId, title, size = 'S' }: { coverId?: number; title: string; size?: keyof typeof SIZES }) {
  const [failedId, setFailedId] = useState<number>()
  const box = `${SIZES[size]} shrink-0 rounded-[var(--radius-sm)] border border-[var(--line)]`
  if (coverId === undefined || failedId === coverId) {
    return (
      <span
        aria-hidden
        className={`${box} display-font flex items-center justify-center bg-[var(--accent-soft)] text-lg text-[var(--accent-deep)]`}
      >
        {title.trim().charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={coverUrl(coverId, size)}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailedId(coverId)}
      className={`${box} bg-[var(--paper-deep)] object-cover`}
    />
  )
}
