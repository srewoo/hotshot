import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures'
import { decodePng, type Bitmap } from './png'

/**
 * The stitcher's geometry, driven directly (PRD FR-2, FR-5, FR-43).
 *
 * `OffscreenCanvas` and `createImageBitmap` do not exist in Node, so this is a
 * browser test — but it is a UNIT test of `composite.ts`, not an end-to-end
 * one: synthetic tiles in, PNG out, pixels asserted. It exists because a
 * bounded element capture composites at negative offsets in both axes, and an
 * inverted sign there produces a plausible image of the wrong region, which no
 * screenshot review would catch.
 */

const harnessPath = fileURLToPath(new URL('./harness/bundle.js', import.meta.url))

interface Spec {
  widthDevicePx: number
  totalHeightDevicePx: number
  cssWidth: number
  dpr: number
  originXDevicePx?: number
}

async function composite(
  page: import('@playwright/test').Page,
  spec: Spec,
  tile: { width: number; height: number },
  tiles: ReadonlyArray<{ colour: string; offsetDevicePx: number }>,
): Promise<Bitmap> {
  const dataUrl = await page.evaluate(
    ([s, t, list]) =>
      // @ts-expect-error — harness hook.
      window.__hotshotComposite(s, t.width, t.height, list),
    [spec, tile, tiles] as const,
  )
  return decodePng(Buffer.from(String(dataUrl).split(',')[1] as string, 'base64'))
}

function pixel(bitmap: Bitmap, x: number, y: number): [number, number, number, number] {
  const i = (y * bitmap.width + x) * 4
  return [bitmap.data[i]!, bitmap.data[i + 1]!, bitmap.data[i + 2]!, bitmap.data[i + 3]!]
}

const RED = [255, 0, 0] as const
const GREEN = [0, 128, 0] as const
const BLUE = [0, 0, 255] as const

function expectColour(
  bitmap: Bitmap,
  x: number,
  y: number,
  [r, g, b]: readonly [number, number, number],
  what: string,
): void {
  const [pr, pg, pb] = pixel(bitmap, x, y)
  expect({ what, x, y, rgb: [pr, pg, pb] }).toEqual({ what, x, y, rgb: [r, g, b] })
}

test.beforeEach(async ({ page }) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: harnessPath })
})

test('a whole-page stitch stacks its tiles in order', async ({ page }) => {
  const shot = await composite(
    page,
    { widthDevicePx: 400, totalHeightDevicePx: 300, cssWidth: 400, dpr: 1 },
    { width: 400, height: 100 },
    [
      { colour: 'red', offsetDevicePx: 0 },
      { colour: 'green', offsetDevicePx: 100 },
      { colour: 'blue', offsetDevicePx: 200 },
    ],
  )

  expect([shot.width, shot.height]).toEqual([400, 300])
  expectColour(shot, 200, 50, RED, 'first tile')
  expectColour(shot, 200, 150, GREEN, 'second tile')
  expectColour(shot, 200, 250, BLUE, 'third tile')
})

test('an overlapping final tile is painted over, not blended', async ({ page }) => {
  // The scheduler pins the last tile to the page bottom rather than
  // overscrolling, so it overlaps its predecessor by design.
  const shot = await composite(
    page,
    { widthDevicePx: 400, totalHeightDevicePx: 250, cssWidth: 400, dpr: 1 },
    { width: 400, height: 100 },
    [
      { colour: 'red', offsetDevicePx: 0 },
      { colour: 'green', offsetDevicePx: 100 },
      { colour: 'blue', offsetDevicePx: 150 },
    ],
  )

  // Rows 150-250 belong to the LAST tile, including the 50px it overlaps.
  expectColour(shot, 200, 120, GREEN, 'the un-overlapped part of tile two')
  expectColour(shot, 200, 160, BLUE, 'the overlapped rows belong to the later tile')
  expectColour(shot, 200, 249, BLUE, 'the final row')
})

test('a bounded capture crops horizontally to the element (FR-5)', async ({ page }) => {
  // A 200px-wide element starting 120px into a 400px-wide viewport.
  const shot = await composite(
    page,
    {
      widthDevicePx: 200,
      totalHeightDevicePx: 200,
      cssWidth: 200,
      dpr: 1,
      originXDevicePx: 120,
    },
    { width: 400, height: 100 },
    [
      { colour: 'red', offsetDevicePx: 0 },
      { colour: 'green', offsetDevicePx: 100 },
    ],
  )

  expect([shot.width, shot.height]).toEqual([200, 200])
  // Every pixel is tile content: the crop lands inside the tile, so no
  // transparent edge is exposed.
  expectColour(shot, 0, 50, RED, 'the crop’s left edge')
  expectColour(shot, 199, 50, RED, 'the crop’s right edge')
  expectColour(shot, 0, 150, GREEN, 'the second tile, cropped alike')

  // The stripe painted down each tile's left edge is at x=0..4 of the TILE,
  // which the crop cuts away. Finding it would mean the origin was ignored.
  const stripe = pixel(shot, 1, 10)
  expect(stripe.slice(0, 3), 'the tile’s left edge was not cropped away').not.toEqual([
    0, 0, 0,
  ])
})

test('a band against the page bottom clips from above (negative offset)', async ({ page }) => {
  // The band is 60px tall but the page could only be scrolled to 40px above
  // it, so the single tile carries 40px of content that belongs above the
  // band. `planTiles` reports offsetCssPx: -40 for exactly this case.
  const shot = await composite(
    page,
    { widthDevicePx: 400, totalHeightDevicePx: 60, cssWidth: 400, dpr: 1 },
    { width: 400, height: 100 },
    [{ colour: 'red', offsetDevicePx: -40 }],
  )

  expect([shot.width, shot.height]).toEqual([400, 60])
  expectColour(shot, 200, 0, RED, 'the band starts inside the tile')
  expectColour(shot, 200, 59, RED, 'and runs to the end of the band')

  // The stripe is 8px tall from the tile's top; at -40 it is entirely above
  // the canvas, so none of it should appear.
  const topLeft = pixel(shot, 1, 0)
  expect(topLeft.slice(0, 3), 'content above the band was not clipped').toEqual([255, 0, 0])
})

test('both offsets apply together, which is the real FR-5 case', async ({ page }) => {
  const shot = await composite(
    page,
    {
      widthDevicePx: 150,
      totalHeightDevicePx: 120,
      cssWidth: 150,
      dpr: 1,
      originXDevicePx: 100,
    },
    { width: 400, height: 100 },
    [
      { colour: 'red', offsetDevicePx: -30 },
      { colour: 'green', offsetDevicePx: 70 },
    ],
  )

  expect([shot.width, shot.height]).toEqual([150, 120])
  expectColour(shot, 75, 0, RED, 'the first tile, clipped from above')
  expectColour(shot, 75, 69, RED, 'up to where the second begins')
  expectColour(shot, 75, 70, GREEN, 'the second tile')
  expectColour(shot, 75, 119, GREEN, 'to the end of the band')
})

test('refuses a capture past the canvas area cap instead of returning a blank PNG', async ({
  page,
}) => {
  // 5,120 device px wide at DPR 2 with a 30,000 CSS px height is over
  // Chrome's ~268M px area cap. Exceeding it yields a non-rendering canvas
  // rather than an error, which is the silent failure FR-43 exists to stop.
  const failed = await page.evaluate(async () => {
    try {
      // @ts-expect-error — harness hook.
      await window.__hotshotComposite(
        {
          widthDevicePx: 5_120,
          totalHeightDevicePx: 60_000,
          cssWidth: 2_560,
          dpr: 2,
        },
        10,
        10,
        [],
      )
      return null
    } catch (error) {
      return String(error)
    }
  })

  expect(failed, 'an over-cap capture was accepted').toContain('Hotshot can stitch up to')
})
