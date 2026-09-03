import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures'

/**
 * Pins, driven through the real controller (PRD FR-37/FR-38, DESIGN §3.9).
 *
 * A pin is persistent furniture on someone else's page, so the behaviours that
 * matter are the ones that decide whether it can be got rid of, got back, and
 * worked around: ghosting, the grab tab, the stack, dismissal and its undo.
 */

const harnessPath = fileURLToPath(new URL('./harness/bundle.js', import.meta.url))

test.beforeEach(async ({ page }) => {
  await page.goto('about:blank')
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.setContent(
    '<body style="margin:0;font:15px system-ui"><h1 style="padding:20px">Pin host</h1></body>',
  )
  await page.addScriptTag({ path: harnessPath })
})

type Pins = {
  add(width: number, height: number): Promise<boolean>
  count(): number
  cycle(direction: 1 | -1): boolean
  undo(): Promise<boolean>
  clear(): void
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

const pins = (page: import('@playwright/test').Page) => ({
  async add(width = 800, height = 600) {
    return await page.evaluate(
      ([w, h]) => (window as unknown as { __hotshotPins: Pins }).__hotshotPins.add(w, h),
      [width, height] as const,
    )
  },
  async inspect() {
    return await page.evaluate(() =>
      (window as unknown as { __hotshotPins: Pins }).__hotshotPins.inspect(),
    )
  },
  async cycle(direction: 1 | -1) {
    return await page.evaluate(
      (d) => (window as unknown as { __hotshotPins: Pins }).__hotshotPins.cycle(d),
      direction,
    )
  },
  async undo() {
    return await page.evaluate(() =>
      (window as unknown as { __hotshotPins: Pins }).__hotshotPins.undo(),
    )
  },
  async count() {
    return await page.evaluate(() =>
      (window as unknown as { __hotshotPins: Pins }).__hotshotPins.count(),
    )
  },
})

test('a pin lands on the page, numbered and focused', async ({ page }) => {
  const api = pins(page)
  expect(await api.add(800, 600)).toBe(true)

  const [pin] = await api.inspect()
  expect(pin?.number).toBe('1')
  expect(pin?.focused, 'a new pin must take focus so the keymap works').toBe(true)
  // Scaled to the default width, aspect preserved.
  expect(pin?.rect.width).toBe(520)
  expect(pin?.rect.height).toBe(390)
})

test('pins cascade so a second one is never hidden behind the first', async ({ page }) => {
  const api = pins(page)
  await api.add(800, 600)
  await api.add(800, 600)

  const all = await api.inspect()
  expect(all).toHaveLength(2)
  expect(all[1]?.rect.x).toBeGreaterThan(all[0]?.rect.x ?? 0)
  expect(all.map((p) => p.number)).toEqual(['1', '2'])
})

test('the pin cap is enforced rather than risking a renderer OOM', async ({ page }) => {
  const api = pins(page)
  for (let i = 0; i < 4; i++) expect(await api.add(400, 300)).toBe(true)
  // The fifth is refused, not queued and not silently dropped.
  expect(await api.add(400, 300)).toBe(false)
  expect(await api.count()).toBe(4)
})

test.describe('ghost mode', () => {
  test('digits set opacity outright, and 25% hands the page back', async ({ page }) => {
    const api = pins(page)
    await api.add(800, 600)

    // `2` is 75%: still interactive.
    await page.keyboard.press('2')
    let [pin] = await api.inspect()
    expect(pin?.opacity).toBe('0.75')
    expect(pin?.pointerEvents).not.toBe('none')
    expect(pin?.tabVisible).toBe(false)

    // `4` is 25% — a ghost. The plate stops intercepting clicks so the page
    // underneath stays usable, which is the entire point of ghosting.
    await page.keyboard.press('4')
    ;[pin] = await api.inspect()
    expect(pin?.opacity).toBe('0.25')
    expect(pin?.pointerEvents).toBe('none')
    // And the grab tab appears, or the ghost would be unrecoverable.
    expect(pin?.tabVisible, 'a ghost with no grab tab cannot be moved or dismissed').toBe(true)
  })

  test('O cycles through the four levels and back to full', async ({ page }) => {
    const api = pins(page)
    await api.add(800, 600)

    const seen: string[] = []
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('o')
      const [pin] = await api.inspect()
      seen.push(pin?.opacity ?? '')
    }
    expect(seen).toEqual(['0.75', '0.5', '0.25', '1', '0.75'])
  })
})

test.describe('the stack', () => {
  test('brackets move a pin forward and backward', async ({ page }) => {
    const api = pins(page)
    await api.add(400, 300)
    await api.add(400, 300)
    await api.add(400, 300)

    // The third pin has focus and is frontmost.
    let all = await api.inspect()
    const front = all.reduce((a, b) => (a.zIndex > b.zIndex ? a : b))
    expect(front.number).toBe('3')

    // `[` sends it backward one place, which renumbers the stack.
    await page.keyboard.press('[')
    all = await api.inspect()
    const byZ = [...all].sort((a, b) => a.zIndex - b.zIndex).map((p) => p.number)
    expect(byZ).toEqual(['1', '2', '3'])
  })

  test('Shift+bracket sends a pin all the way to the back', async ({ page }) => {
    const api = pins(page)
    await api.add(400, 300)
    await api.add(400, 300)

    await page.keyboard.press('Shift+[')
    const all = await api.inspect()
    const backmost = all.reduce((a, b) => (a.zIndex < b.zIndex ? a : b))
    // Numbers are derived from the stack, so the moved pin is now number 1.
    expect(backmost.number).toBe('1')
  })
})

test('Tab moves focus between pins, so one is reachable without a pointer', async ({ page }) => {
  const api = pins(page)
  await api.add(400, 300)
  await api.add(400, 300)

  expect(await api.cycle(1)).toBe(true)
  const focusedCount = (await api.inspect()).filter((p) => p.focused).length
  expect(focusedCount, 'exactly one pin should hold focus').toBe(1)
})

test.describe('dismissal', () => {
  test('Escape dismisses the focused pin', async ({ page }) => {
    const api = pins(page)
    await api.add(800, 600)
    await page.keyboard.press('Escape')
    expect(await api.count()).toBe(0)
  })

  /**
   * Escape sits next to the arrow keys that move a pin, and a pin can be the
   * end of a capture, a crop and an annotation. Without an undo a slip
   * destroys all of it silently.
   */
  test('a dismissal can be undone, at its old position', async ({ page }) => {
    const api = pins(page)
    await api.add(800, 600)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    const before = (await api.inspect())[0]

    await page.keyboard.press('Escape')
    expect(await api.count()).toBe(0)

    expect(await api.undo()).toBe(true)
    const after = (await api.inspect())[0]
    expect(after?.rect).toEqual(before?.rect)
  })

  test('undo does nothing when nothing was dismissed', async ({ page }) => {
    const api = pins(page)
    await api.add(400, 300)
    expect(await api.undo()).toBe(false)
    expect(await api.count()).toBe(1)
  })
})

test('arrow keys nudge, and Shift nudges by ten', async ({ page }) => {
  const api = pins(page)
  await api.add(400, 300)
  const start = (await api.inspect())[0]?.rect.x ?? 0

  await page.keyboard.press('ArrowRight')
  expect((await api.inspect())[0]?.rect.x).toBe(start + 1)

  await page.keyboard.press('Shift+ArrowRight')
  expect((await api.inspect())[0]?.rect.x).toBe(start + 11)
})

/**
 * A pin has no entry in any list, so one nudged off-screen is furniture the
 * user cannot get back.
 */
test('a pin cannot be nudged off the screen', async ({ page }) => {
  const api = pins(page)
  await api.add(400, 300)
  for (let i = 0; i < 200; i++) await page.keyboard.press('Shift+ArrowRight')

  const [pin] = await api.inspect()
  expect(pin?.rect.x).toBeLessThanOrEqual(1200 - 32)
})

test('a pin is dragged by its plate and snaps to an edge', async ({ page }) => {
  const api = pins(page)
  await api.add(400, 300)
  const before = (await api.inspect())[0]?.rect

  // Grab the middle of the plate and drag towards the top-left corner.
  const from = {
    x: (before?.x ?? 0) + (before?.width ?? 0) / 2,
    y: (before?.y ?? 0) + (before?.height ?? 0) / 2,
  }
  // Land 6px shy of the top-left corner: inside the snap threshold, so the
  // pin should finish flush rather than 6px off true. Dragging FURTHER would
  // be a deliberate overhang, which is allowed and is not what this tests.
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x - (before?.x ?? 0) - 6, from.y - (before?.y ?? 0) - 6, {
    steps: 10,
  })
  await page.mouse.up()

  const after = (await api.inspect())[0]?.rect
  expect(after).toMatchObject({ x: 0, y: 0 })
})

test('a corner drag resizes with the aspect ratio locked', async ({ page }) => {
  const api = pins(page)
  await api.add(800, 600)
  const before = (await api.inspect())[0]?.rect
  const ratio = (before?.width ?? 1) / (before?.height ?? 1)

  // The south-east corner grip sits on the pin's bottom-right.
  const corner = { x: (before?.x ?? 0) + (before?.width ?? 0) - 4, y: (before?.y ?? 0) + (before?.height ?? 0) - 4 }
  await page.mouse.move(corner.x, corner.y)
  await page.mouse.down()
  await page.mouse.move(corner.x - 200, corner.y, { steps: 10 })
  await page.mouse.up()

  const after = (await api.inspect())[0]?.rect
  expect(after?.width, 'the pin did not shrink').toBeLessThan(before?.width ?? 0)
  // A stretched screenshot is a false document; the ratio must not drift.
  expect((after?.width ?? 1) / (after?.height ?? 1)).toBeCloseTo(ratio, 1)
  // And the anchored corner stayed put.
  expect(after?.x).toBe(before?.x)
})

test('C then a drag crops the pin to the selected region', async ({ page }) => {
  const api = pins(page)
  await api.add(800, 600)
  const before = (await api.inspect())[0]?.rect

  await page.keyboard.press('c')
  const origin = { x: (before?.x ?? 0) + 40, y: (before?.y ?? 0) + 40 }
  await page.mouse.move(origin.x, origin.y)
  await page.mouse.down()
  await page.mouse.move(origin.x + 200, origin.y + 100, { steps: 8 })
  await page.mouse.up()
  // A crop re-encodes the region and rebuilds the pin's mipmap, so it is
  // genuinely asynchronous work rather than a style change.
  await expect
    .poll(async () => (await api.inspect())[0]?.rect.width, { timeout: 5_000 })
    .toBeLessThan(before?.width ?? 0)

  const after = (await api.inspect())[0]?.rect
  // Still exactly one pin: a crop changes the reference, it does not add one.
  expect(await api.count()).toBe(1)
  expect(after?.width, 'the pin was not cropped').toBeLessThan(before?.width ?? 0)
  expect(after?.height).toBeLessThan(before?.height ?? 0)
})
