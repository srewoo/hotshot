import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures'

/**
 * Trimming a GIF, through the real slicer and encoder (PRD §10 v1.1).
 *
 * The assertions are about the FILE — how many image descriptors it contains
 * and whether the browser can decode it — because a trim that produced a
 * plausible-looking but unopenable GIF is the failure that matters.
 */

const harnessPath = fileURLToPath(new URL('./harness/bundle.js', import.meta.url))

test.beforeEach(async ({ page }) => {
  await page.goto('about:blank')
  await page.addScriptTag({ path: harnessPath })
})

const trim = async (
  page: import('@playwright/test').Page,
  frames: number,
  startMs: number,
  endMs: number,
) =>
  await page.evaluate(
    ([f, s, e]) =>
      // @ts-expect-error — harness hook.
      window.__hotshotTrimGif(f, s, e),
    [frames, startMs, endMs] as const,
  )

// 10fps: one frame per 100ms, so 30 frames is three seconds.
test('a full range keeps every frame', async ({ page }) => {
  const result = await trim(page, 30, 0, 3_000)
  expect(result.frames).toBe(30)
  expect(result.decodable, 'the encoded GIF could not be decoded').toBe(true)
})

test('trimming the middle keeps only that span', async ({ page }) => {
  const result = await trim(page, 30, 1_000, 2_000)
  expect(result.frames).toBe(10)
  expect(result.decodable).toBe(true)
})

test('a trimmed GIF is smaller than the whole one', async ({ page }) => {
  const whole = await trim(page, 30, 0, 3_000)
  const part = await trim(page, 30, 0, 1_000)
  expect(part.size).toBeLessThan(whole.size)
})

test('trimming the head drops the leading frames', async ({ page }) => {
  const result = await trim(page, 20, 1_500, 2_000)
  expect(result.frames).toBe(5)
})

/**
 * A reversed drag is normal with two handles on one bar. It must produce a
 * usable file rather than an empty one.
 */
test('a reversed range still produces a decodable GIF', async ({ page }) => {
  const result = await trim(page, 20, 1_800, 400)
  expect(result.frames).toBeGreaterThan(0)
  expect(result.decodable).toBe(true)
})

test('a zero-length range still yields at least one frame, never an empty file', async ({
  page,
}) => {
  const result = await trim(page, 20, 1_000, 1_000)
  expect(result.frames).toBeGreaterThanOrEqual(1)
  expect(result.decodable).toBe(true)
  expect(result.size).toBeGreaterThan(0)
})

test('a range past the end clamps to the recording', async ({ page }) => {
  const result = await trim(page, 20, 0, 99_000)
  expect(result.frames).toBe(20)
})
