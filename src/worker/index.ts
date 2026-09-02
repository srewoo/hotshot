import { restrictionFor } from './restricted-page'
import { captureFullPage } from './fullpage'
import { createHistoryRepo } from '../storage/history-repo'
import { idbHistoryStore } from '../storage/idb-history'
import type { CaptureMode } from '../shared/messaging/protocol'

/**
 * Service worker: event wiring only (Architecture §3).
 *
 * It owns NO durable in-memory state. MV3 may terminate it between any two
 * events, so anything that must survive lives in `chrome.storage`.
 */

const COMMAND_MODES: Record<string, CaptureMode> = {
  'capture-region': 'region',
  'capture-fullpage': 'fullpage',
  'capture-element': 'element',
}

/** FR-4: delayed capture, with a visible countdown in the badge. */
const DELAY_KEY = 'hotshot.delaySeconds'

async function readDelaySeconds(): Promise<number> {
  const stored = await chrome.storage.local.get([DELAY_KEY])
  const value = stored[DELAY_KEY]
  return value === 3 || value === 5 || value === 10 ? value : 0
}

/**
 * Counts down in the action badge before capturing (FR-4).
 *
 * The countdown is the whole point: it exists so the user can open a hover
 * state or a menu that would vanish on click, and they need to see how long
 * they have.
 */
async function countdown(tabId: number, seconds: number): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#FF5A00' })
  for (let remaining = seconds; remaining > 0; remaining--) {
    await chrome.action.setBadgeText({ tabId, text: String(remaining) })
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  await chrome.action.setBadgeText({ tabId, text: '' })
}

const LAST_MODE_KEY = 'hotshot.lastMode'

async function readLastMode(): Promise<CaptureMode> {
  const stored = await chrome.storage.local.get([LAST_MODE_KEY])
  const value = stored[LAST_MODE_KEY]
  return value === 'region' || value === 'fullpage' || value === 'element' ? value : 'region'
}

/**
 * FR-30's first layer: badge text plus a tooltip. It needs no permission and
 * always fires, which matters because a keyboard-triggered command does not
 * open the popup — the exact case where the reason would otherwise be lost.
 */
async function reportRestriction(tabId: number, message: string): Promise<void> {
  await chrome.action.setBadgeText({ tabId, text: '!' })
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#C4321E' })
  await chrome.action.setTitle({ tabId, title: `Hotshot — ${message}` })

  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/128.png',
      title: 'Hotshot can’t capture this page',
      message,
    })
  } catch {
    // Notifications may be unavailable or denied. The badge above already
    // carries the reason, so this is a degradation, not a failure.
  }
}

async function clearBadge(tabId: number): Promise<void> {
  await chrome.action.setBadgeText({ tabId, text: '' })
  await chrome.action.setTitle({ tabId, title: 'Hotshot' })
}

async function beginCapture(mode: CaptureMode, tab: chrome.tabs.Tab): Promise<void> {
  const tabId = tab.id
  if (tabId === undefined) return

  const restriction = restrictionFor(tab.url)
  if (restriction) {
    await reportRestriction(tabId, restriction.message)
    return
  }
  await clearBadge(tabId)

  await chrome.storage.local.set({ [LAST_MODE_KEY]: mode })

  const delaySeconds = await readDelaySeconds()
  if (delaySeconds > 0) await countdown(tabId, delaySeconds)

  // Full page needs no overlay: there is nothing for the user to select, so
  // it runs straight through the offscreen stitcher.
  if (mode === 'fullpage') {
    const windowId = tab.windowId
    try {
      const dataUrl = await captureFullPage(tabId, windowId, ({ captured, total }) => {
        void chrome.action.setBadgeText({ tabId, text: `${captured}/${total}` })
      })
      await chrome.action.setBadgeText({ tabId, text: '' })
      await deliverFullPage(tabId, dataUrl)
    } catch (error) {
      await chrome.action.setBadgeText({ tabId, text: '' })
      await reportRestriction(
        tabId,
        error instanceof Error ? error.message : 'The full-page capture failed.',
      )
    }
    return
  }

  // `activeTab` is granted by this command invocation, and only for this tab.
  // It is the reason no host permission is requested at install (FR-23).
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  })

  await chrome.tabs.sendMessage(tabId, { kind: 'capture/begin', mode, tabId })
}

/**
 * Hands the finished stitch to the page to download, because a download must
 * start from a document — the same focus rule that governs the clipboard.
 */
async function deliverFullPage(tabId: number, dataUrl: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [dataUrl],
    func: (url: string) => {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${location.hostname}-fullpage.png`
      anchor.click()
    },
  })
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab) return
  void (async () => {
    const mode = COMMAND_MODES[command] ?? (await readLastMode())
    await beginCapture(mode, tab)
  })()
})

// First run opens the live sandbox once, never on update (PRD §8).
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return
  void chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/onboarding/index.html') })
})

chrome.action.onClicked.addListener((tab) => {
  void beginCapture('region', tab)
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
    blob?: ArrayBuffer
    widthDevicePx?: number
    heightDevicePx?: number
    sourceUrl?: string
    title?: string
  }
  if (msg?.kind !== 'history/record' || !msg.blob) return undefined

  // Checked BEFORE any write. Writing then deleting would still put the
  // bytes on disk, which is exactly what FR-26 forbids.
  if (sender.tab?.incognito) return undefined

  void (async () => {
    const blob = new Blob([msg.blob as ArrayBuffer], { type: 'image/png' })
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

    // Enforce the 20-capture cap through the repo, which owns that rule.
    const repo = createHistoryRepo(store)
    const all = await repo.list()
    if (all.length > 20) await store.delete(all.slice(20).map((e) => e.id))
  })()

  return undefined
})

/**
 * Serves the content script's request for the frozen backdrop.
 *
 * This single bitmap does double duty (review finding B2): it is both the
 * magnifier's source and the buffer the crop is cut from, so what the user
 * sees under the loupe is literally what gets captured.
 */
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (
    typeof message !== 'object' ||
    message === null ||
    (message as { kind?: unknown }).kind !== 'capture/request-backdrop'
  ) {
    return undefined
  }

  const tabId = sender.tab?.id
  const windowId = sender.tab?.windowId
  if (tabId === undefined || windowId === undefined) return undefined

  void (async () => {
    try {
      // Sample zoom and DPR at the SAME instant as the pixels (FR-40). Read
      // a frame apart, they can disagree with the bitmap actually produced —
      // which is exactly how a crop ends up 50% wrong at 150% zoom.
      const [zoom, dataUrl] = await Promise.all([
        chrome.tabs.getZoom(tabId),
        chrome.tabs.captureVisibleTab(windowId, { format: 'png' }),
      ])
      const dpr = await devicePixelRatioFor(tabId)
      sendResponse({ ok: true, dataUrl, zoom, dpr })
    } catch (error: unknown) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })()

  return true // keep the channel open for the async response
})

/**
 * The service worker has no `window`, so the page's DPR has to be read in the
 * page's own realm. Kept alongside the capture so both factors come from the
 * same moment.
 */
async function devicePixelRatioFor(tabId: number): Promise<number> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.devicePixelRatio,
  })
  const value = result?.result
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('Could not read the page’s device pixel ratio; capture aborted.')
  }
  return value
}
