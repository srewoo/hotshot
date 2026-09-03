import { requestBackdrop } from './backdrop-request'
import { buildLoupe } from './loupe-view'
import { ScaleChangedError, type ScaleFactors } from '../../shared/geometry/device-rect'
import type { Viewport } from './selection-rect'
import type { Backdrop } from '../../shared/messaging/backdrop'

/**
 * Phase 2 of the overlay (PRD FR-1).
 *
 * Phase 1 paints instantly from what the page already knows; this is what
 * arrives afterwards — the captured bitmap, which freezes the page visually
 * and hydrates the loupe.
 *
 * Started and deliberately NOT awaited by the caller. The overlay is already
 * interactive by then — drag, walk the DOM, cancel — which is the difference
 * between a tool that feels instant and one that feels like it is thinking.
 * The capture is still taken EAGERLY, because it is both the buffer the crop
 * is cut from and the page as it was when the hotkey was pressed (review B2).
 */

export interface PhaseTwoDeps {
  readonly root: ShadowRoot
  readonly frozen: HTMLDivElement
  readonly hint: HTMLDivElement
  readonly viewport: Viewport
  /** Mutated in place when the worker reports the true zoom. */
  readonly scale: ScaleFactors & { zoom: number }
  /** Still alive? A second hotkey press replaces the session. */
  live(): boolean
  /** Repaints, so the readout can pick up the zoom annotation. */
  repaint(): void
  onLoupe(loupe: ReturnType<typeof buildLoupe>): void
  onBitmap(bitmap: ImageBitmap): void
  onAbort(): void
}

export interface PhaseTwo {
  /** Resolves with the backdrop, or null when there will never be one. */
  readonly ready: Promise<Backdrop | null>
  /** The data URL the crop is cut from, once it exists. */
  url(): string | null
}

export function startPhaseTwo(deps: PhaseTwoDeps): PhaseTwo {
  let url: string | null = null

  const ready = requestBackdrop().then((backdrop) => {
    if (!deps.live()) return null
    if (!backdrop) {
      // `requestBackdrop` has already logged the reason. Saying so in the hint
      // is the honest response: without pixels there is nothing to crop, and
      // leaving the veil up silently would look like a hang.
      deps.hint.textContent = 'could not read the page pixels — press esc'
      return null
    }

    // The bitmap is authoritative: it was produced at whatever scale the page
    // was at. If that disagrees with the scale phase 1 measured, the layout
    // moved under us and the CSS rect the user drew no longer describes the
    // same pixels — abort rather than crop something plausible but wrong.
    if (Math.abs(backdrop.dpr - deps.scale.dpr) > 0.001) {
      const error = new ScaleChangedError(
        { ...deps.scale },
        { zoom: backdrop.zoom, dpr: backdrop.dpr },
      )
      console.error(`[Hotshot] ${error.message}`)
      deps.onAbort()
      return null
    }

    deps.scale.zoom = backdrop.zoom
    url = backdrop.dataUrl
    // What you see is literally what you get: the page stops moving, and a
    // video or animation underneath can no longer drift from the capture.
    deps.frozen.style.backgroundImage = `url("${backdrop.dataUrl}")`
    deps.frozen.style.display = 'block'
    deps.repaint()

    // Decoding is a second async hop, so the loupe arrives after the freeze
    // rather than holding it up.
    void (async () => {
      const bitmap = await createImageBitmap(await (await fetch(backdrop.dataUrl)).blob())
      if (!deps.live()) return bitmap.close()
      deps.onBitmap(bitmap)
      // The loupe reads the same bitmap the crop is cut from (review B2).
      const loupe = buildLoupe(bitmap, { ...deps.scale }, deps.viewport)
      deps.onLoupe(loupe)
      deps.root.append(loupe.element)
    })()

    return backdrop
  })

  return { ready, url: () => url }
}
