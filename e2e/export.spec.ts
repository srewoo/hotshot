import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures'

/**
 * Export formats, through the real encoders (PRD FR-39, §7 limits).
 *
 * `canvas.toBlob` and JPEG encoding only exist in a browser, so the pipeline is
 * driven here — but the assertions are about the FILES: their magic bytes,
 * their page count, their size against a limit. A test that only checked the
 * blob's `type` would pass on an empty file.
 */

const harnessPath = fileURLToPath(new URL('./harness/bundle.js', import.meta.url))

test.beforeEach(async ({ page }) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: harnessPath })
})

async function exportAs(
  page: import('@playwright/test').Page,
  width: number,
  height: number,
  kind: 'png' | 'jpeg' | 'pdf',
) {
  return await page.evaluate(
    ([w, h, k]) =>
      // @ts-expect-error — harness hook.
      window.__hotshotExport(w, h, k),
    [width, height, kind] as const,
  )
}

test('PNG export is a real PNG', async ({ page }) => {
  const result = await exportAs(page, 400, 300, 'png')
  expect(result.type).toBe('image/png')
  expect(result.extension).toBe('.png')
  // The PNG signature.
  expect(result.head).toBe('89504e470d0a1a0a')
  expect(result.size).toBeGreaterThan(1_000)
})

test('JPG export is a real JPEG, and smaller than the PNG', async ({ page }) => {
  const png = await exportAs(page, 600, 500, 'png')
  const jpg = await exportAs(page, 600, 500, 'jpeg')

  expect(jpg.type).toBe('image/jpeg')
  // `.jpg`, which is what every other tool writes.
  expect(jpg.extension).toBe('.jpg')
  // JPEG SOI marker.
  expect(jpg.head.startsWith('ffd8ff')).toBe(true)
  expect(jpg.size, 'JPG was not smaller than PNG on photographic content').toBeLessThan(png.size)
})

test('PDF export is a real PDF with one page for a short capture', async ({ page }) => {
  const result = await exportAs(page, 600, 400, 'pdf')
  expect(result.type).toBe('application/pdf')
  expect(result.extension).toBe('.pdf')
  // "%PDF-1.4"
  expect(result.head).toBe('255044462d312e34')
  expect(result.pageCount).toBe(1)
})

/**
 * The "sophisticated PDF" part: a full-page stitch is a document, and a
 * document is paged. One 9,000px sheet is not something anyone can print.
 */
test('a tall capture becomes a multi-page PDF', async ({ page }) => {
  // 800 wide gives a page height of 800 * 1123/794 ≈ 1131px, so 4,000px is
  // four pages.
  const result = await exportAs(page, 800, 4_000, 'pdf')
  expect(result.pageCount).toBe(4)
  expect(result.size).toBeGreaterThan(10_000)
})

test('page slicing covers the capture exactly, with no lost strip', async ({ page }) => {
  const counts = await page.evaluate(() => ({
    // @ts-expect-error — harness hook.
    exact: window.__hotshotSliceCount(400, 1_200, 400),
    // @ts-expect-error — harness hook.
    remainder: window.__hotshotSliceCount(400, 1_250, 400),
    // @ts-expect-error — harness hook.
    shorter: window.__hotshotSliceCount(400, 300, 400),
    // @ts-expect-error — harness hook.
    onePixelOver: window.__hotshotSliceCount(400, 401, 400),
  }))

  expect(counts.exact).toBe(3)
  // The remaining 50px is its own page rather than being dropped.
  expect(counts.remainder).toBe(4)
  // A capture shorter than a page is one page, not zero.
  expect(counts.shorter).toBe(1)
  expect(counts.onePixelOver).toBe(2)
})

test.describe('fitting an upload to a destination limit', () => {
  test('keeps the PNG when it already fits', async ({ page }) => {
    const fitted = await page.evaluate(() =>
      // @ts-expect-error — harness hook.
      window.__hotshotFit(400, 300, 10_000_000),
    )
    expect(fitted.type).toBe('image/png')
    expect(fitted.note, 'a lossless fit must not warn').toBeNull()
  })

  test('converts and reports when the PNG is over the limit', async ({ page }) => {
    // A detailed 1,200x2,400 capture PNGs to well over 200 KB.
    const fitted = await page.evaluate(() =>
      // @ts-expect-error — harness hook.
      window.__hotshotFit(1_200, 2_400, 200_000),
    )
    expect(fitted.size).toBeLessThanOrEqual(200_000)
    expect(fitted.type).toBe('image/jpeg')
    expect(fitted.note, 'the user was not told what was given up').toContain('JPG')
  })

  test('scales down when quality alone cannot reach the limit', async ({ page }) => {
    // The harness capture is deliberately worst-case — colour bars and text on
    // every row — so it PNGs to ~580 KB at this size and no full-size JPEG
    // quality reaches 400 KB. Real screenshots are mostly flat and rarely get
    // this far down the ladder.
    const fitted = await page.evaluate(() =>
      // @ts-expect-error — harness hook.
      window.__hotshotFit(1_600, 3_200, 400_000),
    )
    expect(fitted.size).toBeLessThanOrEqual(400_000)
    expect(fitted.note).toContain('scaled')
  })

  test('refuses loudly when nothing on the ladder fits', async ({ page }) => {
    const failure = await page.evaluate(async () => {
      try {
        // @ts-expect-error — harness hook.
        await window.__hotshotFit(2_000, 4_000, 200)
        return null
      } catch (error) {
        return String(error)
      }
    })
    // Not a truncated file, and not a silent success.
    expect(failure).toContain('too large')
  })
})
