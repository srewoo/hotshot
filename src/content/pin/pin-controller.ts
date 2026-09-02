import {
  cascadeOrigin,
  clampPinSize,
  displayFormFor,
  MAX_PINS_PER_TAB,
  nextOpacity,
  withinMemoryBudget,
  type Size,
} from './pin-layout'
import { HOTSHOT_HOST_ATTRIBUTE } from '../overlay/element-chain'

/**
 * Pin-to-screen (PRD FR-37/FR-38, DESIGN §3.9).
 *
 * Resting state is 2px of chrome and nothing else. The overlay and the pin
 * share the unknown-backdrop problem but have opposite time signatures: the
 * overlay is transient and must command, the pin is persistent and must
 * recede. So legibility is bought with geometry rather than luminance — the
 * rule pair costs nothing over an hour, whereas a titlebar charges rent
 * continuously. The whole plate is the drag handle, which is what lets the
 * titlebar go.
 */

const RULE_OUTER = 'rgba(6,6,5,0.92)'
const RULE_INNER = '#FFFFFF'
const FLARE = '#FF5A00'

interface Pin {
  readonly host: HTMLDivElement
  size: Size
  opacity: number
}

const pins: Pin[] = []

function currentSizes(): Size[] {
  return pins.map((pin) => pin.size)
}

export function pinCount(): number {
  return pins.length
}

export function dismissAllPins(): void {
  for (const pin of pins.splice(0)) pin.host.remove()
}

export async function addPin(blob: Blob): Promise<boolean> {
  const bitmap = await createImageBitmap(blob)
  const natural: Size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()

  const scale = Math.min(1, 520 / natural.width)
  const size = clampPinSize(natural, scale)

  // Refuse rather than risk a renderer OOM, which the user experiences as
  // "Chrome crashed" and never attributes to us (R-10).
  if (pins.length >= MAX_PINS_PER_TAB || !withinMemoryBudget([...currentSizes(), size], 1)) {
    console.warn(`[Hotshot] pin refused: at most ${MAX_PINS_PER_TAB} pins per tab.`)
    return false
  }

  const origin = cascadeOrigin(pins.length)
  const host = document.createElement('div')
  host.setAttribute(HOTSHOT_HOST_ATTRIBUTE, '')
  host.setAttribute('role', 'dialog')
  host.setAttribute('aria-label', 'Hotshot pinned capture')
  host.tabIndex = 0

  Object.assign(host.style, {
    position: 'fixed',
    left: `${origin.x}px`,
    top: `${origin.y}px`,
    width: `${size.width}px`,
    height: `${size.height}px`,
    zIndex: '2147483645',
    cursor: 'grab',
    // The rule pair, drawn at full strength even in ghost mode: a faded
    // outline is how a ghost becomes lost furniture.
    boxShadow: `0 0 0 1px ${RULE_INNER}, 0 0 0 2px ${RULE_OUTER}, 0 2px 8px rgba(0,0,0,.18)`,
    borderRadius: '2px',
    overflow: 'hidden',
    background: '#171716',
  })

  const url = URL.createObjectURL(blob)
  const image = document.createElement('img')
  Object.assign(image.style, {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    pointerEvents: 'none',
  })
  image.src = url
  image.alt = ''
  host.append(image)

  if (displayFormFor(size) === 'chip') {
    // Below the legibility threshold Hotshot changes form rather than
    // rendering an illegible smear.
    image.style.display = 'none'
    Object.assign(host.style, { width: '104px', height: '28px' })
    const chip = document.createElement('span')
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

  const pin: Pin = { host, size, opacity: 1 }
  pins.push(pin)

  let dragging = false
  let offsetX = 0
  let offsetY = 0

  host.addEventListener('pointerdown', (event) => {
    dragging = true
    host.setPointerCapture(event.pointerId)
    host.style.cursor = 'grabbing'
    const box = host.getBoundingClientRect()
    offsetX = event.clientX - box.left
    offsetY = event.clientY - box.top
    // Last-focused sits on top.
    host.style.zIndex = String(2147483645)
    host.style.boxShadow = `0 0 0 1px ${FLARE}, 0 0 0 2px ${RULE_OUTER}, 0 4px 14px rgba(0,0,0,.24)`
  })

  host.addEventListener('pointermove', (event) => {
    if (!dragging) return
    host.style.left = `${event.clientX - offsetX}px`
    host.style.top = `${event.clientY - offsetY}px`
  })

  host.addEventListener('pointerup', (event) => {
    dragging = false
    host.releasePointerCapture(event.pointerId)
    host.style.cursor = 'grab'
    host.style.boxShadow = `0 0 0 1px ${RULE_INNER}, 0 0 0 2px ${RULE_OUTER}, 0 2px 8px rgba(0,0,0,.18)`
  })

  host.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      remove()
      return
    }
    // `O` cycles opacity. Ghost mode drops the IMAGE, never the rule.
    if (event.code === 'KeyO') {
      event.preventDefault()
      pin.opacity = nextOpacity(pin.opacity)
      image.style.opacity = String(pin.opacity)
      host.style.pointerEvents = pin.opacity <= 0.25 ? 'none' : 'auto'
      return
    }
    const step = event.shiftKey ? 10 : 1
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      host.style.left = `${host.offsetLeft + move[0]}px`
      host.style.top = `${host.offsetTop + move[1]}px`
    }
  })

  function remove(): void {
    URL.revokeObjectURL(url)
    host.remove()
    const index = pins.indexOf(pin)
    if (index !== -1) pins.splice(index, 1)
  }

  document.documentElement.append(host)
  host.focus({ preventScroll: true })
  return true
}
