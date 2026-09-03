import { mountOverlay } from './overlay/overlay-host'
import { mountStitchedEditor } from './overlay/stitched-host'
import { loadEditor } from './editor-bridge'
import { parseEnvelope, type CaptureMode } from '../shared/messaging/protocol'
import { isErr } from '../shared/result'

/**
 * Content-script entry point.
 *
 * Injected on demand by the service worker under `activeTab`. Guarded against
 * double-injection because `executeScript` runs again on every invocation and
 * the user may press the hotkey twice.
 */

declare global {
  interface Window {
    __hotshotInjected?: true
  }
}

/**
 * Capture options, validated at the realm boundary.
 *
 * Defaults to nothing beyond the screen: a malformed message must never turn
 * the microphone or camera on, which is why this coerces rather than trusting.
 */
function normaliseRecordOptions(value: unknown): {
  tabAudio: boolean
  microphone: boolean
  webcam: boolean
} {
  const options = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >
  return {
    tabAudio: options.tabAudio === true,
    microphone: options.microphone === true,
    webcam: options.webcam === true,
  }
}

if (!window.__hotshotInjected) {
  window.__hotshotInjected = true

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (typeof message !== 'object' || message === null) return undefined
    const { kind, mode } = message as { kind?: unknown; mode?: unknown }
    if (kind === 'record/begin') {
      // Must run inside the user's gesture chain; the popup click provides it.
      if (mode === 'video' || mode === 'gif') {
        const { options } = message as { options?: unknown }
        void loadEditor().then(
          (editor) => editor.mountRecordBar(mode, normaliseRecordOptions(options)),
          (error: unknown) => console.error(`[Hotshot] ${String(error)}`),
        )
      }
      return undefined
    }

    // A capture from the library, pinned onto whatever page is open (FR-25).
    if (kind === 'pin/restore') {
      const { dataUrl } = message as { dataUrl?: unknown }
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
        console.error('[Hotshot] refused a pin restore that was not a PNG data URL.')
        sendResponse({ ok: false })
        return true
      }
      void (async () => {
        try {
          const editor = await loadEditor()
          const blob = await (await fetch(dataUrl)).blob()
          sendResponse({ ok: await editor.addPin(blob) })
        } catch (error: unknown) {
          console.error(`[Hotshot] could not pin the capture: ${String(error)}`)
          sendResponse({ ok: false })
        }
      })()
      return true
    }

    // A finished full-page stitch. The worker holds a download fallback open
    // until this replies, so every path below MUST answer exactly once —
    // silence would lose the capture.
    if (kind === 'capture/stitched') {
      const parsed = parseEnvelope(message)
      if (isErr(parsed) || parsed.value.kind !== 'capture/stitched') {
        const issues = isErr(parsed) ? parsed.error.issues.join('; ') : 'unexpected envelope'
        console.error(`[Hotshot] rejected a malformed stitch handoff: ${issues}`)
        sendResponse({ ok: false })
        return true
      }

      void mountStitchedEditor(parsed.value.dataUrl).then(
        () => sendResponse({ ok: true }),
        (error: unknown) => {
          console.error(
            `[Hotshot] could not open the editor for the full-page capture: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
          sendResponse({ ok: false })
        },
      )
      return true // keep the channel open for the async response
    }

    if (kind !== 'capture/begin') return undefined
    if (mode !== 'region' && mode !== 'fullpage' && mode !== 'element') return undefined

    void mountOverlay(mode as CaptureMode)
    return undefined
  })
}
