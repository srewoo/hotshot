import { createCompositor, type Compositor, type CompositorSpec } from './composite'

/**
 * Offscreen stitcher (Architecture §3, PRD FR-2/FR-5/FR-43).
 *
 * Lives here rather than in the service worker because a 20,000px stitch takes
 * ~17s and MV3 may terminate a worker mid-operation. The worker starts the job
 * and gets out of the way.
 *
 * This module is the message plumbing only; the geometry is `composite.ts`,
 * which is driven directly by its own browser test.
 */

interface StitchBegin extends CompositorSpec {
  kind: 'stitch/begin'
}

interface StitchTile {
  kind: 'stitch/tile'
  dataUrl: string
  /** May be negative: see `Tile.offsetCssPx`. */
  offsetDevicePx: number
}

interface StitchFinish {
  kind: 'stitch/finish'
}

type StitchMessage = StitchBegin | StitchTile | StitchFinish

let compositor: Compositor | null = null

function begin(message: StitchBegin): void {
  compositor = createCompositor(message)
}

async function addTile(message: StitchTile): Promise<void> {
  if (!compositor) throw new Error('A tile arrived before the stitch was started.')
  const response = await fetch(message.dataUrl)
  const bitmap = await createImageBitmap(await response.blob())
  try {
    compositor.addTile(bitmap, message.offsetDevicePx)
  } finally {
    bitmap.close()
  }
}

async function finish(): Promise<string> {
  if (!compositor) throw new Error('Finish was requested before the stitch was started.')
  const blob = await compositor.finish()
  const reader = new FileReader()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not encode the stitched image.'))
    reader.readAsDataURL(blob)
  })
  compositor = null
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
        begin(msg)
        sendResponse({ ok: true })
      } else if (msg.kind === 'stitch/tile') {
        await addTile(msg)
        sendResponse({ ok: true })
      } else {
        sendResponse({ ok: true, dataUrl: await finish() })
      }
    } catch (error: unknown) {
      // Reported rather than thrown: the worker is waiting on this reply and a
      // rejected promise here would hang the capture instead of failing it.
      compositor = null
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })()

  return true // keep the channel open for the async response
})
