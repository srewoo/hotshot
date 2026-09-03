import { useEffect, useState } from 'preact/hooks'
import type { CaptureMode } from '../../shared/messaging/protocol'
import { restrictionFor } from '../../worker/restricted-page'
import { DELAY_CHOICES, delayLabel, type DelaySeconds } from '../../shared/delay'
import {
  DEFAULT_RECORD_OPTIONS,
  describeOptions,
  type RecordOptions,
} from '../../content/record/record-options'

/**
 * The popup (DESIGN §3.5): a list, not a card. Its job is to say what the
 * shortcuts are and to give a mouse path to the same four modes.
 */

const MODES: ReadonlyArray<{ mode: CaptureMode; label: string; keyHint: string }> = [
  { mode: 'region', label: 'Region', keyHint: '⌘⇧1' },
  { mode: 'fullpage', label: 'Full page', keyHint: '⌘⇧2' },
  { mode: 'element', label: 'Element', keyHint: '⌘⇧3' },
]

/**
 * Recording has no keyboard shortcut: Chrome allows four suggested keys and
 * all four go to capture (FR-27). It also needs a real click — `getDisplayMedia`
 * requires a user gesture, and the popup click is one.
 */
const RECORD_MODES: ReadonlyArray<{ mode: 'video' | 'gif'; label: string; note: string }> = [
  { mode: 'video', label: 'Record video', note: 'WebM · up to 5 min' },
  { mode: 'gif', label: 'Record GIF', note: 'up to 60s' },
]

export function Popup() {
  const [blocked, setBlocked] = useState<string | null>(null)
  /**
   * Per capture, and deliberately not persisted (FR-4): the popup opens fresh
   * each time, so a delay chosen for one capture cannot ambush the next.
   */
  const [delaySeconds, setDelaySeconds] = useState<DelaySeconds>(0)
  /**
   * What a recording captures beyond the screen.
   *
   * Off by default and chosen per recording. Anything else would mean the
   * microphone could be live because of a decision made last Tuesday.
   */
  const [recordOptions, setRecordOptions] = useState<RecordOptions>(DEFAULT_RECORD_OPTIONS)

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

  function record(mode: 'video' | 'gif') {
    void chrome.runtime.sendMessage({ kind: 'popup/record', mode, options: recordOptions })
    window.close()
  }

  const RECORD_TOGGLES: ReadonlyArray<{
    key: keyof RecordOptions
    label: string
    title: string
  }> = [
    { key: 'tabAudio', label: 'Tab audio', title: 'Record this tab’s sound' },
    { key: 'microphone', label: 'Mic', title: 'Record your microphone for a voice-over' },
    { key: 'webcam', label: 'Camera', title: 'Composite a camera bubble into the corner' },
  ]

  function capture(mode: CaptureMode) {
    // Deliberately NOT awaited. The worker sends no reply, so awaiting would
    // hang on a closed message port and the popup would never close — leaving
    // it open over the very page being captured.
    void chrome.runtime.sendMessage({ kind: 'popup/capture', mode, delaySeconds })
    // The overlay cannot appear until the popup is gone; it steals focus.
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
              onClick={() => capture(mode)}
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

      {blocked ? null : (
        <div
          class="row"
          style={{ borderTop: '1px solid var(--hs-border)', gap: 8 }}
        >
          <span style={{ font: '500 11px/1 var(--hs-sans)' }}>Delay</span>
          <span style={{ display: 'flex', gap: 4 }} role="group" aria-label="Capture delay">
            {DELAY_CHOICES.map((choice) => (
              <button
                key={choice}
                onClick={() => setDelaySeconds(choice)}
                aria-pressed={delaySeconds === choice}
                title={
                  choice === 0
                    ? 'Capture immediately'
                    : `Wait ${choice} seconds, counting down on the toolbar icon`
                }
                style={{
                  font: '500 10px/1 var(--hs-mono)',
                  padding: '4px 6px',
                  background: delaySeconds === choice ? 'var(--hs-flare)' : 'transparent',
                  color: delaySeconds === choice ? '#fff' : 'inherit',
                }}
              >
                {delayLabel(choice)}
              </button>
            ))}
          </span>
        </div>
      )}

      {blocked ? null : (
        <div
          class="row"
          style={{ borderTop: '1px solid var(--hs-border)', gap: 6, flexWrap: 'wrap' }}
        >
          <span
            style={{ font: '500 11px/1 var(--hs-sans)', width: '100%' }}
            title={describeOptions(recordOptions)}
          >
            Recording captures {describeOptions(recordOptions)}
          </span>
          <span style={{ display: 'flex', gap: 4 }} role="group" aria-label="Recording sources">
            {RECORD_TOGGLES.map(({ key, label, title }) => (
              <button
                key={key}
                title={title}
                aria-pressed={recordOptions[key]}
                onClick={() =>
                  setRecordOptions({ ...recordOptions, [key]: !recordOptions[key] })
                }
                style={{
                  font: '500 10px/1 var(--hs-sans)',
                  padding: '4px 6px',
                  background: recordOptions[key] ? 'var(--hs-flare)' : 'transparent',
                  color: recordOptions[key] ? '#fff' : 'inherit',
                }}
              >
                {label}
              </button>
            ))}
          </span>
        </div>
      )}

      {blocked ? null : (
        <div style={{ borderTop: '1px solid var(--hs-border)' }}>
          {RECORD_MODES.map(({ mode, label, note }) => (
            <button
              key={mode}
              class="row"
              onClick={() => record(mode)}
              style={{
                width: '100%', background: 'none', border: 0,
                borderBottom: '1px solid var(--hs-border)', borderRadius: 0,
                textAlign: 'left', font: '500 12px/1 var(--hs-sans)',
              }}
            >
              <span>{label}</span>
              <span class="dim" style={{ fontSize: 10 }}>{note}</span>
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
