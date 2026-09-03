import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'
import { test, expect } from './fixtures'
import { boundsNear, countNear, crop, decodePng, type Bitmap } from './png'

/**
 * Visual smoke test of every surface.
 *
 * Extension pages are driven for real. The capture overlay and editor are
 * driven with a STUBBED backdrop response, because `captureVisibleTab` needs
 * an `activeTab` grant that only a real user gesture produces — Playwright
 * cannot synthesise one. Everything downstream of that single stub is the
 * real code: real selection maths, real annotation rendering, real encoder.
 */

const contentScriptPath = fileURLToPath(new URL('../dist/content.js', import.meta.url))
/**
 * The editor chunk, which production injects on demand (PRD §6). These tests
 * pre-inject it: `addScriptTag` cannot ask the worker for an injection, and
 * both chunks share one global either way. The handshake itself is covered by
 * its own test in `extension.spec.ts`.
 */
const editorScriptPath = fileURLToPath(new URL('../dist/editor.js', import.meta.url))
const harnessPath = fileURLToPath(new URL('./harness/bundle.js', import.meta.url))
const shots = fileURLToPath(new URL('../test-results/shots', import.meta.url))
mkdirSync(shots, { recursive: true })

/** Palette entries 1 and 5 (`toolbar.PALETTE`). */
const FLARE: readonly [number, number, number] = [255, 90, 0]
const BLUE: readonly [number, number, number] = [31, 111, 235]

/**
 * Where a 600x400 crop lands in a 1200x800 viewport: the editor shows it 1:1
 * (fit-width never magnifies) and centres it in the stage, inset a little to
 * stay clear of the canvas border.
 */
const CANVAS = { x: 302, y: 140, width: 596, height: 396 }

/** Counts a colour ON THE CAPTURE, excluding the same-palette chrome. */
function inkCount(shot: Bitmap, colour: readonly [number, number, number]): number {
  return countNear(crop(shot, CANVAS), colour)
}

/** The extent of a mark, in viewport coordinates so it can be clicked. */
function inkBounds(shot: Bitmap, colour: readonly [number, number, number]) {
  const local = boundsNear(crop(shot, CANVAS), colour)
  return {
    minX: local.minX + CANVAS.x,
    minY: local.minY + CANVAS.y,
    maxX: local.maxX + CANVAS.x,
    maxY: local.maxY + CANVAS.y,
    count: local.count,
  }
}

test.describe('extension pages', () => {
  for (const [name, path] of [
    ['popup', 'src/ui/popup/index.html'],
    ['settings', 'src/ui/settings/index.html'],
    ['library', 'src/ui/library/index.html'],
    ['onboarding', 'src/ui/onboarding/index.html'],
  ] as const) {
    test(`${name} renders`, async ({ page, extensionId }) => {
      await page.goto(`chrome-extension://${extensionId}/${path}`)
      await page.waitForLoadState('networkidle')
      await page.screenshot({ path: `${shots}/${name}.png`, fullPage: name !== 'popup' })
      expect(await page.locator('body').innerText()).not.toBe('')
    })
  }
})

/**
 * Installs a minimal `chrome` stand-in and returns a handle for dispatching
 * messages to whatever listener the content script registers.
 */
async function stubRuntime(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    type Listener = (
      m: unknown,
      sender: unknown,
      sendResponse: (r: unknown) => void,
    ) => boolean | undefined
    const listeners: Listener[] = []
    // Everything the content script sends out, and everything it replies with,
    // so a test can assert on the messages instead of only on pixels.
    const sent: Array<{ kind?: string }> = []
    const replies: unknown[] = []

    // A 400x300 backdrop drawn in-page, so the crop has real pixels to cut.
    function backdrop(): string {
      const canvas = document.createElement('canvas')
      canvas.width = 1200
      canvas.height = 800
      const c = canvas.getContext('2d')!
      c.fillStyle = '#f4f1ea'
      c.fillRect(0, 0, 1200, 800)
      // Deliberately NOT the annotation palette. These bars stand in for page
      // content, and when they shared colours with the marks under test every
      // colour assertion was silently reading the page instead of the ink.
      for (let i = 0; i < 12; i++) {
        c.fillStyle = ['#0F7D8F', '#6B3FA0', '#7A5230', '#3B4A5A'][i % 4]!
        c.fillRect(60 + i * 90, 120 + (i % 3) * 140, 70, 100)
      }
      c.fillStyle = '#171716'
      c.font = '600 34px system-ui'
      c.fillText('Hotshot smoke test page', 60, 70)
      return canvas.toDataURL('image/png')
    }

    // @ts-expect-error — deliberately partial stand-in for the extension APIs.
    window.chrome = {
      runtime: {
        onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
        async sendMessage(message: { kind?: string }) {
          sent.push(message)
          if (message?.kind === 'capture/request-backdrop') {
            // A test can hold the reply back to observe phase 1 on its own.
            // @ts-expect-error — test hook.
            const delay = Number(window.__backdropDelayMs ?? 0)
            if (delay > 0) await new Promise((r) => setTimeout(r, delay))
            return { ok: true, dataUrl: backdrop(), zoom: 1, dpr: 1 }
          }
          if (message?.kind === 'destinations/list') {
            return { configured: ['jira', 'clickup'], remembered: { jira: 'ABC-412' } }
          }
          if (message?.kind === 'destinations/ship') {
            return { ok: true, message: 'Sent', url: 'https://acme.atlassian.net/browse/ABC-412' }
          }
          if (message?.kind === 'destinations/search') {
            const query = String((message as { query?: unknown }).query ?? '').toLowerCase()
            const all = [
              { key: 'ABC-412', title: 'Invoice table overflows on Safari', hint: 'ABC-412' },
              { key: 'ABC-98', title: 'Login fails after SSO redirect', hint: 'ABC-98' },
              { key: 'ABC-7', title: 'Add CSV export', hint: 'ABC-7' },
            ]
            return {
              ok: true,
              candidates: query
                ? all.filter((c) => c.title.toLowerCase().includes(query) || c.key.toLowerCase().includes(query))
                : all,
            }
          }
          return undefined
        },
      },
    }

    // @ts-expect-error — test-only hook for dispatching to the content script.
    // Mirrors Chrome's real listener signature: a sender and a one-shot
    // `sendResponse`. Passing only the message hid the reply path entirely,
    // and the full-page handoff depends on that reply.
    window.__deliver = (message: unknown) =>
      listeners.forEach((fn) => fn(message, { tab: { id: 1 } }, (reply) => replies.push(reply)))
    // @ts-expect-error — test-only hook.
    window.__sent = sent
    // @ts-expect-error — test-only hook.
    window.__replies = replies
  })
}

test.describe('capture overlay and editor', () => {
  test('region overlay, selection, annotation and destinations', async ({ context }) => {
    const page = await context.newPage()
    await stubRuntime(page)
    await page.goto('about:blank')
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.setContent(
      `<body style="margin:0;font:15px system-ui;background:#f4f1ea">
         <h1 style="padding:24px">Hotshot smoke test page</h1>
         <div id="card" style="margin:24px;width:420px;height:220px;background:#fff;border:1px solid #ccc;padding:20px">
           <h2 style="margin:0">A card to capture</h2>
           <p id="para">Some body text inside the card.</p>
         </div>
       </body>`,
    )
    await page.addScriptTag({ path: contentScriptPath })
    await page.addScriptTag({ path: editorScriptPath })

    // 1. Overlay mounts.
    await page.evaluate(() =>
      // @ts-expect-error — test hook installed above.
      window.__deliver({ kind: 'capture/begin', mode: 'region', tabId: 1 }),
    )
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${shots}/overlay-idle.png` })

    // 2. Drag a selection — real pointer events through the real controller.
    await page.mouse.move(120, 180)
    await page.mouse.down()
    await page.mouse.move(560, 460, { steps: 12 })
    await page.screenshot({ path: `${shots}/overlay-dragging.png` })
    await page.mouse.up()
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${shots}/overlay-selected.png` })

    // 3. Commit to the editor.
    await page.keyboard.press('Enter')
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${shots}/editor.png` })

    // 4. Draw with the real annotation pipeline.
    await page.keyboard.press('KeyA') // arrow
    await page.mouse.move(500, 300)
    await page.mouse.down()
    await page.mouse.move(700, 420, { steps: 8 })
    await page.mouse.up()

    await page.keyboard.press('KeyN') // numbered badge
    await page.mouse.click(560, 350)
    await page.mouse.click(640, 400)

    await page.keyboard.press('Digit2') // second palette colour
    await page.keyboard.press('KeyB') // rectangle
    // Inside the canvas: it starts around y=258, and a drag beginning above it
    // lands on the stage and draws nothing.
    await page.mouse.move(440, 300)
    await page.mouse.down()
    await page.mouse.move(560, 400, { steps: 6 })
    await page.mouse.up()

    // The editor lives in a CLOSED shadow root, so page JS cannot reach its
    // canvas — the screenshot is the only honest observation point.
    const shot = decodePng(await page.screenshot())
    const flarePixels = countNear(shot, [255, 90, 0])
    expect(flarePixels, 'annotations did not reach the canvas').toBeGreaterThan(500)

    await page.waitForTimeout(300)
    await page.screenshot({ path: `${shots}/editor-annotated.png` })

    expect(await page.locator('body').count()).toBe(1)
    await page.close()
  })

  /**
   * The regression this locks down: a full-page stitch used to be injected
   * into the page as an `<a download>` click, so the one mode that most needs
   * annotation could not be annotated, and it never reached the library
   * because the library is written by the editor's own commit.
   */
  test('a full-page stitch opens the editor and reaches history', async ({ context }) => {
    const page = await context.newPage()
    await stubRuntime(page)
    await page.goto('about:blank')
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.setContent(
      `<body style="margin:0;font:15px system-ui;background:#fff">
         <h1 style="padding:24px">A page taller than the viewport</h1>
         <div style="height:2400px;background:linear-gradient(#fff,#ddd)"></div>
       </body>`,
    )
    await page.addScriptTag({ path: contentScriptPath })
    await page.addScriptTag({ path: editorScriptPath })

    // A stitch is taller than the viewport by definition — the editor has to
    // scale it down to fit, which is the case a viewport-sized crop never hits.
    const downloads = await page.evaluate(() => {
      const clicked: string[] = []
      const realClick = HTMLAnchorElement.prototype.click
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        if (this.download) clicked.push(this.download)
        else realClick.call(this)
      }
      const canvas = document.createElement('canvas')
      canvas.width = 1200
      canvas.height = 2400
      const c = canvas.getContext('2d')!
      c.fillStyle = '#f4f1ea'
      c.fillRect(0, 0, 1200, 2400)
      c.fillStyle = '#1f6feb'
      c.fillRect(80, 1600, 400, 300)
      // @ts-expect-error — test hook installed by stubRuntime.
      window.__deliver({
        kind: 'capture/stitched',
        dataUrl: canvas.toDataURL('image/png'),
        partialWarning: null,
      })
      return clicked
    })
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${shots}/fullpage-editor.png` })

    // 1. The editor is up: the reply the worker waits on came back ok, so the
    //    worker's download fallback stays holstered.
    // @ts-expect-error — test hook.
    expect(await page.evaluate(() => window.__replies)).toEqual([{ ok: true }])
    expect(downloads, 'the stitch must not download behind the editor').toEqual([])

    // 2. It is a REAL editor: draw with the real annotation pipeline.
    await page.keyboard.press('KeyA')
    await page.mouse.move(500, 300)
    await page.mouse.down()
    await page.mouse.move(700, 460, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(200)

    const shot = decodePng(await page.screenshot())
    expect(
      countNear(shot, [255, 90, 0]),
      'annotations did not reach the stitched canvas',
    ).toBeGreaterThan(500)
    await page.screenshot({ path: `${shots}/fullpage-editor-annotated.png` })

    // 3. Committing writes it to the library at full stitch height.
    await page.keyboard.press('Enter')
    await page.waitForTimeout(600)
    const recorded = await page.evaluate(
      // @ts-expect-error — test hook.
      () => (window.__sent as Array<Record<string, unknown>>).filter((m) => m.kind === 'history/record'),
    )
    expect(recorded, 'the full-page capture never reached history').toHaveLength(1)
    expect(recorded[0]).toMatchObject({ widthDevicePx: 1200, heightDevicePx: 2400 })

    await page.close()
  })

  /**
   * Marks stay editable after they are drawn (FR-7/FR-34).
   *
   * Everything here goes through the real pipeline: real hit-testing against
   * real command geometry, real canvas rendering. The editor lives in a CLOSED
   * shadow root, so the screenshot is the only honest observation point — a
   * mark's colour proves it exists and its extent proves it moved or resized.
   */
  test('a drawn mark can be selected, moved, resized, recoloured and deleted', async ({
    context,
  }) => {
    const page = await context.newPage()
    await stubRuntime(page)
    await page.goto('about:blank')
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.setContent(
      `<body style="margin:0;font:15px system-ui;background:#f4f1ea">
         <h1 style="padding:24px">Editable marks</h1>
       </body>`,
    )
    await page.addScriptTag({ path: contentScriptPath })
    await page.addScriptTag({ path: editorScriptPath })

    await page.evaluate(() =>
      // @ts-expect-error — test hook.
      window.__deliver({ kind: 'capture/begin', mode: 'region', tabId: 1 }),
    )
    await page.waitForTimeout(400)

    // A 600x400 crop, which the editor shows 1:1 and centres: the canvas
    // occupies roughly x 300..900, y 138..538.
    await page.mouse.move(200, 200)
    await page.mouse.down()
    await page.mouse.move(800, 600, { steps: 10 })
    await page.mouse.up()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)

    // 1. Draw a rectangle. It commits selected, so the palette applies to it.
    await page.keyboard.press('KeyB')
    await page.mouse.move(450, 250)
    await page.mouse.down()
    await page.mouse.move(700, 420, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    expect(inkCount(decodePng(await page.screenshot()), FLARE)).toBeGreaterThan(300)
    await page.screenshot({ path: `${shots}/edit-1-drawn.png` })

    // 2. Recolour the selection with a palette key.
    await page.keyboard.press('Digit5')
    await page.waitForTimeout(200)
    const recoloured = decodePng(await page.screenshot())
    expect(inkCount(recoloured, BLUE), 'the mark did not take the new colour').toBeGreaterThan(300)
    expect(inkCount(recoloured, FLARE), 'the old colour is still on the canvas').toBeLessThan(150)
    const drawn = inkBounds(recoloured, BLUE)
    await page.screenshot({ path: `${shots}/edit-2-recoloured.png` })

    // 3. Drag it by its outline. Grabbing a mark is a hit-test, not a handle.
    await page.mouse.move(575, 250)
    await page.mouse.down()
    await page.mouse.move(575, 190, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    const moved = inkBounds(decodePng(await page.screenshot()), BLUE)
    expect(moved.minY, 'the mark did not move up').toBeLessThan(drawn.minY - 40)
    expect(moved.minX, 'a vertical drag moved it sideways').toBeCloseTo(drawn.minX, -1)
    await page.screenshot({ path: `${shots}/edit-3-moved.png` })

    // 4. Resize from the south-east handle, which sits on the mark's corner.
    await page.mouse.move(moved.maxX + 1, moved.maxY + 1)
    await page.mouse.down()
    await page.mouse.move(moved.maxX + 61, moved.maxY + 1, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    const resized = inkBounds(decodePng(await page.screenshot()), BLUE)
    expect(resized.maxX, 'the mark did not widen').toBeGreaterThan(moved.maxX + 40)
    expect(resized.minX, 'resizing from the SE corner moved the west edge').toBeCloseTo(
      moved.minX,
      -1,
    )
    await page.screenshot({ path: `${shots}/edit-4-resized.png` })

    // 5. Delete it.
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(200)
    expect(
      inkCount(decodePng(await page.screenshot()), BLUE),
      'the mark survived being deleted',
    ).toBeLessThan(150)

    // 6. Undo brings it back, because an edit is one history entry per gesture.
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(200)
    expect(
      inkCount(decodePng(await page.screenshot()), BLUE),
      'undo did not restore the deleted mark',
    ).toBeGreaterThan(300)
    await page.screenshot({ path: `${shots}/edit-5-undone.png` })

    await page.close()
  })

  /** The text tool types on the capture rather than through `window.prompt`. */
  test('text is typed inline, on the capture', async ({ context }) => {
    const page = await context.newPage()
    const dialogs: string[] = []
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type())
      void dialog.dismiss()
    })
    await stubRuntime(page)
    await page.goto('about:blank')
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.setContent(
      `<body style="margin:0;font:15px system-ui;background:#f4f1ea">
         <h1 style="padding:24px">Inline text</h1>
       </body>`,
    )
    await page.addScriptTag({ path: contentScriptPath })
    await page.addScriptTag({ path: editorScriptPath })

    await page.evaluate(() =>
      // @ts-expect-error — test hook.
      window.__deliver({ kind: 'capture/begin', mode: 'region', tabId: 1 }),
    )
    await page.waitForTimeout(400)
    await page.mouse.move(200, 200)
    await page.mouse.down()
    await page.mouse.move(800, 600, { steps: 10 })
    await page.mouse.up()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)

    await page.keyboard.press('KeyT')
    expect(inkCount(decodePng(await page.screenshot()), FLARE)).toBeLessThan(50)
    await page.mouse.click(450, 300)
    await page.waitForTimeout(200)

    // Typing goes into the field, NOT into the editor's keymap: "kb" would
    // otherwise select the redact and rectangle tools.
    await page.keyboard.type('kb note')
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${shots}/edit-6-typing.png` })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)

    expect(dialogs, 'a browser dialog was used instead of inline text').toEqual([])
    const shot = decodePng(await page.screenshot())
    // Glyphs are drawn in the active colour, on a dark plate.
    const glyphs = inkBounds(shot, FLARE)
    expect(glyphs.count, 'no text landed on the canvas').toBeGreaterThan(100)
    // Landed where it was clicked, not at the origin.
    expect(glyphs.minX).toBeGreaterThan(430)
    expect(glyphs.minY).toBeGreaterThan(280)
    await page.screenshot({ path: `${shots}/edit-7-text.png` })

    await page.close()
  })

  /**
   * FR-5: an element taller than the viewport is captured by SCROLLING, not by
   * cropping whatever happens to be visible.
   *
   * The page half is what this asserts — that the picker keeps the element's
   * true box and asks the worker to stitch that band. The worker half (tile
   * planning over a band, the crop origin) is covered by unit tests, because
   * driving a real multi-tile `captureVisibleTab` needs an `activeTab` grant
   * Playwright cannot synthesise.
   */
  test('a taller-than-viewport element asks for a bounded stitch', async ({ context }) => {
    const page = await context.newPage()
    await stubRuntime(page)
    await page.goto('about:blank')
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.setContent(
      `<body style="margin:0;font:15px system-ui;background:#fff">
         <div style="height:300px">spacer above</div>
         <div id="tall" style="margin:0 auto;width:640px;height:2400px;background:#eee;border:1px solid #999">
           A report far taller than the viewport
         </div>
         <div style="height:600px">spacer below</div>
       </body>`,
    )
    await page.addScriptTag({ path: contentScriptPath })
    await page.addScriptTag({ path: editorScriptPath })

    // Scrolled part-way, so the element's document offset is NOT its viewport
    // offset — the case where using the wrong one silently captures the wrong
    // band.
    await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'instant' }))
    await page.evaluate(() =>
      // @ts-expect-error — test hook.
      window.__deliver({ kind: 'capture/begin', mode: 'element', tabId: 1 }),
    )
    await page.waitForTimeout(400)

    // Hover the tall element and commit with the keyboard.
    await page.mouse.move(600, 400)
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${shots}/tall-element-hover.png` })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)

    const requests = await page.evaluate(() =>
      // @ts-expect-error — test hook.
      (window.__sent as Array<Record<string, unknown>>).filter(
        (m) => m.kind === 'capture/element-band',
      ),
    )
    expect(requests, 'the tall element was not sent for a bounded stitch').toHaveLength(1)

    const request = requests[0] as { top: number; left: number; width: number; height: number }
    // The element starts 300px into the document. Measurements are BORDER-box,
    // so a 640x2400 box with a 1px border is 642x2402 — the border belongs to
    // the element and the capture must include it.
    expect(request.top).toBeCloseTo(300, 0)
    expect(request.height).toBeCloseTo(2402, 0)
    // Centred in a 1,200px viewport: (1200 - 642) / 2.
    expect(request.width).toBeCloseTo(642, 0)
    expect(request.left).toBeCloseTo(279, 0)

    // And the overlay is gone before any scrolling starts: a fixed veil left
    // up would be stamped across every tile.
    const shot = decodePng(await page.screenshot())
    expect(countNear(shot, [6, 6, 5], 20), 'the overlay veil survived the handoff').toBeLessThan(
      2000,
    )

    await page.close()
  })

  /** A short element still takes the fast path: one bitmap, no scrolling. */
  test('an element inside the viewport is cropped, not stitched', async ({ context }) => {
    const page = await context.newPage()
    await stubRuntime(page)
    await page.goto('about:blank')
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.setContent(
      `<body style="margin:0;font:15px system-ui;background:#fff">
         <div id="card" style="margin:80px auto;width:400px;height:220px;background:#eee;border:1px solid #999">A card</div>
       </body>`,
    )
    await page.addScriptTag({ path: contentScriptPath })
    await page.addScriptTag({ path: editorScriptPath })

    await page.evaluate(() =>
      // @ts-expect-error — test hook.
      window.__deliver({ kind: 'capture/begin', mode: 'element', tabId: 1 }),
    )
    await page.waitForTimeout(400)
    await page.mouse.move(600, 180)
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)

    const kinds = await page.evaluate(() =>
      // @ts-expect-error — test hook.
      (window.__sent as Array<Record<string, unknown>>).map((m) => m.kind),
    )
    expect(kinds, 'a viewport-sized element must not trigger a scroll capture').not.toContain(
      'capture/element-band',
    )
    // It went to the editor instead, which asks the worker for its destinations.
    expect(kinds).toContain('destinations/list')

    await page.close()
  })

  /**
   * FR-1's two-phase promise: the overlay is interactive BEFORE the screenshot
   * arrives, then the page freezes under it.
   *
   * The old implementation awaited `captureVisibleTab` before mounting
   * anything, so the whole cost of the round-trip was dead time in which the
   * hotkey appeared to have done nothing.
   */
  test('the overlay is interactive before the backdrop arrives', async ({ context }) => {
    const page = await context.newPage()
    await page.addInitScript(() => {
      // @ts-expect-error — test hook.
      window.__backdropDelayMs = 1500
    })
    await stubRuntime(page)
    await page.goto('about:blank')
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.setContent(
      `<body style="margin:0;font:15px system-ui;background:#ffffff">
         <h1 style="padding:24px">Phase one</h1>
       </body>`,
    )
    await page.addScriptTag({ path: contentScriptPath })
    await page.addScriptTag({ path: editorScriptPath })

    await page.evaluate(() =>
      // @ts-expect-error — test hook.
      window.__deliver({ kind: 'capture/begin', mode: 'region', tabId: 1 }),
    )
    // A single frame, not a settle: this is the claim being tested.
    await page.waitForTimeout(120)

    const early = decodePng(await page.screenshot())
    await page.screenshot({ path: `${shots}/phase1-veil.png` })
    // The veil is up over the LIVE page, so the overlay is already painted.
    // One layer of 44% over white lands near 149 grey; four stacked would be
    // near-black, which is the bug `coverAll` was fixed for.
    expect(countNear(early, [149, 149, 148], 20), 'the veil was not painted').toBeGreaterThan(
      100_000,
    )

    // And it responds: drag a selection while the backdrop is still in flight.
    await page.mouse.move(200, 200)
    await page.mouse.down()
    await page.mouse.move(700, 500, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(80)

    const dragged = decodePng(await page.screenshot())
    // The selection window is undimmed, which only happens if the controller
    // is live — and the readout reports its size.
    expect(
      countNear(crop(dragged, { x: 260, y: 260, width: 380, height: 180 }), [255, 255, 255], 12),
      'the selection did not clear the veil',
    ).toBeGreaterThan(50_000)
    await page.screenshot({ path: `${shots}/phase1-dragged.png` })

    // Now let phase 2 land: the page freezes under the overlay, which is
    // visible because the stub backdrop does not resemble the live page.
    await page.waitForTimeout(1800)
    const frozen = decodePng(await page.screenshot())
    expect(
      countNear(crop(frozen, { x: 260, y: 260, width: 380, height: 180 }), [244, 241, 234], 12),
      'the frozen backdrop was never painted',
    ).toBeGreaterThan(20_000)
    await page.screenshot({ path: `${shots}/phase2-frozen.png` })

    // Committing still works, and crops from the frozen bitmap.
    await page.keyboard.press('Enter')
    await page.waitForTimeout(600)
    const kinds = await page.evaluate(() =>
      // @ts-expect-error — test hook.
      (window.__sent as Array<Record<string, unknown>>).map((m) => m.kind),
    )
    expect(kinds).toContain('destinations/list')

    await page.close()
  })

  /** Committing DURING phase 1 must still produce a capture, not a no-op. */
  test('a commit before the backdrop lands waits for it rather than failing', async ({
    context,
  }) => {
    const page = await context.newPage()
    await page.addInitScript(() => {
      // @ts-expect-error — test hook.
      window.__backdropDelayMs = 900
    })
    await stubRuntime(page)
    await page.goto('about:blank')
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.setContent('<body style="margin:0"><h1>Race</h1></body>')
    await page.addScriptTag({ path: contentScriptPath })
    await page.addScriptTag({ path: editorScriptPath })

    await page.evaluate(() =>
      // @ts-expect-error — test hook.
      window.__deliver({ kind: 'capture/begin', mode: 'region', tabId: 1 }),
    )
    await page.waitForTimeout(100)

    // Drag and commit while the screenshot is still in flight.
    await page.mouse.move(200, 200)
    await page.mouse.down()
    await page.mouse.move(800, 600, { steps: 6 })
    await page.mouse.up()
    await page.keyboard.press('Enter')

    // The editor appears once the bitmap arrives, not never.
    await page.waitForTimeout(1600)
    const kinds = await page.evaluate(() =>
      // @ts-expect-error — test hook.
      (window.__sent as Array<Record<string, unknown>>).map((m) => m.kind),
    )
    expect(kinds, 'the editor never opened for a commit made during phase 1').toContain(
      'destinations/list',
    )
    await page.screenshot({ path: `${shots}/phase1-early-commit.png` })

    await page.close()
  })

  /**
   * FR-41. The destination strip used to be a bare field demanding `ABC-412`
   * from memory, which sends the user to Jira to look it up — the one app
   * switch §8 claims to remove.
   *
   * The editor lives in a CLOSED shadow root, so this drives it by pointer and
   * keyboard at the docked coordinates and asserts on the messages that leave
   * the page, which is the observable contract.
   */
  test('the destination picker searches, types ahead, and ships the choice', async ({
    context,
  }) => {
    const page = await context.newPage()
    await stubRuntime(page)
    await page.goto('about:blank')
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.setContent('<body style="margin:0;background:#fff"><h1>Pickers</h1></body>')
    await page.addScriptTag({ path: contentScriptPath })
    await page.addScriptTag({ path: editorScriptPath })

    await page.evaluate(() =>
      // @ts-expect-error — test hook.
      window.__deliver({ kind: 'capture/begin', mode: 'region', tabId: 1 }),
    )
    await page.waitForTimeout(400)
    await page.mouse.move(200, 200)
    await page.mouse.down()
    await page.mouse.move(800, 600, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)

    const searches = async () =>
      await page.evaluate(() =>
        // @ts-expect-error — test hook.
        (window.__sent as Array<Record<string, unknown>>)
          .filter((m) => m.kind === 'destinations/search')
          .map((m) => m.query),
      )

    // Focusing the field asks for recent work, BEFORE a keystroke — the
    // difference between a picker and a search box.
    await page.mouse.click(500, 771)
    await page.waitForTimeout(400)
    expect(await searches(), 'focusing the field did not ask for recent targets').toEqual([''])
    await page.screenshot({ path: `${shots}/picker-recent.png` })

    // Typing narrows it, debounced rather than once per keystroke.
    await page.keyboard.type('invoice')
    await page.waitForTimeout(500)
    const typed = await searches()
    expect(typed.length, 'the search was not debounced').toBeLessThan(4)
    expect(typed[typed.length - 1]).toBe('invoice')
    await page.screenshot({ path: `${shots}/picker-typed.png` })

    // Arrow to the match and send it: the key never had to be typed or known.
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')

    // Polled, not slept on: sending now compresses to the destination's limit
    // first, which encodes the capture more than once.
    const shipped = async () =>
      await page.evaluate(() =>
        // @ts-expect-error — test hook.
        (window.__sent as Array<Record<string, unknown>>).filter(
          (m) => m.kind === 'destinations/ship',
        ),
      )
    await expect.poll(async () => (await shipped()).length, { timeout: 8_000 }).toBe(1)

    const ships = await shipped()
    expect(ships, 'choosing a target did not ship it').toHaveLength(1)
    expect(ships[0]).toMatchObject({ provider: 'jira', key: 'ABC-412' })

    await page.close()
  })

  /**
   * The bytes that reach a destination are the CAPTURE.
   *
   * This exists because they were not: the image crossed to the worker as an
   * `ArrayBuffer`, and `chrome.runtime.sendMessage` serialises through JSON,
   * so it arrived as `{}` and was uploaded as the eleven bytes of the string
   * "[object Object]". Every ship succeeded and attached something that was
   * not an image. Nothing caught it because no test had ever looked at the
   * payload — only at whether a message was sent.
   */
  test('the payload sent to a destination is a real image', async ({ context }) => {
    const page = await context.newPage()
    await stubRuntime(page)
    await page.goto('about:blank')
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.setContent('<body style="margin:0;background:#fff"><h1>Ship bytes</h1></body>')
    await page.addScriptTag({ path: contentScriptPath })
    await page.addScriptTag({ path: editorScriptPath })

    await page.evaluate(() =>
      // @ts-expect-error — test hook.
      window.__deliver({ kind: 'capture/begin', mode: 'region', tabId: 1 }),
    )
    await page.waitForTimeout(400)
    await page.mouse.move(200, 200)
    await page.mouse.down()
    await page.mouse.move(800, 600, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.press('Enter')

    // Wait for the EDITOR rather than for a duration: on a cold browser the
    // first test pays for the extension's own start-up, and a fixed sleep here
    // made this test pass or fail depending on what ran before it.
    await expect
      .poll(
        async () =>
          await page.evaluate(() =>
            // @ts-expect-error — test hook.
            (window.__sent as Array<Record<string, unknown>>).some(
              (m) => m.kind === 'destinations/list',
            ),
          ),
        { timeout: 10_000 },
      )
      .toBe(true)
    await page.waitForTimeout(200)

    // Send to the pre-filled remembered target.
    await page.mouse.click(632, 771)
    await expect
      .poll(
        async () =>
          await page.evaluate(
            () =>
              // @ts-expect-error — test hook.
              (window.__sent as Array<Record<string, unknown>>).filter(
                (m) => m.kind === 'destinations/ship',
              ).length,
          ),
        { timeout: 15_000 },
      )
      .toBe(1)

    const payload = await page.evaluate(
      () =>
        // @ts-expect-error — test hook.
        (window.__sent as Array<Record<string, unknown>>).find(
          (m) => m.kind === 'destinations/ship',
        ) as { dataUrl?: string },
    )

    // A PNG data URL, not an ArrayBuffer and not `{}`.
    expect(typeof payload.dataUrl, 'the image did not cross as a string').toBe('string')
    expect(String(payload.dataUrl)).toMatch(/^data:image\/png;base64,/)

    // And it decodes to an image of the captured size, which is the assertion
    // that would have caught the original defect.
    const decoded = await page.evaluate(async (dataUrl: string) => {
      const blob = await (await fetch(dataUrl)).blob()
      const bitmap = await createImageBitmap(blob)
      const size = { width: bitmap.width, height: bitmap.height, bytes: blob.size }
      bitmap.close()
      return size
    }, String(payload.dataUrl))

    expect(decoded.bytes, 'the payload is far too small to be a screenshot').toBeGreaterThan(1_000)
    expect(decoded.width).toBe(600)
    expect(decoded.height).toBe(400)

    await page.close()
  })

  /**
   * The overlay stops listening once it hands over.
   *
   * It cannot be torn down at that moment — the editor mounts into its shadow
   * root — but leaving its keydown listener attached meant it saw every key
   * first, in the capture phase, and swallowed them: Enter re-committed the
   * capture instead of sending it, and the arrow keys nudged a selection that
   * was no longer on screen.
   */
  test('the overlay stops handling keys once the editor has the capture', async ({ context }) => {
    const page = await context.newPage()
    await stubRuntime(page)
    await page.goto('about:blank')
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.setContent('<body style="margin:0;background:#fff"><h1>Handoff</h1></body>')
    await page.addScriptTag({ path: contentScriptPath })
    await page.addScriptTag({ path: editorScriptPath })

    await page.evaluate(() =>
      // @ts-expect-error — test hook.
      window.__deliver({ kind: 'capture/begin', mode: 'region', tabId: 1 }),
    )
    await page.waitForTimeout(400)
    await page.mouse.move(200, 200)
    await page.mouse.down()
    await page.mouse.move(800, 600, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.press('Enter')
    await page.waitForTimeout(500)

    const listCount = async (kind: string) =>
      await page.evaluate(
        (k: string) =>
          // @ts-expect-error — test hook.
          (window.__sent as Array<Record<string, unknown>>).filter((m) => m.kind === k).length,
        kind,
      )

    // One editor, from one commit.
    expect(await listCount('destinations/list')).toBe(1)

    // A second Enter belongs to the EDITOR's commit ladder — it downloads —
    // and must not re-run the overlay's capture.
    await page.keyboard.press('Enter')
    await page.waitForTimeout(600)
    expect(
      await listCount('destinations/list'),
      'a second editor was mounted, so the overlay re-committed',
    ).toBe(1)
    // And the editor's own commit did fire, writing the capture to history.
    expect(await listCount('history/record')).toBe(1)

    await page.close()
  })

  test('element mode highlights exact bounds', async ({ context }) => {
    const page = await context.newPage()
    await stubRuntime(page)
    await page.goto('about:blank')
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.setContent(
      `<body style="margin:0;font:15px system-ui;background:#fff">
         <div style="padding:40px;display:flex;gap:20px">
           <article id="a" style="width:260px;height:180px;border:1px solid #999;padding:16px">Card A</article>
           <article id="b" style="width:260px;height:180px;border:1px solid #999;padding:16px">Card B</article>
         </div>
       </body>`,
    )
    await page.addScriptTag({ path: contentScriptPath })
    await page.addScriptTag({ path: editorScriptPath })

    await page.evaluate(() =>
      // @ts-expect-error — test hook.
      window.__deliver({ kind: 'capture/begin', mode: 'element', tabId: 1 }),
    )
    await page.waitForTimeout(400)
    await page.mouse.move(180, 120)
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${shots}/element-hover.png` })

    // Regression guard. Element mode was silently broken: `elementFromPoint`
    // on our own shadow root returned OUR surface, so buildChain correctly
    // refused it and nothing was ever highlighted. The whole page just went
    // dark. Asserting brightness proves the hovered card is undimmed while its
    // neighbour is veiled — which is the entire visible behaviour of the mode.
    const shot = decodePng(await page.screenshot())
    const brightnessAt = (x: number, y: number): number => {
      const i = (y * shot.width + x) * 4
      return (shot.data[i]! + shot.data[i + 1]! + shot.data[i + 2]!) / 3
    }

    const hovered = brightnessAt(200, 160)
    const neighbour = brightnessAt(500, 160)
    expect(hovered, 'the hovered card should be undimmed').toBeGreaterThan(230)
    expect(neighbour, 'the neighbouring card should stay veiled').toBeLessThan(200)

    await page.close()
  })
})

test('the GIF encoder produces a decodable file in the browser', async ({ context }) => {
  // Runs the real encoder in a real browser against real canvas pixels, and
  // proves the browser itself can decode the result — the encoder's own tests
  // can only check that it matches my reading of the spec.
  const page = await context.newPage()
  await page.goto('about:blank')
  await page.addScriptTag({ path: harnessPath })

  const decoded = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 120
    canvas.height = 80
    const c = canvas.getContext('2d')!
    const frames: Uint8ClampedArray[] = []
    for (const colour of ['#c4321e', '#3fa46a', '#1f6feb']) {
      c.fillStyle = '#f4f1ea'
      c.fillRect(0, 0, 120, 80)
      c.fillStyle = colour
      c.fillRect(20, 20, 80, 40)
      frames.push(c.getImageData(0, 0, 120, 80).data)
    }

    const gif = window.__hotshotEncodeGif({ frames, width: 120, height: 80, delayMs: 150 })
    const blob = new Blob([gif.slice().buffer], { type: 'image/gif' })
    const url = URL.createObjectURL(blob)

    const image = new Image()
    const loaded = await new Promise<boolean>((resolve) => {
      image.onload = () => resolve(true)
      image.onerror = () => resolve(false)
      image.src = url
    })
    return { loaded, width: image.naturalWidth, height: image.naturalHeight, bytes: gif.length }
  })

  expect(decoded.loaded, 'the browser could not decode the generated GIF').toBe(true)
  expect(decoded.width).toBe(120)
  expect(decoded.height).toBe(80)
  await page.close()
})
