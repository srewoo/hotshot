import { el, TOKENS } from '../overlay/overlay-chrome'
import { startRecording, type RecorderHandle } from './recorder'
import { HOTSHOT_HOST_ATTRIBUTE } from '../overlay/element-chain'
import type { RecordMode } from './recording-state'
import {
  DEFAULT_RECORD_OPTIONS,
  describeOptions,
  type RecordOptions,
} from './record-options'
import { mountTrimBar } from './trim-bar'

/**
 * The recording bar (PRD §10, v1.1).
 *
 * A single strip pinned bottom-centre: elapsed time, an estimated size, and
 * Stop. It stays deliberately plain — the user is recording their screen, and
 * anything animated here ends up in the recording.
 */

export async function mountRecordBar(
  mode: RecordMode,
  options: RecordOptions = DEFAULT_RECORD_OPTIONS,
): Promise<void> {
  const host = document.createElement('div')
  host.setAttribute(HOTSHOT_HOST_ATTRIBUTE, '')
  const root = host.attachShadow({ mode: 'closed' })

  const bar = el('div', {
    position: 'fixed',
    left: '50%',
    bottom: '24px',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 10px 8px 14px',
    borderRadius: '4px',
    background: TOKENS.graphite950,
    boxShadow: `0 0 0 1px ${TOKENS.ruleOuter}, 0 6px 16px rgba(0,0,0,.3)`,
    zIndex: '2147483646',
    font: `500 12px/1 ${TOKENS.sans}`,
    color: TOKENS.graphite25,
  })

  // A steady dot, not a pulsing one: a blinking element would appear in the
  // recording of any window that overlaps this bar.
  const dot = el('span', {
    width: '9px',
    height: '9px',
    borderRadius: '50%',
    background: TOKENS.flare,
    display: 'block',
  })

  const time = el('span', {
    font: `500 12px/1 ${TOKENS.mono}`,
    fontVariantNumeric: 'tabular-nums',
    minWidth: '38px',
  })
  time.textContent = '0:00'

  const size = el('span', {
    font: `400 11px/1 ${TOKENS.mono}`,
    color: TOKENS.graphite400,
    minWidth: '58px',
  })
  size.textContent = '~0 MB'

  function button(label: string, primary = false): HTMLButtonElement {
    const node = el('button', {
      font: `500 12px/1 ${TOKENS.sans}`,
      color: primary ? '#FFFFFF' : TOKENS.graphite25,
      background: primary ? TOKENS.flare : 'transparent',
      border: primary ? '0' : `1px solid ${TOKENS.ruleOuter}`,
      borderRadius: '3px',
      padding: '7px 11px',
      cursor: 'pointer',
    })
    node.type = 'button'
    node.textContent = label
    return node
  }

  /** What is being captured, so it is never a guess (record-options). */
  const what = el('span', {
    font: `400 11px/1 ${TOKENS.sans}`,
    color: TOKENS.graphite400,
    whiteSpace: 'nowrap',
  })
  what.textContent = describeOptions(options)

  const pause = button('Pause')
  const stop = button('Stop', true)
  const cancel = button('Discard')

  bar.append(dot, time, size, what, pause, stop, cancel)
  root.append(bar)
  document.documentElement.append(host)

  function teardown(): void {
    window.removeEventListener('keydown', onKey, true)
    host.remove()
  }

  const handle: RecorderHandle | null = await startRecording(
    mode,
    {
      onTick(label, bytes, paused) {
        time.textContent = label
        size.textContent = `~${(bytes / 1024 / 1024).toFixed(1)} MB`
        // The dot goes hollow rather than disappearing: an absent indicator
        // reads as "not recording", which is the one thing it must never
        // suggest while a share is still live.
        dot.style.background = paused ? 'transparent' : TOKENS.flare
        dot.style.boxShadow = paused ? `inset 0 0 0 2px ${TOKENS.flare}` : 'none'
        pause.textContent = paused ? 'Resume' : 'Pause'
      },
      onDone(result) {
        teardown()
        if (!result) return
        // Offered for trimming before it is saved: the first and last seconds
        // of a screen recording are almost always someone finding the record
        // button and then finding the stop button.
        void mountTrimBar(result)
      },
      onError(message) {
        console.error(`[Hotshot] ${message}`)
      },
    },
    options,
  )

  if (!handle) {
    // The user dismissed Chrome's surface picker — a normal outcome.
    teardown()
    return
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    handle?.stop()
  }

  stop.addEventListener('click', () => handle.stop())
  cancel.addEventListener('click', () => handle.cancel())
  pause.addEventListener('click', () => {
    if (handle.state() === 'paused') handle.resume()
    else handle.pause()
  })
  window.addEventListener('keydown', onKey, true)
}
