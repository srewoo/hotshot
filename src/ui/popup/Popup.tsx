import { useEffect, useState } from 'preact/hooks'
import type { CaptureMode } from '../../shared/messaging/protocol'
import { restrictionFor } from '../../worker/restricted-page'

/**
 * The popup (DESIGN §3.5): a list, not a card. Its job is to say what the
 * shortcuts are and to give a mouse path to the same four modes.
 */

const MODES: ReadonlyArray<{ mode: CaptureMode; label: string; keyHint: string }> = [
  { mode: 'region', label: 'Region', keyHint: '⌘⇧1' },
  { mode: 'fullpage', label: 'Full page', keyHint: '⌘⇧2' },
  { mode: 'element', label: 'Element', keyHint: '⌘⇧3' },
]

export function Popup() {
  const [blocked, setBlocked] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

      // `tab.url` is only populated with the `tabs` permission, which Hotshot
      // deliberately does not request — it carries a "read your browsing
      // history" warning at install and the privacy claim is worth more than
      // this convenience. So an ABSENT url means "cannot tell", and the modes
      // stay available; the worker reports a real restriction on the badge and
      // in a notification when the capture is actually attempted (FR-30).
      setBlocked(tab?.url ? (restrictionFor(tab.url)?.message ?? null) : null)
    })()
  }, [])

  async function capture(mode: CaptureMode) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id === undefined) return
    await chrome.runtime.sendMessage({ kind: 'popup/capture', mode, tabId: tab.id })
    window.close()
  }

  return (
    <div style={{ width: 268 }}>
      <div style={{ padding: '12px 14px 10px' }}>
        <h1>Hotshot</h1>
        <p style={{ margin: 0, fontSize: 11 }}>
          {blocked ? 'Not available here' : 'Capture the current page'}
        </p>
      </div>

      {blocked ? (
        <div style={{ padding: '0 14px 14px' }}>
          <p class="err" style={{ fontSize: 11, margin: 0 }}>{blocked}</p>
        </div>
      ) : (
        <div style={{ borderTop: '1px solid var(--hs-border)' }}>
          {MODES.map(({ mode, label, keyHint }) => (
            <button
              key={mode}
              class="row"
              onClick={() => void capture(mode)}
              style={{
                width: '100%', background: 'none', border: 0,
                borderBottom: '1px solid var(--hs-border)', borderRadius: 0,
                textAlign: 'left', font: '500 12px/1 var(--hs-sans)',
              }}
            >
              <span>{label}</span>
              <kbd>{keyHint}</kbd>
            </button>
          ))}
        </div>
      )}

      <div class="row" style={{ borderTop: '1px solid var(--hs-border)' }}>
        <span style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => void chrome.runtime.openOptionsPage()}>Settings</button>
          <button
            onClick={() =>
              void chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/library/index.html') })
            }
          >
            Library
          </button>
        </span>
        <span class="dim num" style={{ fontSize: 10 }}>
          {chrome.runtime.getManifest().version}
        </span>
      </div>
    </div>
  )
}
