import { maxCapturableCssHeight } from '../shared/geometry/canvas-limits'

/**
 * Offscreen stitcher (Architecture §3, PRD FR-2/FR-43).
 *
 * Lives here rather than in the service worker because a 20,000px stitch takes
 * ~17s and MV3 may terminate a worker mid-operation. The worker starts the job
 * and gets out of the way.
 */

interface StitchBegin {
  kind: 'stitch/begin'
  widthDevicePx: number
  totalHeightDevicePx: number
  cssWidth: number
  dpr: number
}

interface StitchTile {
  kind: 'stitch/tile'
  dataUrl: string
  offsetDevicePx: number
}

interface StitchFinish {
  kind: 'stitch/finish'
}

type StitchMessage = StitchBegin | StitchTile | StitchFinish

let canvas: OffscreenCanvas | null = null
let context: OffscreenCanvasRenderingContext2D | null = null

async function begin(message: StitchBegin): Promise<void> {
  // Refuse BEFORE allocating, in device pixels against both Chrome caps.
  // A canvas past the limit does not throw — it silently fails to render,
  // which the user would only discover by looking at a blank PNG.
  const maxCss = maxCapturableCssHeight({ cssWidth: message.cssWidth, dpr: message.dpr })
  const requestedCss = message.totalHeightDevicePx / message.dpr
  if (requestedCss > maxCss) {
    throw new Error(
      `This page is ${Math.round(requestedCss)} CSS px tall; on this display Hotshot can stitch up to ${maxCss}.`,
    )
  }

  canvas = new OffscreenCanvas(message.widthDevicePx, message.totalHeightDevicePx)
  context = canvas.getContext('2d')
  if (!context) throw new Error('Could not acquire a 2D context for stitching.')
}

async function addTile(message: StitchTile): Promise<void> {
  if (!context) throw new Error('A tile arrived before the stitch was started.')
  const response = await fetch(message.dataUrl)
  const bitmap = await createImageBitmap(await response.blob())
  try {
    // Tiles overlap at the document bottom by design (see `planTiles`); drawing
    // at the true offset lets the later tile paint over the duplicate rows.
    context.drawImage(bitmap, 0, message.offsetDevicePx)
  } finally {
    bitmap.close()
  }
}

async function finish(): Promise<string> {
  if (!canvas) throw new Error('Finish was requested before the stitch was started.')
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  const reader = new FileReader()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not encode the stitched image.'))
    reader.readAsDataURL(blob)
  })
  canvas = null
  context = null
  return dataUrl
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as StitchMessage
  if (!msg || typeof msg !== 'object' || !String(msg.kind ?? '').startsWith('stitch/')) {
    return undefined
  }

  void (async () => {
    try {
      if (msg.kind === 'stitch/begin') {
        await begin(msg)
        sendResponse({ ok: true })
      } else if (msg.kind === 'stitch/tile') {
        await addTile(msg)
        sendResponse({ ok: true })
      } else {
        sendResponse({ ok: true, dataUrl: await finish() })
      }
    } catch (error) {
      // Reset so a failed stitch cannot leave a half-built canvas behind for
      // the next attempt to draw into.
      canvas = null
      context = null
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })()

  return true
})
