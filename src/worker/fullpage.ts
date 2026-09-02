import { CAPTURE_INTERVAL_MS, planTiles, progressFrom, SETTLE_MS } from '../offscreen/tile-plan'

/**
 * Full-page capture orchestration (PRD FR-2, FR-31).
 *
 * The 500ms cadence is this loop's design basis, not an error path. The 250ms
 * lazy-load settle runs INSIDE that gap rather than after it, which is why a
 * page costs ~500ms per tile and not ~750ms.
 */

const OFFSCREEN_PATH = 'src/offscreen/index.html'

export interface PageGeometry {
  readonly documentHeight: number
  readonly viewportHeight: number
  readonly viewportWidth: number
  readonly dpr: number
}

export interface StitchProgress {
  readonly captured: number
  readonly total: number
  readonly etaMs: number
}

/** MV3 allows exactly one offscreen document, so creation is idempotent. */
async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  })
  if (existing.length > 0) return

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
    justification: 'Compositing full-page screenshot tiles onto a single canvas.',
  })
}

async function readGeometry(tabId: number): Promise<PageGeometry> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      documentHeight: Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight ?? 0,
      ),
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      dpr: window.devicePixelRatio,
    }),
  })
  const value = result?.result as PageGeometry | undefined
  if (!value) throw new Error('Could not measure the page; capture aborted.')
  return value
}

/** Scrolls and freezes fixed/sticky elements after the first tile (FR-2). */
async function positionForTile(tabId: number, scrollY: number, isFirst: boolean): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [scrollY, isFirst],
    func: (y: number, first: boolean) => {
      const STYLE_ID = 'hotshot-freeze'
      if (!first && !document.getElementById(STYLE_ID)) {
        // Without this, a sticky header is captured once per tile and the
        // stitched image shows it repeating down the page.
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent =
          '*{position:static !important;}html,body{position:static !important;}'
        document.head.append(style)
      }
      window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior })
    },
  })
}

async function unfreeze(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      document.getElementById('hotshot-freeze')?.remove()
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    },
  })
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export async function captureFullPage(
  tabId: number,
  windowId: number,
  onProgress: (progress: StitchProgress) => void,
): Promise<string> {
  const geometry = await readGeometry(tabId)
  const tiles = planTiles(geometry)
  const startedAt = Date.now()

  await ensureOffscreen()

  const send = async (message: unknown): Promise<{ ok: boolean; error?: string; dataUrl?: string }> =>
    (await chrome.runtime.sendMessage(message)) as { ok: boolean; error?: string; dataUrl?: string }

  const begun = await send({
    kind: 'stitch/begin',
    widthDevicePx: Math.round(geometry.viewportWidth * geometry.dpr),
    totalHeightDevicePx: Math.round(geometry.documentHeight * geometry.dpr),
    cssWidth: geometry.viewportWidth,
    dpr: geometry.dpr,
  })
  if (!begun.ok) throw new Error(begun.error ?? 'The stitch could not be started.')

  try {
    for (const [index, tile] of tiles.entries()) {
      await positionForTile(tabId, tile.scrollY, index === 0)

      // The settle runs inside the throttle gap, not in addition to it.
      await wait(index === 0 ? SETTLE_MS : Math.max(SETTLE_MS, CAPTURE_INTERVAL_MS - 120))

      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
      const added = await send({
        kind: 'stitch/tile',
        dataUrl,
        offsetDevicePx: Math.round(tile.scrollY * geometry.dpr),
      })
      if (!added.ok) throw new Error(added.error ?? 'A tile could not be added.')

      onProgress(
        progressFrom({
          captured: index + 1,
          total: tiles.length,
          elapsedMs: Date.now() - startedAt,
        }),
      )
    }

    const finished = await send({ kind: 'stitch/finish' })
    if (!finished.ok || !finished.dataUrl) {
      throw new Error(finished.error ?? 'The stitched image could not be encoded.')
    }
    return finished.dataUrl
  } finally {
    // Always restore the page, even on failure: leaving a page with every
    // element forced to `position: static` would look like we broke the site.
    await unfreeze(tabId)
  }
}
