import { idbHistoryStore, type StoredCapture } from '../storage/idb-history'
import { restrictionFor } from './restricted-page'
import { requestStitchCancel } from './fullpage'
import {
  clearLibrary,
  deleteCaptures,
  enforceQuota,
  exportLibrary,
  importLibrary,
  listLibrary,
  readCapture,
  resendCapture,
  restoreCaptures,
  tagCapture,
  toggleFavourite,
  updateCapture,
} from './library'
import {
  forgetTargets,
  handleShip,
  handleTargetSearch,
  listDestinations,
  type ShipRequest,
} from './destinations'

/**
 * Stored captures (PRD FR-25/FR-26) and destinations (FR-13..FR-19).
 *
 * Both live in the worker for the same reason: a content script on an
 * arbitrary page must never be able to read a user's capture history or reach
 * their Jira account. Every operation is a message, and the library page is
 * deliberately just another caller of the same door.
 */

/**
 * The last bulk delete, held for an undo.
 *
 * In memory rather than on disk: MV3 may terminate the worker, and losing an
 * undo to that is acceptable — writing the rows back to the very store they
 * were deleted from would not be.
 */
let undoBuffer: readonly StoredCapture[] = []

/**
 * Sends a stored capture back into a page — to re-edit, or to pin (FR-25).
 *
 * Both go through the tab, because the editor and the pin controller live in
 * the page: the library is a tab of its own and has no page to pin onto.
 *
 * A plain function rather than its own message listener. Two listeners keyed
 * on the same `library/` prefix race each other, and the first to reply wins —
 * which is how `library/resend` came back as "Unknown library request".
 */
async function sendToTab(id: string, pin: boolean): Promise<{ ok: boolean; message?: string }> {
  try {
    const dataUrl = await readCapture(id)
    if (!dataUrl) throw new Error('That capture is no longer in the library.')

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) throw new Error('There is no active tab to open the capture in.')

    const restriction = restrictionFor(tab.url)
    if (restriction) throw new Error(restriction.message)

    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
    await chrome.tabs.sendMessage(tab.id, {
      kind: pin ? 'pin/restore' : 'capture/stitched',
      dataUrl,
      partialWarning: null,
    })
    return { ok: true }
  } catch (error: unknown) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'That capture could not be opened.',
    }
  }
}


/** Registers every storage-side and destination listener. */
export function registerLibraryRoutes(): void {
  /**
   * Records where the most recent capture was sent (FR-25).
   *
   * Attached to the newest entry rather than carried through the ship request:
   * the editor writes history and ships as two independent steps, and threading
   * an id between them would couple them for one label.
   */
  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    const msg = message as { kind?: string; destination?: unknown }
    if (msg?.kind !== 'history/destination') return undefined
    if (sender.tab?.incognito) return undefined

    const destination = msg.destination as { provider?: unknown; key?: unknown; url?: unknown }
    if (typeof destination?.provider !== 'string' || typeof destination.key !== 'string') {
      return undefined
    }

    void (async () => {
      const [newest] = await listLibrary()
      if (!newest) return
      await updateCapture(newest.id, {
        destination: {
          provider: destination.provider as string,
          key: destination.key as string,
          ...(typeof destination.url === 'string' ? { url: destination.url } : {}),
        },
      })
    })()

    return undefined
  })

  /**
   * The library's operations (PRD FR-25).
   *
   * The worker owns IndexedDB for the same reason it owns tokens: a content
   * script on an arbitrary page must never be able to read a user's capture
   * history. The library page is just another caller.
   */
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const msg = message as {
      kind?: string
      id?: string
      ids?: string[]
      tag?: string
      add?: boolean
      entries?: unknown
      document?: unknown
    }
    if (typeof msg?.kind !== 'string' || !msg.kind.startsWith('library/')) return undefined

    void (async () => {
      try {
        switch (msg.kind) {
          case 'library/list':
            return sendResponse({ ok: true, entries: await listLibrary() })
          case 'library/read':
            return sendResponse({ ok: true, dataUrl: await readCapture(String(msg.id)) })
          case 'library/favourite':
            return sendResponse({ ok: true, favourite: await toggleFavourite(String(msg.id)) })
          case 'library/tag':
            await tagCapture(String(msg.id), String(msg.tag ?? ''), msg.add !== false)
            return sendResponse({ ok: true })
          case 'library/delete': {
            // The removed rows come back so the page can offer an undo — bulk
            // delete with no way back is how a library loses an afternoon.
            const removed = await deleteCaptures(msg.ids ?? [])
            undoBuffer = removed
            return sendResponse({ ok: true, removed: removed.length })
          }
          case 'library/undo-delete': {
            await restoreCaptures(undoBuffer)
            const restored = undoBuffer.length
            undoBuffer = []
            return sendResponse({ ok: true, restored })
          }
          case 'library/clear':
            await clearLibrary()
            undoBuffer = []
            return sendResponse({ ok: true })
          case 'library/export':
            return sendResponse({ ok: true, document: await exportLibrary() })
          case 'library/import':
            return sendResponse({ ok: true, imported: await importLibrary(msg.document) })
          case 'library/resend':
            return sendResponse(await resendCapture(String(msg.id)))
          case 'library/reopen':
          case 'library/pin':
            return sendResponse(await sendToTab(String(msg.id), msg.kind === 'library/pin'))
          default:
            return sendResponse({ ok: false, message: 'Unknown library request.' })
        }
      } catch (error: unknown) {
        sendResponse({
          ok: false,
          message: error instanceof Error ? error.message : 'The library request failed.',
        })
      }
    })()

    return true // keep the channel open for the async response
  })

  /** Destination routing (FR-13..FR-19). Tokens never leave the worker. */
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    const kind = (message as { kind?: string })?.kind
    if (kind === 'stitch/cancel') {
      requestStitchCancel()
      return undefined
    }
    if (
      kind !== 'destinations/list' &&
      kind !== 'destinations/ship' &&
      kind !== 'destinations/search' &&
      kind !== 'destinations/forget'
    ) {
      return undefined
    }

    void (async () => {
      try {
        if (kind === 'destinations/list') {
          sendResponse(await listDestinations())
          return
        }
        if (kind === 'destinations/forget') {
          const provider = (message as { provider?: unknown }).provider
          if (provider === 'jira' || provider === 'notion' || provider === 'clickup') {
            await forgetTargets(provider)
          }
          sendResponse({ ok: true })
          return
        }
        if (kind === 'destinations/search') {
          const request = message as { provider?: unknown; query?: unknown }
          const provider = request.provider
          if (provider !== 'jira' && provider !== 'notion' && provider !== 'clickup') {
            sendResponse({ ok: false, candidates: [], message: 'Unknown destination.' })
            return
          }
          sendResponse(
            await handleTargetSearch(provider, typeof request.query === 'string' ? request.query : ''),
          )
          return
        }
        sendResponse(await handleShip(message as ShipRequest))
      } catch (error) {
        sendResponse({
          ok: false,
          message: error instanceof Error ? error.message : 'The send failed unexpectedly.',
        })
      }
    })()

    return true
  })

  /**
   * Records a finished capture into history (FR-25/FR-26).
   *
   * The Incognito test happens here, at the single write path, because the
   * content script cannot tell whether its own window is incognito — and a
   * caller that forgets would be a privacy incident, not a bug.
   */
  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    const msg = message as {
      kind?: string
      dataUrl?: unknown
      widthDevicePx?: number
      heightDevicePx?: number
      sourceUrl?: string
      title?: string
    }
    if (msg?.kind !== 'history/record') return undefined

    // A PNG data URL, and nothing else. `sendMessage` is JSON-serialised, so an
    // ArrayBuffer would arrive as `{}` and be written as the string
    // "[object Object]" — which is exactly what used to happen. Pinning the
    // shape here means a malformed record is refused rather than stored.
    const dataUrl = msg.dataUrl
    if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
      console.error('[Hotshot] refused a history record that was not a PNG data URL.')
      return undefined
    }

    // Checked BEFORE any write. Writing then deleting would still put the
    // bytes on disk, which is exactly what FR-26 forbids.
    if (sender.tab?.incognito) return undefined

    void (async () => {
      const blob = await (await fetch(dataUrl)).blob()
      const store = idbHistoryStore()
      await store.putWithBlob({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        capturedAt: Date.now(),
        sourceUrl: msg.sourceUrl ?? '',
        title: msg.title ?? '',
        widthDevicePx: msg.widthDevicePx ?? 0,
        heightDevicePx: msg.heightDevicePx ?? 0,
        bytes: blob.size,
        incognito: false,
        blob,
      })

      // Quota, at the single write path: count AND bytes, sparing favourites.
      await enforceQuota()
    })()

    return undefined
  })
}
