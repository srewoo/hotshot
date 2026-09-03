import {
  CAPTURE_INTERVAL_MS,
  planTiles,
  progressFrom,
  SETTLE_MS,
  type CaptureBand,
} from '../offscreen/tile-plan'
import { createStitchSession } from '../offscreen/stitch-state'

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
  /** Where the user was, so they can be put back (see `unfreeze`). */
  readonly scrollY: number
}

export interface StitchProgress {
  readonly captured: number
  readonly total: number
  readonly etaMs: number
}

/**
 * A bounded capture: one element's box rather than the whole document (FR-5).
 *
 * All four numbers are CSS px — `top` from the document's top, `left` from the
 * viewport's left, since horizontal scrolling is not part of this pipeline.
 */
export interface ElementBox {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
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
      scrollY: window.scrollY,
    }),
  })
  const value = result?.result as PageGeometry | undefined
  if (!value) throw new Error('Could not measure the page; capture aborted.')
  return value
}

/**
 * Scrolls, and freezes fixed/sticky elements after the first tile (FR-2).
 *
 * `skipFreeze` is set for the first tile — which needs no freeze because
 * nothing has repeated yet — and for every tile of a bounded capture, which
 * must not be reflowed at all.
 */
async function positionForTile(
  tabId: number,
  scrollY: number,
  skipFreeze: boolean,
): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [scrollY, skipFreeze],
    func: (y: number, skip: boolean) => {
      const STYLE_ID = 'hotshot-freeze'
      if (!skip && !document.getElementById(STYLE_ID)) {
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

/**
 * Hides fixed and sticky elements WITHOUT reflowing the page.
 *
 * The whole-page path forces `position: static`, which is fine when the target
 * is the document itself. It is not fine for a bounded element capture: the
 * reflow moves the element, and the box measured before the capture no longer
 * describes where the element is. Hiding via `visibility` leaves layout
 * untouched — a fixed element is out of flow, and a hidden sticky one still
 * occupies its space — so the measured box stays true for every tile.
 */
async function hideOverlays(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const MARK = 'data-hotshot-was-visible'
      for (const node of document.querySelectorAll<HTMLElement>('*')) {
        const position = getComputedStyle(node).position
        if (position !== 'fixed' && position !== 'sticky') continue
        node.setAttribute(MARK, node.style.visibility)
        node.style.visibility = 'hidden'
      }
    },
  })
}

async function showOverlays(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const MARK = 'data-hotshot-was-visible'
      for (const node of document.querySelectorAll<HTMLElement>(`[${MARK}]`)) {
        node.style.visibility = node.getAttribute(MARK) ?? ''
        node.removeAttribute(MARK)
      }
    },
  })
}

/**
 * Undoes the freeze and puts the user back where they were.
 *
 * Scrolling to the top would be a second surprise on top of the capture: for a
 * tall element halfway down a long page, the user's place is the thing they
 * most need back.
 */
async function unfreeze(tabId: number, restoreScrollY: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [restoreScrollY],
    func: (y: number) => {
      document.getElementById('hotshot-freeze')?.remove()
      window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior })
    },
  })
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Set by the worker when the user presses Esc during a stitch. */
let cancelRequested = false

export function requestStitchCancel(): void {
  cancelRequested = true
}

export interface FullPageResult {
  readonly dataUrl: string
  /** Non-null when the stitch was cut short and delivered partially. */
  readonly partialWarning: string | null
}

/**
 * Scroll-and-stitch, over the whole document or one element's box.
 *
 * `box` is what FR-5 adds: the same scheduler, the same throttle, the same
 * canvas guard, bounded to an element. Nothing about the loop changes — which
 * is the point, because the loop is where the hard-won correctness lives.
 */
export async function captureFullPage(
  tabId: number,
  windowId: number,
  onProgress: (progress: StitchProgress) => void,
  box?: ElementBox,
): Promise<FullPageResult> {
  const geometry = await readGeometry(tabId)
  const band: CaptureBand | undefined = box ? { top: box.top, height: box.height } : undefined
  const tiles = planTiles({ ...geometry, band })
  const session = createStitchSession(tiles.length)
  const startedAt = Date.now()
  cancelRequested = false

  await ensureOffscreen()

  const send = async (message: unknown): Promise<{ ok: boolean; error?: string; dataUrl?: string }> =>
    (await chrome.runtime.sendMessage(message)) as { ok: boolean; error?: string; dataUrl?: string }

  const cssWidth = box ? box.width : geometry.viewportWidth
  const cssHeight = box ? box.height : geometry.documentHeight

  const begun = await send({
    kind: 'stitch/begin',
    widthDevicePx: Math.round(cssWidth * geometry.dpr),
    totalHeightDevicePx: Math.round(cssHeight * geometry.dpr),
    cssWidth,
    dpr: geometry.dpr,
    originXDevicePx: box ? Math.round(box.left * geometry.dpr) : 0,
  })
  if (!begun.ok) throw new Error(begun.error ?? 'The stitch could not be started.')

  // A bounded capture must not reflow the page (see `hideOverlays`).
  if (box) await hideOverlays(tabId)

  try {
    for (const [index, tile] of tiles.entries()) {
      // Esc stops and KEEPS what has been captured (FR-31).
      if (cancelRequested) {
        session.cancel()
        break
      }
      if (!session.running()) break

      // Only the whole-page path freezes by forcing static positioning; a
      // bounded capture has already hidden overlays without moving anything.
      await positionForTile(tabId, tile.scrollY, index === 0 || box !== undefined)

      // The settle runs inside the throttle gap, not in addition to it.
      await wait(index === 0 ? SETTLE_MS : Math.max(SETTLE_MS, CAPTURE_INTERVAL_MS - 120))

      let dataUrl: string
      try {
        dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
      } catch {
        // Chrome refused the capture, almost always the per-second quota.
        // Deliver what we have rather than losing a long stitch (FR-31).
        session.quotaExhausted()
        break
      }

      const added = await send({
        kind: 'stitch/tile',
        dataUrl,
        offsetDevicePx: Math.round(tile.offsetCssPx * geometry.dpr),
      })
      if (!added.ok) throw new Error(added.error ?? 'A tile could not be added.')

      session.tileDone()
      onProgress(
        progressFrom({
          captured: index + 1,
          total: tiles.length,
          elapsedMs: Date.now() - startedAt,
        }),
      )
    }

    if (!session.shouldDeliver()) {
      throw new Error('The capture was cancelled before anything was captured.')
    }

    const finished = await send({ kind: 'stitch/finish' })
    if (!finished.ok || !finished.dataUrl) {
      throw new Error(finished.error ?? 'The stitched image could not be encoded.')
    }
    return { dataUrl: finished.dataUrl, partialWarning: session.summary() }
  } finally {
    // Always restore the page, even on failure: leaving a page with every
    // element forced to `position: static`, or its header invisible, would
    // look like we broke the site.
    if (box) await showOverlays(tabId)
    await unfreeze(tabId, geometry.scrollY)
  }
}
