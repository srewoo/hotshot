import type { DeviceRect } from '../shared/geometry/device-rect'
import type { RecordMode } from './record/recording-state'
import type { RecordOptions } from './record/record-options'

/**
 * The seam between the capture fast path and everything after it.
 *
 * The content script is injected into every page a capture touches, and PRD
 * §6 budgets it at 120 KB because its parse and execute time sits directly on
 * FR-1's "interactive in 200ms". The annotation editor, the pin controller and
 * the recorder are none of them needed until AFTER pixels exist, so they ship
 * as a second chunk that is injected on demand.
 *
 * Both chunks are injected by `chrome.scripting.executeScript`, so they share
 * one isolated-world global — which is what makes this handshake a property
 * lookup rather than a message protocol.
 */

export interface EditorApi {
  /** Opens the editor over a finished capture and routes its result. */
  openCapture(
    root: ShadowRoot,
    bitmap: ImageBitmap,
    rect: DeviceRect,
    onClose: () => void,
  ): Promise<void>
  /** Resolves false when the pin was refused — see `MAX_PINS_PER_TAB`. */
  addPin(blob: Blob): Promise<boolean>
  mountRecordBar(mode: RecordMode, options?: RecordOptions): Promise<void>
}

declare global {
  interface Window {
    __hotshotEditor?: EditorApi
  }
}

/**
 * Loads the editor chunk, once per page.
 *
 * The worker owns injection because only it can call `executeScript`. A failure
 * is reported rather than swallowed: without the editor there is nowhere for
 * the capture to go, and the caller has a bitmap in hand to account for.
 */
export async function loadEditor(): Promise<EditorApi> {
  if (window.__hotshotEditor) return window.__hotshotEditor

  const reply = (await chrome.runtime.sendMessage({ kind: 'inject/editor' })) as
    | { ok?: boolean; error?: string }
    | undefined

  if (!reply?.ok) {
    throw new Error(reply?.error ?? 'The editor could not be loaded into this page.')
  }
  if (!window.__hotshotEditor) {
    throw new Error('The editor chunk loaded but registered nothing.')
  }
  return window.__hotshotEditor
}
