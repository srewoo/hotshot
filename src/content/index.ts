import { mountOverlay } from './overlay/overlay-host'
import type { CaptureMode } from '../shared/messaging/protocol'

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

if (!window.__hotshotInjected) {
  window.__hotshotInjected = true

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (typeof message !== 'object' || message === null) return
    const { kind, mode } = message as { kind?: unknown; mode?: unknown }
    if (kind !== 'capture/begin') return
    if (mode !== 'region' && mode !== 'fullpage' && mode !== 'element') return

    void mountOverlay(mode as CaptureMode)
  })
}
