import { buildChain } from '../../src/content/overlay/element-chain'
import { chooseInitialIndex, walkChain } from '../../src/content/overlay/element-choice'
import { deepElementFromPoint } from '../../src/content/overlay/deep-hit'
import { encodeGif, type GifInput } from '../../src/content/record/gif-encoder'
import { trimGif } from '../../src/content/record/recorder-trim'
import { createCompositor, type CompositorSpec } from '../../src/offscreen/composite'
import { exportAs, fitForUpload, slicePages, type ExportKind } from '../../src/content/annotate/export-image'
import {
  addPin,
  cycleFocus,
  dismissAllPins,
  pinCount,
  undoDismiss,
} from '../../src/content/pin/pin-controller'

/**
 * Exposes the REAL element-picker algorithm to the fixture suite.
 *
 * The point of the suite is that the layout engine is real: `getBoundingClientRect`
 * on a transformed, shadow-rooted, or virtualised element is exactly what the
 * picker will see in production. Reimplementing any of it here would test the
 * reimplementation instead.
 */

declare global {
  interface Window {
    __hotshotPick(x: number, y: number): { tag: string; rect: DOMRect } | null
    __hotshotWalk(x: number, y: number, steps: number): { tag: string } | null
    /** Exposed for tests only — the encoder must never carry a test hook itself. */
    __hotshotEncodeGif(input: GifInput): Uint8Array
    /**
     * Composites synthetic tiles through the REAL stitcher and returns the
     * PNG, so a test can assert where each tile landed. `tiles` carries a
     * flat colour per tile plus the offset the scheduler would have given it.
     */
    __hotshotComposite(
      spec: CompositorSpec,
      tileWidth: number,
      tileHeight: number,
      tiles: ReadonlyArray<{ colour: string; offsetDevicePx: number }>,
    ): Promise<string>
    /** Exports a synthetic capture through the REAL export pipeline. */
    __hotshotExport(
      width: number,
      height: number,
      kind: ExportKind,
    ): Promise<{ type: string; size: number; extension: string; head: string; pageCount: number }>
    /** Fits a synthetic capture to a byte limit through the real ladder. */
    __hotshotFit(
      width: number,
      height: number,
      limitBytes: number,
    ): Promise<{ type: string; size: number; note: string | null }>
    __hotshotSliceCount(width: number, height: number, pageHeight: number): number
    /** Trims a synthetic GIF through the real slicer and encoder. */
    __hotshotTrimGif(
      frameCount: number,
      startMs: number,
      endMs: number,
    ): Promise<{ size: number; frames: number; decodable: boolean }>
    /** The real pin controller, so pins can be driven end to end. */
    __hotshotPins: {
      add(width: number, height: number): Promise<boolean>
      count(): number
      cycle(direction: 1 | -1): boolean
      undo(): Promise<boolean>
      clear(): void
      /** Everything a test needs to assert about the pins on the page. */
      inspect(): Array<{
        number: string
        zIndex: number
        rect: { x: number; y: number; width: number; height: number }
        opacity: string
        pointerEvents: string
        tabVisible: boolean
        focused: boolean
      }>
    }
  }
}

window.__hotshotEncodeGif = encodeGif

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight }
}

window.__hotshotPick = (x, y) => {
  const chain = buildChain(deepElementFromPoint(x, y))
  const index = chooseInitialIndex(chain, viewport())
  const candidate = chain[index]
  if (!candidate) return null
  return {
    tag: candidate.tag,
    rect: candidate.rect as DOMRect,
  }
}

window.__hotshotWalk = (x, y, steps) => {
  const chain = buildChain(deepElementFromPoint(x, y))
  let index = chooseInitialIndex(chain, viewport())
  for (let i = 0; i < Math.abs(steps); i++) {
    index = walkChain(chain, index, steps > 0 ? 'out' : 'in', viewport())
  }
  return chain[index] ? { tag: chain[index].tag } : null
}

window.__hotshotComposite = async (spec, tileWidth, tileHeight, tiles) => {
  const compositor = createCompositor(spec)

  for (const [index, tile] of tiles.entries()) {
    // Each synthetic tile is a flat colour with a numbered stripe down its
    // left edge, so a test can tell WHICH tile landed where rather than only
    // that something did.
    const canvas = new OffscreenCanvas(tileWidth, tileHeight)
    const context = canvas.getContext('2d')!
    context.fillStyle = tile.colour
    context.fillRect(0, 0, tileWidth, tileHeight)
    context.fillStyle = '#000000'
    context.fillRect(0, 0, 4, (index + 1) * 8)

    const bitmap = await createImageBitmap(canvas)
    compositor.addTile(bitmap, tile.offsetDevicePx)
    bitmap.close()
  }

  const blob = await compositor.finish()
  const buffer = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (const byte of buffer) binary += String.fromCharCode(byte)
  return `data:image/png;base64,${btoa(binary)}`
}

/** A canvas with enough detail that JPEG cannot trivially shrink it. */
function syntheticCapture(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  context.fillStyle = '#f4f1ea'
  context.fillRect(0, 0, width, height)
  for (let y = 0; y < height; y += 24) {
    context.fillStyle = `hsl(${(y * 7) % 360} 70% 50%)`
    context.fillRect(0, y, width, 12)
    context.fillStyle = '#111'
    context.font = '600 14px monospace'
    context.fillText(`row ${y} of the capture`, 12, y + 22)
  }
  return canvas
}

window.__hotshotExport = async (width, height, kind) => {
  const canvas = syntheticCapture(width, height)
  const result = await exportAs(canvas, kind, { title: 'Harness capture' })
  const bytes = new Uint8Array(await result.blob.arrayBuffer())
  let head = ''
  for (const byte of bytes.subarray(0, 8)) head += byte.toString(16).padStart(2, '0')

  // Counted from the bytes, so the assertion is about the FILE and not about
  // what the slicer believed it produced.
  let pageCount = 0
  const text = new TextDecoder('latin1').decode(bytes)
  for (const match of text.matchAll(/\/Type \/Page[^s]/g)) if (match) pageCount++

  return { type: result.blob.type, size: result.blob.size, extension: result.extension, head, pageCount }
}

window.__hotshotFit = async (width, height, limitBytes) => {
  const fitted = await fitForUpload(syntheticCapture(width, height), limitBytes)
  return { type: fitted.blob.type, size: fitted.blob.size, note: fitted.note }
}

window.__hotshotSliceCount = (width, height, pageHeight) =>
  slicePages(syntheticCapture(width, height), pageHeight).length

async function syntheticPng(width: number, height: number): Promise<Blob> {
  const canvas = syntheticCapture(width, height)
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no blob'))), 'image/png'),
  )
}

window.__hotshotPins = {
  add: async (width, height) => await addPin(await syntheticPng(width, height)),
  count: pinCount,
  cycle: cycleFocus,
  undo: undoDismiss,
  clear: dismissAllPins,

  inspect() {
    const hosts = [...document.querySelectorAll('[role="dialog"]')] as HTMLElement[]
    return hosts.map((host) => {
      const badge = host.querySelector('span')
      const tab = host.querySelector('[data-hotshot-grab="tab"]') as HTMLElement | null
      const image = host.querySelector('img') as HTMLImageElement | null
      return {
        number: badge?.textContent ?? '',
        zIndex: Number(host.style.zIndex),
        rect: {
          x: Number.parseFloat(host.style.left),
          y: Number.parseFloat(host.style.top),
          width: Number.parseFloat(host.style.width),
          height: Number.parseFloat(host.style.height),
        },
        opacity: image?.style.opacity ?? '',
        pointerEvents: host.style.pointerEvents,
        tabVisible: tab ? tab.style.display !== 'none' : false,
        focused: document.activeElement === host,
      }
    })
  },
}

window.__hotshotTrimGif = async (frameCount, startMs, endMs) => {
  const width = 24
  const height = 16
  const delayMs = 100
  const frames: Uint8ClampedArray[] = []
  for (let i = 0; i < frameCount; i++) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.fillStyle = `hsl(${(i * 37) % 360} 80% 50%)`
    context.fillRect(0, 0, width, height)
    frames.push(context.getImageData(0, 0, width, height).data)
  }

  const blob = trimGif({ frames, width, height, delayMs }, { startMs, endMs })

  // Count the image descriptors in the encoded file: the assertion is about
  // the FILE, not about what the slicer believed it produced.
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let descriptors = 0
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x2c) descriptors++

  // And that the browser itself can decode it.
  const decodable = await new Promise<boolean>((resolve) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image.naturalWidth === width)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(false)
    }
    image.src = url
  })

  return { size: blob.size, frames: descriptors, decodable }
}
