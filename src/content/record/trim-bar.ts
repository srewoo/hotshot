import { el, TOKENS } from '../overlay/overlay-chrome'
import { HOTSHOT_HOST_ATTRIBUTE } from '../overlay/element-chain'
import { downloadBlob } from '../download'
import { trimGif, trimVideo } from './recorder-trim'
import {
  clampRange,
  formatPosition,
  fullRange,
  isTrimmed,
  isUsableRange,
  rangeDurationMs,
  type TrimRange,
} from './trim'
import type { RecordingResult } from './recorder'

/**
 * The trim step, after a recording stops (PRD §10 v1.1).
 *
 * Offered rather than imposed: Save keeps the whole thing, and the two handles
 * are there for the common case where the first and last seconds are the user
 * finding the record button and then finding the stop button.
 *
 * It appears over the page rather than in a new tab, for the same reason the
 * editor does — the recording is about something on this page, and sending
 * someone away from it to make a ten-second edit is the app switch the whole
 * product exists to remove.
 */

const BAR_WIDTH_PX = 520

export async function mountTrimBar(result: RecordingResult): Promise<void> {
  const host = document.createElement('div')
  host.setAttribute(HOTSHOT_HOST_ATTRIBUTE, '')
  const root = host.attachShadow({ mode: 'closed' })

  const url = URL.createObjectURL(result.blob)
  let range: TrimRange = fullRange(result.durationMs)
  let saving = false

  const panel = el('div', {
    position: 'fixed',
    left: '50%',
    bottom: '24px',
    transform: 'translateX(-50%)',
    width: `${BAR_WIDTH_PX}px`,
    display: 'grid',
    gap: '8px',
    padding: '10px 12px',
    borderRadius: '4px',
    background: TOKENS.graphite950,
    boxShadow: `0 0 0 1px ${TOKENS.ruleOuter}, 0 6px 16px rgba(0,0,0,.3)`,
    zIndex: '2147483646',
    font: `500 12px/1 ${TOKENS.sans}`,
    color: TOKENS.graphite25,
  })

  /**
   * A preview, muted.
   *
   * Muted deliberately: the page may still be playing whatever was recorded,
   * and a preview that talks over it is disorienting.
   */
  const preview =
    result.extension === 'gif'
      ? (el('img', { width: '100%', borderRadius: '2px', display: 'block' }) as HTMLImageElement)
      : (el('video', { width: '100%', borderRadius: '2px', display: 'block' }) as HTMLVideoElement)
  preview.src = url
  if (preview instanceof HTMLVideoElement) {
    preview.muted = true
    preview.controls = true
  }

  const readout = el('span', {
    font: `400 11px/1 ${TOKENS.mono}`,
    color: TOKENS.graphite400,
  })

  function paintReadout(): void {
    const kept = rangeDurationMs(range)
    readout.textContent = isTrimmed(range, result.durationMs)
      ? `${formatPosition(range.startMs)} → ${formatPosition(range.endMs)} · keeping ${formatPosition(kept)}`
      : `full recording · ${formatPosition(result.durationMs)}`
  }

  function slider(label: string, value: number): HTMLInputElement {
    const input = el('input', { width: '100%' }) as HTMLInputElement
    input.type = 'range'
    input.min = '0'
    input.max = String(Math.max(1, Math.round(result.durationMs)))
    input.step = '50'
    input.value = String(Math.round(value))
    input.setAttribute('aria-label', label)
    return input
  }

  const start = slider('Trim start', 0)
  const end = slider('Trim end', result.durationMs)

  function onSlide(): void {
    // Clamped rather than constrained: dragging the out-point past the
    // in-point is a normal thing to do with two handles on one bar, and
    // swapping them is friendlier than refusing to move.
    range = clampRange({ startMs: Number(start.value), endMs: Number(end.value) }, result.durationMs)
    paintReadout()
    if (preview instanceof HTMLVideoElement) preview.currentTime = range.startMs / 1000
  }
  start.addEventListener('input', onSlide)
  end.addEventListener('input', onSlide)

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

  const save = button('Save', true)
  const discard = button('Discard')
  const row = el('div', { display: 'flex', alignItems: 'center', gap: '8px' })
  row.append(readout, el('span', { flex: '1 1 auto' }), save, discard)

  panel.append(preview, start, end, row)
  root.append(panel)
  document.documentElement.append(host)
  paintReadout()

  function teardown(): void {
    window.removeEventListener('keydown', onKey, true)
    URL.revokeObjectURL(url)
    host.remove()
  }

  async function finish(): Promise<void> {
    if (saving) return
    saving = true
    save.textContent = 'Saving…'

    let blob = result.blob
    try {
      if (isTrimmed(range, result.durationMs) && isUsableRange(range, result.durationMs)) {
        blob =
          result.gifSource !== undefined
            ? // A GIF is a list of frames, so a trim is an exact re-slice.
              trimGif(result.gifSource, range)
            : // A WebM has to be replayed and re-encoded; see recorder-trim.
              await trimVideo(result.blob, range, result.durationMs)
      }
    } catch (error: unknown) {
      // The untrimmed recording is still worth having, and losing it to a
      // failed edit would be the worst possible outcome.
      console.error(
        `[Hotshot] the recording could not be trimmed, saving it whole: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-')
    downloadBlob(blob, `${location.hostname}-${stamp}.${result.extension}`)
    teardown()
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      teardown()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      void finish()
    }
  }

  save.addEventListener('click', () => void finish())
  discard.addEventListener('click', teardown)
  window.addEventListener('keydown', onKey, true)
}
