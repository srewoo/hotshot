import { registerCaptureRoutes } from './capture'
import { registerLibraryRoutes } from './library-routes'

/**
 * Service worker: event wiring only (Architecture §3).
 *
 * It owns NO durable in-memory state. MV3 may terminate it between any two
 * events, so anything that must survive lives in `chrome.storage` or
 * IndexedDB. The behaviour lives in `capture.ts` and `library-routes.ts`; this
 * file exists so that the complete list of things Hotshot reacts to can be
 * read in one screen.
 */

/**
 * Injects the editor chunk on request (PRD §6, `editor-bridge`).
 *
 * The capture fast path ships without the editor so its parse time stays off
 * FR-1's critical path; this is what pulls the rest in, once, after the user
 * has committed to a capture. Targeted at the SENDER's frame, so a capture
 * inside an iframe gets the editor in the frame that asked for it.
 */
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if ((message as { kind?: unknown } | null)?.kind !== 'inject/editor') return undefined

  const tabId = sender.tab?.id
  if (tabId === undefined) {
    sendResponse({ ok: false, error: 'The editor can only be injected into a tab.' })
    return true
  }

  void (async () => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [sender.frameId ?? 0] },
        files: ['editor.js'],
      })
      sendResponse({ ok: true })
    } catch (error: unknown) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'The editor could not be injected.',
      })
    }
  })()

  return true // keep the channel open for the async response
})

// First run opens the live sandbox once, never on update (PRD §8).
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return
  void chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/onboarding/index.html') })
})

registerCaptureRoutes()
registerLibraryRoutes()
