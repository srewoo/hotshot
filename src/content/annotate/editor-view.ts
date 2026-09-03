import { TOKENS } from '../overlay/overlay-chrome'
import {
  canvasPointFrom,
  fitAllScale,
  fitWidthScale,
  toCanvasDistance,
  zoomBy,
  type Size,
} from './view-transform'
import type { AnnotationPoint } from './command-list'

/**
 * The editor's stage: how the capture is shown, and how screen coordinates
 * come back (PRD FR-2 → FR-7).
 *
 * Separated from the editor's state machine because it is entirely about
 * layout — scale, scroll, and the mapping between viewport and canvas pixels.
 * A full-page stitch is routinely three viewports tall, so the stage scrolls
 * and defaults to fitting the WIDTH; fitting both axes showed a 2,400px page
 * at 27%, which is annotating a thumbnail.
 */

const STAGE_PAD_X = 48
/** Room kept clear below the capture for the toolbar and destination strip. */
const CHROME_RESERVE_PX = 148
/** Finger-slip allowance, in SCREEN px — converted per view scale. */
const HIT_SLOP_SCREEN_PX = 6

export interface EditorView {
  readonly stage: HTMLDivElement
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
  /** The capture's size in canvas (device) pixels. */
  readonly size: Size
  scale(): number
  applyScale(next: number): void
  zoom(direction: 1 | -1): void
  fitWidth(): void
  fitAll(): void
  /** The canvas's rendered position, which already accounts for scroll. */
  box(): DOMRect
  canvasPoint(client: { readonly x: number; readonly y: number }): AnnotationPoint
  /** Hit tolerance in canvas px at the current scale. */
  slop(screenPx?: number): number
  /** Docks the toolbar and destination strip, and re-docks on layout change. */
  dock(toolbar: DockTarget, destinations: HTMLElement): void
  onLayout(listener: () => void): void
  destroy(): void
}

/** The part of the toolbar this module drives. */
export interface DockTarget {
  readonly element: HTMLElement
  position(selection: DOMRect, viewport: { width: number; height: number }): void
}

export function buildEditorView(source: ImageBitmap): EditorView {
  const stage = document.createElement('div')
  Object.assign(stage.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(6,6,5,0.72)',
    display: 'flex',
    overflow: 'auto',
    padding: `${STAGE_PAD_X / 2}px ${STAGE_PAD_X}px ${CHROME_RESERVE_PX}px`,
    boxSizing: 'border-box',
    zIndex: '1',
  })

  // `margin: auto` centres the capture without the clipping that flex and
  // grid centring both cause once the content overflows its container.
  const wrap = document.createElement('div')
  Object.assign(wrap.style, { margin: 'auto', flex: '0 0 auto' })

  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  Object.assign(canvas.style, {
    display: 'block',
    boxShadow: `0 0 0 1px ${TOKENS.ruleInner}, 0 0 0 2px ${TOKENS.ruleOuter}`,
    cursor: 'crosshair',
    borderRadius: '2px',
    // Stops the browser claiming a drag as a pan or a page zoom mid-stroke.
    touchAction: 'none',
  })

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new Error('Could not acquire a 2D context for the annotation editor.')
  }

  wrap.append(canvas)
  stage.append(wrap)

  const size: Size = { width: canvas.width, height: canvas.height }
  const listeners: Array<() => void> = []
  let docked: { toolbar: DockTarget; destinations: HTMLElement } | null = null
  let current = 1

  function stageSize(): Size {
    return {
      width: Math.max(80, window.innerWidth - STAGE_PAD_X * 2),
      height: Math.max(80, window.innerHeight - CHROME_RESERVE_PX),
    }
  }

  function box(): DOMRect {
    return canvas.getBoundingClientRect()
  }

  function redock(): void {
    if (!docked) return
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const rendered = box()
    // Pinned near the viewport bottom rather than tracking the capture: on a
    // scrolling stitch the capture's bottom edge is far off-screen.
    docked.toolbar.position(
      {
        ...rendered,
        left: rendered.left,
        top: Math.min(rendered.top, viewport.height - CHROME_RESERVE_PX),
        bottom: viewport.height - 96,
      } as DOMRect,
      viewport,
    )
    const bar = docked.toolbar.element.getBoundingClientRect()
    docked.destinations.style.left = `${bar.left}px`
    docked.destinations.style.top = `${Math.min(bar.bottom + 8, viewport.height - 48)}px`
  }

  function announce(): void {
    redock()
    for (const listener of listeners) listener()
  }

  function applyScale(next: number): void {
    current = next
    canvas.style.width = `${Math.round(canvas.width * current)}px`
    canvas.style.height = `${Math.round(canvas.height * current)}px`
    announce()
  }

  // Scroll moves the capture under fixed-position chrome, so selection
  // handles have to be repositioned or they detach from their mark.
  stage.addEventListener('scroll', announce)
  window.addEventListener('resize', announce)

  return {
    stage,
    canvas,
    context,
    size,
    scale: () => current,
    applyScale,
    zoom: (direction) => applyScale(zoomBy(current, direction)),
    fitWidth: () => applyScale(fitWidthScale(size, stageSize())),
    fitAll: () => applyScale(fitAllScale(size, stageSize())),
    box,
    canvasPoint: (client) => canvasPointFrom(client, box(), size),
    slop: (screenPx = HIT_SLOP_SCREEN_PX) => toCanvasDistance(screenPx, box(), size),

    dock(toolbar, destinations) {
      docked = { toolbar, destinations }
      redock()
    },

    onLayout(listener) {
      listeners.push(listener)
    },

    destroy() {
      stage.removeEventListener('scroll', announce)
      window.removeEventListener('resize', announce)
      listeners.length = 0
    },
  }
}
