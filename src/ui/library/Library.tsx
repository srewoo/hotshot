import { useEffect, useState } from 'preact/hooks'
import { createHistoryRepo, expiredBefore, type HistoryEntry } from '../../storage/history-repo'
import { createSettingsRepo } from '../../storage/settings-repo'
import { chromeLocalArea } from '../../storage/token-repo'
import { idbHistoryStore } from '../../storage/idb-history'
import { downloadFile } from './download'

/**
 * Capture library (DESIGN §3.7): a table with monospace numerics, not a grid
 * of floating cards. Dense and information-first.
 */

const store = idbHistoryStore()
const history = createHistoryRepo(store)
const settings = createSettingsRepo(chromeLocalArea())

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatWhen(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16)
}

export function Library() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)

  async function refresh() {
    // Retention is enforced on read as well as on write: a service worker that
    // never wakes would otherwise keep data past the window the user chose.
    const { retention } = await settings.read()
    await history.prune(expiredBefore(retention, Date.now()))
    setEntries(await history.list())
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function save(entry: HistoryEntry) {
    const blob = await store.blobFor(entry.id)
    if (blob) downloadFile(blob, `${entry.title || 'capture'}.png`)
  }

  async function remove(id: string) {
    await history.remove(id)
    await refresh()
  }

  if (entries === null) {
    return <main style={{ padding: 24 }}><p>Reading captures…</p></main>
  }

  return (
    <main style={{ maxWidth: 760, padding: '28px 24px 64px' }}>
      <h1 style={{ fontSize: 20 }}>Library</h1>
      <p>
        The last 20 captures, stored on this machine only. Captures taken in an Incognito window
        are never recorded.
      </p>

      {entries.length === 0 ? (
        <div
          style={{
            border: '1px solid var(--hs-border)',
            borderRadius: 'var(--hs-r-2)',
            padding: '28px 18px',
          }}
        >
          <strong style={{ fontSize: 13 }}>No captures yet</strong>
          <p style={{ margin: '6px 0 0', fontSize: 12 }}>
            Press <kbd>⌘⇧1</kbd> on any page to take one.
          </p>
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--hs-ink-dim)' }}>
              <th style={{ padding: '6px 8px', fontWeight: 600 }}>Page</th>
              <th style={{ padding: '6px 8px', fontWeight: 600 }}>Captured</th>
              <th style={{ padding: '6px 8px', fontWeight: 600 }}>Size</th>
              <th style={{ padding: '6px 8px', fontWeight: 600 }}>Bytes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} style={{ borderTop: '1px solid var(--hs-border)' }}>
                <td style={{ padding: '8px', maxWidth: 260 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {entry.title || entry.sourceUrl}
                  </div>
                  <div class="dim" style={{ fontSize: 11 }}>{new URL(entry.sourceUrl).hostname}</div>
                </td>
                <td class="num" style={{ padding: '8px' }}>{formatWhen(entry.capturedAt)}</td>
                <td class="num" style={{ padding: '8px' }}>
                  {entry.widthDevicePx}×{entry.heightDevicePx}
                </td>
                <td class="num" style={{ padding: '8px' }}>{formatBytes(entry.bytes)}</td>
                <td style={{ padding: '8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => void save(entry)}>Save</button>{' '}
                  <button onClick={() => void remove(entry.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {entries.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <button
            onClick={() => {
              void history.clear().then(refresh)
            }}
          >
            Clear all
          </button>
        </div>
      ) : null}
    </main>
  )
}
