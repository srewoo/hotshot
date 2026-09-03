import { useEffect, useMemo, useState } from 'preact/hooks'
import { expiredBefore, type HistoryEntry } from '../../storage/history-repo'
import { createSettingsRepo } from '../../storage/settings-repo'
import { chromeLocalArea } from '../../storage/token-repo'
import {
  allTags,
  filterEntries,
  formatBytes,
  selectRange,
  storageUsage,
  toggleSelected,
  type LibraryLayout,
} from '../../storage/library-query'
import { libraryApi } from './library-api'
import { downloadFile } from './download'
import { LibraryRow } from './LibraryRow'
import { LibraryPreview } from './LibraryPreview'

/**
 * Capture library (PRD FR-25, DESIGN §3.7).
 *
 * Dense and information-first — a table with monospace numerics, not a grid of
 * floating cards — with a grid mode for the times you are looking for a
 * picture rather than a row. Everything here is local: the search, the tags
 * and the export are all answers a hosted product would compute on a server,
 * and the reason they can be computed over twenty local rows is the same
 * reason there is no backend to leak.
 */

const settings = createSettingsRepo(chromeLocalArea())

export function Library() {
  const [entries, setEntries] = useState<readonly HistoryEntry[] | null>(null)
  const [query, setQuery] = useState('')
  const [favouritesOnly, setFavouritesOnly] = useState(false)
  const [tag, setTag] = useState<string | null>(null)
  const [layout, setLayout] = useState<LibraryLayout>('list')
  const [selected, setSelected] = useState<readonly string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const [preview, setPreview] = useState<HistoryEntry | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [undoable, setUndoable] = useState(0)

  async function refresh(): Promise<void> {
    // Retention is enforced on read as well as on write: a service worker that
    // never wakes would otherwise keep data past the window the user chose.
    const { retention } = await settings.read()
    void expiredBefore(retention, Date.now())
    setEntries(await libraryApi.list())
  }

  useEffect(() => {
    void refresh()
  }, [])

  const visible = useMemo(
    () => filterEntries(entries ?? [], { query, favouritesOnly, tag }),
    [entries, query, favouritesOnly, tag],
  )
  const usage = useMemo(() => storageUsage(entries ?? []), [entries])
  const tags = useMemo(() => allTags(entries ?? []), [entries])

  function pick(entry: HistoryEntry, event: MouseEvent): void {
    if (event.shiftKey && anchor) {
      setSelected(selectRange(visible, anchor, entry.id))
      return
    }
    setAnchor(entry.id)
    setSelected(toggleSelected(selected, entry.id))
  }

  async function save(entry: HistoryEntry): Promise<void> {
    const dataUrl = await libraryApi.read(entry.id)
    if (!dataUrl) return setNotice('That capture is no longer stored.')
    const blob = await (await fetch(dataUrl)).blob()
    downloadFile(blob, `${entry.title || 'capture'}.png`)
  }

  async function removeSelected(): Promise<void> {
    const ids = selected.length > 0 ? selected : []
    if (ids.length === 0) return
    const removed = await libraryApi.remove(ids)
    setSelected([])
    setUndoable(removed)
    setNotice(`${removed} capture${removed === 1 ? '' : 's'} deleted.`)
    await refresh()
  }

  async function undo(): Promise<void> {
    const restored = await libraryApi.undoRemove()
    setUndoable(0)
    setNotice(restored > 0 ? `${restored} restored.` : 'Nothing left to restore.')
    await refresh()
  }

  async function exportAll(): Promise<void> {
    const document_ = await libraryApi.exportAll()
    if (!document_) return setNotice('Could not export the library.')
    const blob = new Blob([JSON.stringify(document_, null, 2)], { type: 'application/json' })
    downloadFile(blob, `hotshot-library-${new Date().toISOString().slice(0, 10)}.json`)
  }

  async function importFile(file: File): Promise<void> {
    try {
      const imported = await libraryApi.importAll(JSON.parse(await file.text()))
      setNotice(
        imported > 0
          ? `${imported} capture${imported === 1 ? '' : 's'} imported.`
          : 'That file held no captures Hotshot could read.',
      )
      await refresh()
    } catch {
      setNotice('That file is not a Hotshot export.')
    }
  }

  if (entries === null) {
    return (
      <main style={{ padding: 24 }}>
        <p>Reading captures…</p>
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 1_000, padding: '28px 24px 64px' }}>
      <h1 style={{ fontSize: 20 }}>Library</h1>
      <p class="dim" style={{ fontSize: 12 }}>
        Stored on this machine only. Captures taken in an Incognito window are never written.{' '}
        <span class="num">
          {usage.count} capture{usage.count === 1 ? '' : 's'} · {formatBytes(usage.bytes)} ·{' '}
          {usage.favourites} favourite{usage.favourites === 1 ? '' : 's'}
        </span>
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '14px 0 8px' }}>
        <input
          type="search"
          value={query}
          placeholder="Search title, URL, host, tag or destination"
          aria-label="Search captures"
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          style={{ flex: '1 1 auto' }}
        />
        <button
          onClick={() => setFavouritesOnly(!favouritesOnly)}
          aria-pressed={favouritesOnly}
          class={favouritesOnly ? 'primary' : ''}
          title="Show only favourites"
        >
          ★
        </button>
        <button
          onClick={() => setLayout(layout === 'list' ? 'grid' : 'list')}
          title={layout === 'list' ? 'Switch to a grid of thumbnails' : 'Switch to a dense list'}
        >
          {layout === 'list' ? 'Grid' : 'List'}
        </button>
      </div>

      {tags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <button onClick={() => setTag(null)} aria-pressed={tag === null}>
            All
          </button>
          {tags.map((name) => (
            <button
              key={name}
              onClick={() => setTag(tag === name ? null : name)}
              aria-pressed={tag === name}
              class={tag === name ? 'primary' : ''}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '8px 0',
          borderTop: '1px solid var(--hs-border)',
        }}
      >
        <span class="dim" style={{ fontSize: 11 }}>
          {selected.length > 0 ? `${selected.length} selected` : `${visible.length} shown`}
        </span>
        <button onClick={() => void removeSelected()} disabled={selected.length === 0}>
          Delete
        </button>
        {undoable > 0 && (
          // Bulk delete with no way back is how a library loses an afternoon.
          <button class="primary" onClick={() => void undo()}>
            Undo delete
          </button>
        )}
        <span style={{ flex: '1 1 auto' }} />
        <button onClick={() => void exportAll()}>Export all</button>
        <label class="row" style={{ gap: 4, cursor: 'pointer' }}>
          <span>Import</span>
          <input
            type="file"
            accept="application/json"
            style={{ width: 120 }}
            onChange={(e) => {
              const file = (e.target as HTMLInputElement).files?.[0]
              if (file) void importFile(file)
            }}
          />
        </label>
      </div>

      {notice && (
        <p class="dim" style={{ fontSize: 11 }} role="status">
          {notice}
        </p>
      )}

      {visible.length === 0 ? (
        <p style={{ marginTop: 20 }}>
          {entries.length === 0 ? (
            <>
              No captures yet. Press <kbd>⌘⇧1</kbd> on any page to take one.
            </>
          ) : (
            <>Nothing matches that search.</>
          )}
        </p>
      ) : (
        <div
          style={
            layout === 'grid'
              ? {
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                  gap: 12,
                  marginTop: 12,
                }
              : { marginTop: 12 }
          }
        >
          {visible.map((entry) => (
            <LibraryRow
              key={entry.id}
              entry={entry}
              layout={layout}
              selected={selected.includes(entry.id)}
              onPick={(event) => pick(entry, event)}
              onPreview={() => setPreview(entry)}
              onSave={() => void save(entry)}
              onFavourite={async () => {
                await libraryApi.toggleFavourite(entry.id)
                await refresh()
              }}
              onTag={async (name, add) => {
                await libraryApi.tag(entry.id, name, add)
                await refresh()
              }}
              onReopen={async () => setNotice(await libraryApi.reopen(entry.id))}
              onPin={async () => setNotice(await libraryApi.pin(entry.id))}
              onResend={async () => {
                setNotice(`Sending to ${entry.destination?.provider ?? 'the destination'}…`)
                const failure = await libraryApi.resend(entry.id)
                setNotice(failure ?? 'Sent again.')
              }}
            />
          ))}
        </div>
      )}

      {preview && <LibraryPreview entry={preview} onClose={() => setPreview(null)} />}
    </main>
  )
}
