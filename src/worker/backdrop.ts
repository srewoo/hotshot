/**
 * The frozen backdrop, and the scale it was captured at (PRD FR-1, FR-40).
 *
 * One bitmap does double duty (review finding B2): it is the magnifier's
 * source AND the buffer the crop is cut from, so what the user sees under the
 * loupe is literally what gets captured. Split into its own module because it
 * is the only place both scale factors are sampled, and that sampling is the
 * correctness kernel the whole crop rests on.
 */

/**
 * Serves the content script's request for the frozen backdrop.
 *
 * This single bitmap does double duty (review finding B2): it is both the
 * magnifier's source and the buffer the crop is cut from, so what the user
 * sees under the loupe is literally what gets captured.
 */
export function registerBackdropRoute(): void {
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
}

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
