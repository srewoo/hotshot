import { useEffect, useState } from 'preact/hooks'
import type { HistoryEntry } from '../../storage/history-repo'
import { formatBytes } from '../../storage/library-query'
import { libraryApi } from './library-api'

/**
 * Full-size preview (PRD FR-25).
 *
 * A dialog rather than a new tab: the library is already a tab, and sending
 * someone to a second one to look at their own capture is the app-switch this
 * product exists to remove.
 */
export function LibraryPreview({
  entry,
  onClose,
}: {
  readonly entry: HistoryEntry
  onClose(): void
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void libraryApi.read(entry.id).then((url) => {
      if (live) setDataUrl(url)
    })
    return () => {
      live = false
    }
  }, [entry.id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-label={`Preview of ${entry.title || 'capture'}`}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6,6,5,0.72)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        zIndex: 10,
      }}
    >
      <figure
        onClick={(event) => event.stopPropagation()}
        style={{
          margin: 0,
          maxWidth: '100%',
          maxHeight: '100%',
          display: 'grid',
          gap: 8,
          background: 'var(--hs-bg, #fff)',
          padding: 12,
          borderRadius: 'var(--hs-r-2)',
        }}
      >
        {dataUrl ? (
          <img
            src={dataUrl}
            alt=""
            // Scrolls inside its own box rather than making the page scroll.
            style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <p>Reading capture…</p>
        )}
        <figcaption class="row" style={{ gap: 10 }}>
          <span class="dim num" style={{ fontSize: 11 }}>
            {entry.widthDevicePx}×{entry.heightDevicePx} · {formatBytes(entry.bytes)}
          </span>
          <button onClick={onClose}>Close</button>
        </figcaption>
      </figure>
    </div>
  )
}
