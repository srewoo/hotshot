import { useEffect, useState } from 'preact/hooks'
import type { HistoryEntry } from '../../storage/history-repo'
import { formatBytes, type LibraryLayout } from '../../storage/library-query'
import { libraryApi } from './library-api'

/**
 * One capture in the library (PRD FR-25).
 *
 * The thumbnail is loaded lazily and per row, not eagerly for the whole list:
 * twenty full-resolution captures decoded at once is exactly the memory PRD §6
 * budgets against, and the store deliberately hands out blobs one at a time.
 */

function formatWhen(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16)
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url.slice(0, 40)
  }
}

export interface LibraryRowProps {
  readonly entry: HistoryEntry
  readonly layout: LibraryLayout
  readonly selected: boolean
  onPick(event: MouseEvent): void
  onPreview(): void
  onSave(): void
  onFavourite(): void
  onTag(tag: string, add: boolean): void
  onReopen(): void
  onPin(): void
  onResend(): void
}

export function LibraryRow(props: LibraryRowProps) {
  const { entry, layout, selected } = props
  const [thumb, setThumb] = useState<string | null>(null)
  const [tagging, setTagging] = useState(false)

  useEffect(() => {
    let live = true
    void libraryApi.read(entry.id).then((dataUrl) => {
      if (live) setThumb(dataUrl)
    })
    return () => {
      live = false
    }
  }, [entry.id])

  const actions = (
    <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      <button onClick={props.onPreview} title="View full size">
        View
      </button>
      <button onClick={props.onReopen} title="Open in the editor on the active tab">
        Edit
      </button>
      <button onClick={props.onPin} title="Pin onto the active tab">
        Pin
      </button>
      {entry.destination && (
        // Only offered when there IS somewhere to send it: a button that
        // needed a destination chosen first would be a button that fails.
        <button
          onClick={props.onResend}
          title={`Send again to ${entry.destination.provider} ${entry.destination.key}`}
        >
          Send again
        </button>
      )}
      <button onClick={props.onSave} title="Save a PNG">
        Save
      </button>
      <button
        onClick={props.onFavourite}
        aria-pressed={entry.favourite === true}
        title={entry.favourite ? 'Remove from favourites' : 'Keep past the retention window'}
      >
        {entry.favourite ? '★' : '☆'}
      </button>
      <button onClick={() => setTagging(!tagging)} title="Add a local tag">
        Tag
      </button>
    </span>
  )

  const meta = (
    <span class="dim num" style={{ fontSize: 10 }}>
      {entry.widthDevicePx}×{entry.heightDevicePx} · {formatBytes(entry.bytes)} ·{' '}
      {formatWhen(entry.capturedAt)}
      {entry.destination ? ` · ${entry.destination.provider} ${entry.destination.key}` : ''}
    </span>
  )

  const tagRow = (
    <span style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      {(entry.tags ?? []).map((name) => (
        <button
          key={name}
          onClick={() => props.onTag(name, false)}
          title="Remove this tag"
          style={{ fontSize: 10 }}
        >
          {name} ×
        </button>
      ))}
      {tagging && (
        <input
          type="text"
          autofocus
          placeholder="tag"
          aria-label="New tag"
          style={{ width: 90, fontSize: 11 }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            props.onTag((e.target as HTMLInputElement).value, true)
            setTagging(false)
          }}
          onBlur={() => setTagging(false)}
        />
      )}
    </span>
  )

  if (layout === 'grid') {
    return (
      <figure
        style={{
          margin: 0,
          border: `1px solid ${selected ? 'var(--hs-flare)' : 'var(--hs-border)'}`,
          borderRadius: 'var(--hs-r-2)',
          padding: 8,
          display: 'grid',
          gap: 6,
        }}
      >
        <button
          onClick={props.onPick}
          title="Select"
          style={{
            padding: 0,
            border: 0,
            background: 'var(--hs-sunken, #eee)',
            aspectRatio: '4 / 3',
            overflow: 'hidden',
            borderRadius: 2,
          }}
        >
          {thumb ? (
            <img
              src={thumb}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : null}
        </button>
        <figcaption style={{ display: 'grid', gap: 4 }}>
          <strong style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {entry.title || hostOf(entry.sourceUrl)}
          </strong>
          {meta}
          {tagRow}
          {actions}
        </figcaption>
      </figure>
    )
  }

  return (
    <div
      class="row"
      style={{
        gap: 10,
        alignItems: 'center',
        borderTop: '1px solid var(--hs-border)',
        background: selected ? 'rgba(255,90,0,0.06)' : 'transparent',
      }}
    >
      <button
        onClick={props.onPick}
        title="Select"
        style={{ padding: 0, border: 0, background: 'transparent', width: 72, flex: '0 0 auto' }}
      >
        {thumb ? (
          <img
            src={thumb}
            alt=""
            style={{
              width: 72,
              height: 48,
              objectFit: 'cover',
              display: 'block',
              border: `1px solid ${selected ? 'var(--hs-flare)' : 'var(--hs-border)'}`,
              borderRadius: 2,
            }}
          />
        ) : (
          <span style={{ display: 'block', width: 72, height: 48 }} />
        )}
      </button>

      <span style={{ display: 'grid', gap: 2, flex: '1 1 auto', minWidth: 0 }}>
        <strong style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {entry.title || hostOf(entry.sourceUrl)}
        </strong>
        <span class="dim" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {hostOf(entry.sourceUrl)}
        </span>
        {meta}
        {tagRow}
      </span>

      {actions}
    </div>
  )
}
