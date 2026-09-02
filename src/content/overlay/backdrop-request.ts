import { parseBackdropResponse, type Backdrop } from '../../shared/messaging/backdrop'
import { isErr } from '../../shared/result'

/**
 * Asks the service worker for the frozen backdrop (PRD FR-40).
 *
 * The single bitmap does double duty (review finding B2): it is the magnifier's
 * source AND the buffer the crop is cut from, so what the user sees under the
 * loupe is literally what gets captured.
 */
export async function requestBackdrop(): Promise<Backdrop | null> {
  const response: unknown = await chrome.runtime.sendMessage({
    kind: 'capture/request-backdrop',
  })
  const parsed = parseBackdropResponse(response)
  if (isErr(parsed)) {
    console.error(`[Hotshot] could not capture the page: ${parsed.error.issues.join('; ')}`)
    return null
  }
  return parsed.value
}
