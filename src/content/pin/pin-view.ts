import {
  displayFormFor,
  GHOST_OPACITY,
  OPACITY_CYCLE,
  type PinCorner,
  type PinRect,
  type Size,
} from './pin-layout'
import { HOTSHOT_HOST_ATTRIBUTE } from '../overlay/element-chain'

/**
 * One pin's DOM (PRD FR-37/FR-38, DESIGN §3.9).
 *
 * Resting state is 2px of chrome and nothing else. The overlay and the pin
 * share the unknown-backdrop problem but have opposite time signatures: the
 * overlay is transient and must command, the pin is persistent and must
 * recede. So legibility is bought with geometry rather than luminance — the
 * rule pair costs nothing over an hour, whereas a titlebar charges rent
 * continuously. The whole plate is the drag handle, which is what lets the
 * titlebar go.
 *
 * Construction and painting only. Dragging, resizing, stacking and dismissal
 * live in `pin-controller`, which owns the pins as a set.
 */

const RULE_OUTER = 'rgba(6,6,5,0.92)'
const RULE_INNER = '#FFFFFF'
const FLARE = '#FF5A00'
const HANDLE_PX = 14

export const CORNERS: readonly PinCorner[] = ['nw', 'ne', 'sw', 'se']

export interface PinView {
  readonly host: HTMLDivElement
  readonly image: HTMLImageElement
  /** Corner grips, shown on hover and focus only. */
  readonly handles: ReadonlyMap<PinCorner, HTMLDivElement>
  place(rect: PinRect): void
  setOpacity(level: number): void
  setNumber(value: number): void
  setActive(active: boolean): void
  setStackIndex(index: number): void
  /** Paints the crop marquee, in display pixels relative to the pin. */
  showCrop(selection: { x: number; y: number; width: number; height: number }): void
  hideCrop(): void
  destroy(): void
}

function corner(name: PinCorner): HTMLDivElement {
  const node = document.createElement('div')
  const north = name === 'nw' || name === 'ne'
  const west = name === 'nw' || name === 'sw'
  Object.assign(node.style, {
    position: 'absolute',
    width: `${HANDLE_PX}px`,
    height: `${HANDLE_PX}px`,
    [north ? 'top' : 'bottom']: '-1px',
    [west ? 'left' : 'right']: '-1px',
    cursor: `${name}-resize`,
    background: RULE_INNER,
    boxShadow: `0 0 0 1px ${RULE_OUTER}`,
    borderRadius: '1px',
    opacity: '0',
    transition: 'opacity 90ms linear',
    touchAction: 'none',
  })
  node.dataset.hotshotCorner = name
  return node
}

export function buildPinView(imageUrl: string): PinView {
  const host = document.createElement('div')
  // Lets the element picker recognise and refuse our own UI.
  host.setAttribute(HOTSHOT_HOST_ATTRIBUTE, '')
  host.setAttribute('role', 'dialog')
  // A STABLE label: it is the pin's identity, and folding changing state into
  // it means anything selecting the pin — a test, a script, an assistive tool
  // building a list — has to track the state to find it.
  host.setAttribute('aria-label', 'Hotshot pinned capture')
  host.tabIndex = 0

  Object.assign(host.style, {
    position: 'fixed',
    zIndex: '2147483645',
    cursor: 'grab',
    boxShadow: `0 0 0 1px ${RULE_INNER}, 0 0 0 2px ${RULE_OUTER}, 0 2px 8px rgba(0,0,0,.18)`,
    borderRadius: '2px',
    background: '#171716',
    touchAction: 'none',
  })

  const image = document.createElement('img')
  Object.assign(image.style, {
    display: 'block',
    width: '100%',
    height: '100%',
    // `contain`, not `cover`: a pin must never crop the capture silently. The
    // aspect ratio is locked on resize, so there is nothing to letterbox.
    objectFit: 'contain',
    pointerEvents: 'none',
    borderRadius: '2px',
  })
  image.src = imageUrl
  image.alt = ''
  host.append(image)

  /** The number, so "bring the second pin forward" is a thing one can say. */
  const badge = document.createElement('span')
  Object.assign(badge.style, {
    position: 'absolute',
    top: '4px',
    left: '4px',
    minWidth: '16px',
    height: '16px',
    padding: '0 4px',
    display: 'grid',
    placeItems: 'center',
    background: RULE_OUTER,
    color: RULE_INNER,
    font: '600 10px/1 "IBM Plex Mono", ui-monospace, monospace',
    borderRadius: '2px',
    pointerEvents: 'none',
  })
  host.append(badge)

  /**
   * The grab tab.
   *
   * A ghosted pin stops taking pointer events so the page under it stays
   * usable — which would make the pin itself unrecoverable. The tab is the one
   * part that keeps its events, so a ghost can always be moved or dismissed.
   */
  const tab = document.createElement('div')
  Object.assign(tab.style, {
    position: 'absolute',
    top: '0',
    right: '0',
    width: '22px',
    height: '22px',
    display: 'none',
    cursor: 'grab',
    background: FLARE,
    boxShadow: `0 0 0 1px ${RULE_OUTER}`,
    borderRadius: '0 2px 0 2px',
    pointerEvents: 'auto',
    touchAction: 'none',
  })
  tab.dataset.hotshotGrab = 'tab'
  tab.title = 'Drag the ghosted pin, or press Escape to dismiss it'
  host.append(tab)

  const handles = new Map<PinCorner, HTMLDivElement>()
  for (const name of CORNERS) {
    const node = corner(name)
    handles.set(name, node)
    host.append(node)
  }

  /** The crop marquee: the rule pair again, so it reads on any capture. */
  const marquee = document.createElement('div')
  Object.assign(marquee.style, {
    position: 'absolute',
    display: 'none',
    boxShadow: `0 0 0 1px ${RULE_INNER}, 0 0 0 2px ${RULE_OUTER}`,
    background: 'rgba(255,90,0,0.14)',
    pointerEvents: 'none',
  })
  host.append(marquee)

  let chip: HTMLSpanElement | null = null

  function showHandles(show: boolean): void {
    for (const node of handles.values()) node.style.opacity = show ? '1' : '0'
  }
  host.addEventListener('pointerenter', () => showHandles(true))
  host.addEventListener('pointerleave', () => showHandles(false))
  host.addEventListener('focus', () => showHandles(true))
  host.addEventListener('blur', () => showHandles(false))

  return {
    host,
    image,
    handles,

    place(rect) {
      Object.assign(host.style, {
        left: `${Math.round(rect.x)}px`,
        top: `${Math.round(rect.y)}px`,
        width: `${Math.round(rect.width)}px`,
        height: `${Math.round(rect.height)}px`,
      })

      // Below the legibility threshold Hotshot changes form rather than
      // rendering an illegible smear.
      if (displayFormFor(rect) === 'chip') {
        image.style.display = 'none'
        if (!chip) {
          chip = document.createElement('span')
          Object.assign(chip.style, {
            display: 'grid',
            placeItems: 'center',
            height: '100%',
            color: '#F7F7F5',
            font: '500 11px/1 "IBM Plex Mono", ui-monospace, monospace',
          })
          chip.textContent = 'capture'
          host.append(chip)
        }
        chip.style.display = 'grid'
      } else {
        image.style.display = 'block'
        if (chip) chip.style.display = 'none'
      }
    },

    setOpacity(level) {
      image.style.opacity = String(level)
      const ghosted = level <= GHOST_OPACITY
      // The plate stops intercepting so the page beneath is usable; the tab
      // appears so the pin is still recoverable.
      host.style.pointerEvents = ghosted ? 'none' : 'auto'
      tab.style.display = ghosted ? 'block' : 'none'
      badge.style.opacity = ghosted ? '0.5' : '1'
      // State goes in the description, so it is still announced without
      // changing what the pin is called.
      host.setAttribute('aria-description', `${Math.round(level * 100)}% opacity`)
    },

    setNumber(value) {
      badge.textContent = String(value)
    },

    setActive(active) {
      host.style.boxShadow = active
        ? `0 0 0 1px ${FLARE}, 0 0 0 2px ${RULE_OUTER}, 0 4px 14px rgba(0,0,0,.24)`
        : `0 0 0 1px ${RULE_INNER}, 0 0 0 2px ${RULE_OUTER}, 0 2px 8px rgba(0,0,0,.18)`
    },

    showCrop(selection) {
      Object.assign(marquee.style, {
        display: 'block',
        left: `${Math.round(selection.x)}px`,
        top: `${Math.round(selection.y)}px`,
        width: `${Math.round(selection.width)}px`,
        height: `${Math.round(selection.height)}px`,
      })
    },

    hideCrop() {
      marquee.style.display = 'none'
    },

    setStackIndex(index) {
      // One below the overlay's own layer, so a capture can always be taken
      // over the top of a pin.
      host.style.zIndex = String(2147483600 + index)
    },

    destroy() {
      host.remove()
    },
  }
}

export { OPACITY_CYCLE, type Size }
