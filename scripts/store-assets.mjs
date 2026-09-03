import { chromium } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Renders the Chrome Web Store visual assets from the REAL extension.
 *
 * Store screenshots are marketing, but a screenshot that shows something the
 * build cannot do is a rejection risk and a support burden. So every pixel of
 * product here comes from `dist/` running in a real Chromium: the overlay, the
 * element picker, the annotation canvas, the destination strip and the
 * extension pages are all driven for real.
 *
 * Exactly one thing is stubbed — `captureVisibleTab`, which needs an
 * `activeTab` grant that only a genuine user gesture produces. In its place we
 * hand the content script a Playwright screenshot of the very same page at the
 * very same viewport, which is byte-for-byte the kind of bitmap Chrome would
 * have returned. Everything downstream (crop maths, rendering, encoding) is
 * the shipping code.
 *
 * Output: store/screenshots/*.png at 1280x800, store/promo/*.png.
 */

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const DIST = join(repo, 'dist')
const CONTENT = join(DIST, 'content.js')
/**
 * The editor chunk, which production injects on demand (PRD §6).
 *
 * Both are pre-injected here for the same reason the E2E harness does it:
 * `addScriptTag` cannot ask the worker for an injection, and the two chunks
 * share one global either way.
 */
const EDITOR = join(DIST, 'editor.js')
const OUT = join(repo, 'store')
const RAW = join(OUT, 'raw')
const SHOTS = join(OUT, 'screenshots')
const PROMO = join(OUT, 'promo')

for (const dir of [RAW, SHOTS, PROMO]) mkdirSync(dir, { recursive: true })

/** Product surfaces are captured at this size and inset 1:1 into the frame. */
const STAGE = { width: 1152, height: 700 }
/** The store accepts 1280x800 or 640x400. Nothing else. */
const FRAME = { width: 1280, height: 800 }
/** Extension pages are narrow; they get a narrower plate rather than dead space. */
const PANEL = { width: 704, height: 660 }

const demo = (name) => pathToFileURL(join(here, 'store', name)).href

// --- The stub ---------------------------------------------------------------

/**
 * Installs a minimal `chrome` stand-in plus a test hook for delivering
 * messages to the content script, and forces shadow roots open so this script
 * can drive the overlay by role instead of by hard-coded coordinates.
 */
async function prepare(page, backdropDataUrl, destinations) {
  await page.addInitScript(
    ({ backdrop, destinations }) => {
      // The overlay and editor live in CLOSED shadow roots so page CSS cannot
      // reach them. That is correct for production and untestable from here,
      // so open them for this render only.
      const attach = Element.prototype.attachShadow
      Element.prototype.attachShadow = function (init) {
        return attach.call(this, { ...init, mode: 'open' })
      }

      const listeners = []
      window.chrome = {
        runtime: {
          onMessage: { addListener: (fn) => listeners.push(fn) },
          getManifest: () => ({ version: '0.1.0' }),
          async sendMessage(message) {
            switch (message?.kind) {
              case 'capture/request-backdrop':
                return { ok: true, dataUrl: backdrop, zoom: 1, dpr: 1 }
              case 'destinations/list':
                return destinations
              case 'destinations/ship':
                return {
                  ok: true,
                  message: 'Sent',
                  url: 'https://northwind.atlassian.net/browse/STORE-412',
                }
              default:
                return undefined
            }
          },
        },
      }
      window.__deliver = (message) => listeners.forEach((fn) => fn(message))
    },
    { backdrop: backdropDataUrl, destinations },
  )
}

/**
 * Opens `url` twice: once clean to photograph the page (this becomes the
 * backdrop the extension would have received), then again with the stub in
 * place and the content script injected.
 */
async function stage(context, url, { destinations = { configured: [] } } = {}) {
  const plain = await context.newPage()
  await plain.setViewportSize(STAGE)
  await plain.goto(url)
  await plain.waitForLoadState('load')
  // A freshly launched persistent context occasionally stalls its very first
  // screenshot, so this retries rather than failing the whole run.
  let bytes
  for (let attempt = 1; ; attempt++) {
    try {
      bytes = await plain.screenshot({ timeout: 15_000, animations: 'disabled' })
      break
    } catch (error) {
      if (attempt === 3) throw error
      await plain.waitForTimeout(500)
    }
  }
  const backdrop = `data:image/png;base64,${bytes.toString('base64')}`
  await plain.close()

  const page = await context.newPage()
  await page.setViewportSize(STAGE)
  await prepare(page, backdrop, destinations)
  await page.goto(url)
  await page.waitForLoadState('load')
  await page.addScriptTag({ path: CONTENT })
  await page.addScriptTag({ path: EDITOR })
  return page
}

const begin = (page, mode) =>
  page.evaluate((mode) => window.__deliver({ kind: 'capture/begin', mode, tabId: 1 }), mode)

const settle = (page, ms = 350) => page.waitForTimeout(ms)

/**
 * The editor's canvas, located by querying the (forced-open) shadow root.
 *
 * Annotation coordinates MUST be relative to it: the editor centres the crop
 * on screen, so absolute page coordinates land on the stage behind the canvas
 * and draw nothing at all — which is exactly how the first render of these
 * screenshots came out empty.
 */
async function canvasBox(page, selection) {
  const box = await page.locator('canvas').first().boundingBox()
  if (!box) throw new Error('the editor canvas never appeared')

  const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })
  return {
    at,
    /**
     * Where a point of the ORIGINAL page now sits on the canvas. Lets the
     * annotations land on named elements instead of guessed pixels.
     */
    from: (x, y) => at((x - selection.x) / selection.width, (y - selection.y) / selection.height),
  }
}

/** The box of a page element, in page coordinates. */
async function boxOf(page, selector) {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`${selector} is not on the page`)
  return box
}

/** A selection rect around `box`, padded and clamped to the viewport. */
function selectionAround(box, pad, bottom) {
  const x = Math.max(2, box.x - pad)
  const y = Math.max(2, box.y - pad)
  const maxBottom = Math.min(bottom ?? box.y + box.height + pad, STAGE.height - 2)
  return { x, y, width: Math.min(box.width + pad * 2, STAGE.width - x - 2), height: maxBottom - y }
}

const dragRect = (page, rect) =>
  drag(page, { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }, 14)

async function drag(page, from, to, steps = 10) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  await page.mouse.up()
}

// --- The frame --------------------------------------------------------------

const FRAME_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${FRAME.width}px; height: ${FRAME.height}px; overflow: hidden; }
  body { background: #edece7; font: 400 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
         color: #171716; display: flex; flex-direction: column; }
  /* A single warm wash so five screenshots read as one listing. */
  body::before { content: ""; position: fixed; inset: 0;
    background: radial-gradient(1100px 420px at 12% -12%, #ffffff 0%, rgba(255,255,255,0) 68%); }
  header { position: relative; padding: 30px 64px 0; }
  .eyebrow { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .eyebrow i { width: 9px; height: 9px; border-radius: 2px; background: #ff5a00; display: block; }
  .eyebrow span { font: 600 11px/1 system-ui; text-transform: uppercase;
                  letter-spacing: .14em; color: #6b6862; }
  h1 { font-size: 30px; font-weight: 650; letter-spacing: -0.025em; margin: 0; }
  p  { font-size: 15px; color: #514f4a; margin: 8px 0 0; max-width: 900px; }
  .well { position: relative; flex: 1; display: flex; align-items: flex-end; justify-content: center; }
  .shot { display: block;
          border-radius: 8px 8px 0 0; border: 1px solid #d7d4cd; border-bottom: 0;
          box-shadow: 0 -1px 0 rgba(255,255,255,.7) inset, 0 18px 44px -12px rgba(23,23,22,.28);
          background: #fff; }
`

async function frameShot(page, { file, title, sub, out, size = STAGE }) {
  const html = `<!doctype html><meta charset="utf-8"><style>${FRAME_CSS}
    .shot { width: ${size.width}px; height: ${size.height}px; }</style>
    <header>
      <div class="eyebrow"><i></i><span>Hotshot</span></div>
      <h1>${title}</h1>
      <p>${sub}</p>
    </header>
    <div class="well"><img class="shot" src="${file}"></div>`

  const path = join(RAW, '.frame.html')
  writeFileSync(path, html)
  await page.setViewportSize(FRAME)
  await page.goto(pathToFileURL(path).href)
  await page.waitForLoadState('load')
  await page.waitForTimeout(150)
  await page.screenshot({ path: join(SHOTS, out) })
  console.log(`  screenshots/${out}`)
}

// --- Promo tiles ------------------------------------------------------------

const iconDataUrl = `data:image/png;base64,${readFileSync(join(repo, 'public/icons/128.png')).toString('base64')}`

function tileHtml({ width, height, titleSize, tagSize, gap, shot }) {
  return `<!doctype html><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
    body { background: #171716; color: #f7f7f5; position: relative;
           font: 400 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
           display: flex; flex-direction: column; justify-content: center;
           padding: 0 ${gap}px; }
    body::after { content: ""; position: absolute; inset: 0;
      background: radial-gradient(560px 320px at 88% 8%, rgba(255,90,0,.30), rgba(255,90,0,0) 70%); }
    .brand { display: flex; align-items: center; gap: 12px; position: relative; z-index: 1; }
    .brand img { width: ${Math.round(titleSize * 1.1)}px; height: ${Math.round(titleSize * 1.1)}px;
                 border-radius: ${Math.round(titleSize * 0.22)}px; }
    .brand b { font: 650 ${titleSize}px/1 system-ui; letter-spacing: -0.03em; }
    .tag { position: relative; z-index: 1; font-size: ${tagSize}px; line-height: 1.35;
           color: #d0cdc6; margin-top: ${Math.round(gap * 0.42)}px; max-width: ${Math.round(width * 0.62)}px; }
    .tag em { color: #ff8a45; font-style: normal; }
    .rule { position: relative; z-index: 1; width: 44px; height: 3px; background: #ff5a00;
            margin-top: ${Math.round(gap * 0.5)}px; border-radius: 2px; }
    ${shot ? `.shot { position: absolute; right: -60px; bottom: -40px; width: 620px;
            border-radius: 8px; border: 1px solid #3a3936; box-shadow: 0 24px 60px rgba(0,0,0,.5);
            z-index: 0; opacity: .92; }` : ''}
  </style>
  ${shot ? `<img class="shot" src="${shot}">` : ''}
  <div class="brand"><img src="${iconDataUrl}"><b>Hotshot</b></div>
  <div class="tag">Exact screenshots of anything on a page.<br><em>Nothing leaves your machine.</em></div>
  <div class="rule"></div>`
}

async function promo(page, { name, width, height, ...rest }) {
  const path = join(RAW, `.tile-${name}.html`)
  writeFileSync(path, tileHtml({ width, height, ...rest }))
  await page.setViewportSize({ width, height })
  await page.goto(pathToFileURL(path).href)
  await page.waitForLoadState('load')
  await page.waitForTimeout(150)
  await page.screenshot({ path: join(PROMO, `${name}.png`) })
  console.log(`  promo/${name}.png`)
}

// --- Scenes -----------------------------------------------------------------

async function main() {
  const context = await chromium.launchPersistentContext(
    mkdtempSync(join(tmpdir(), 'hotshot-store-')),
    {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
      deviceScaleFactor: 1,
    },
  )

  let [worker] = context.serviceWorkers()
  if (!worker) worker = await context.waitForEvent('serviceworker')
  const extensionId = new URL(worker.url()).host
  console.log(`\nHotshot store assets — extension ${extensionId}\n`)

  // 1. Element mode, mid-hover, on a real card.
  {
    const page = await stage(context, demo('demo-dashboard.html'))
    await begin(page, 'element')
    await settle(page)
    // Over one release row. The picker's first guess is the text span inside
    // it, so `]` walks out to the row itself — which demonstrates the two
    // keys the caption talks about as well as the snap.
    await page.mouse.move(300, 470)
    await settle(page)
    await page.keyboard.press('BracketRight')
    await settle(page)
    await page.screenshot({ path: join(RAW, '01-element.png') })
    await page.close()
  }

  // 2. The annotation toolbar over a capture, with numbered badges.
  {
    const page = await stage(context, demo('demo-dashboard.html'))
    // Crop to the releases panel, ending on a row boundary rather than
    // slicing a row in half.
    const panel = await boxOf(page, '#releases')
    const lastRow = await boxOf(page, '#rel-4')
    const selection = selectionAround(panel, 12, lastRow.y + lastRow.height + 12)

    await begin(page, 'region')
    await settle(page)
    await dragRect(page, selection)
    await settle(page)
    await page.keyboard.press('Enter')
    await settle(page, 700)

    // Page coordinates of the things worth marking, resolved BEFORE the crop.
    const failed = await boxOf(page, '#rel-3')
    const pill1 = await boxOf(page, '#rel-1 .pill')
    const pill2 = await boxOf(page, '#rel-2 .pill')

    const canvas = await canvasBox(page, selection)
    await page.keyboard.press('KeyB') // box the rolled-back release
    await drag(
      page,
      canvas.from(failed.x + 4, failed.y + 3),
      canvas.from(failed.x + failed.width - 4, failed.y + failed.height - 3),
      8,
    )

    await page.keyboard.press('KeyA') // arrow into it from below
    // Origin as a canvas fraction so it can never fall outside the crop —
    // an arrow drawn off-canvas is silently dropped.
    await drag(page, canvas.at(0.58, 0.94), canvas.from(failed.x + failed.width * 0.5, failed.y + failed.height - 4), 8)

    await page.keyboard.press('KeyN') // numbered step badges
    // In the gutter beside each status pill, where there is nothing to cover.
    for (const pill of [pill1, pill2]) {
      const at = canvas.from(pill.x - 34, pill.y + pill.height / 2)
      await page.mouse.click(at.x, at.y)
    }
    await settle(page)
    await page.screenshot({ path: join(RAW, '02-annotate.png') })
    await page.close()
  }

  // 3. A pin sitting beside the half-filled bug report.
  {
    const page = await stage(context, demo('demo-bugform.html'))
    // Capture the defect itself, which sits ABOVE the form.
    const broken = await boxOf(page, '#broken')
    const selection = selectionAround(broken, 8)

    await begin(page, 'region')
    await settle(page)
    await dragRect(page, selection)
    await settle(page)
    await page.keyboard.press('Enter')
    await settle(page, 700)
    // The commit ladder (FR-44): shift+meta+Enter pins rather than downloads.
    await page.keyboard.press('Meta+Shift+Enter')
    await settle(page, 900)

    // Drag the pin clear of the column — the first thing anyone does with one.
    const pinSelector = '[role="dialog"][aria-label="Hotshot pinned capture"]'
    const pin = await page.locator(pinSelector).boundingBox()
    if (pin) {
      await page.mouse.move(pin.x + pin.width / 2, pin.y + 14)
      await page.mouse.down()
      await page.mouse.move(890, 150, { steps: 12 })
      await page.mouse.up()
    }

    // Scroll the defect off screen: the pin holding what the page no longer
    // shows is the whole reason the feature exists. `position: fixed` keeps
    // the pin put while the document moves under it.
    await page.evaluate(() => window.scrollBy({ top: 300, behavior: 'instant' }))
    // Clicking into the form blurs the pin, which is both the next real action
    // and what drops Chrome's default focus ring off the plate.
    await page.locator('#d').click()
    await settle(page, 250)
    await page.screenshot({ path: join(RAW, '03-pin.png') })
    await page.close()
  }

  // 4. The destination strip sending to Jira.
  {
    const page = await stage(context, demo('demo-dashboard.html'), {
      destinations: { configured: ['jira', 'clickup'], remembered: { jira: 'STORE-412' } },
    })
    const panel = await boxOf(page, '#releases')
    const lastRow = await boxOf(page, '#rel-3')
    const selection = selectionAround(panel, 12, lastRow.y + lastRow.height + 12)

    await begin(page, 'region')
    await settle(page)
    await dragRect(page, selection)
    await settle(page)
    await page.keyboard.press('Enter')
    await settle(page, 700)

    const failed = await boxOf(page, '#rel-3 .pill')
    const canvas = await canvasBox(page, selection)
    await page.keyboard.press('KeyA')
    await drag(page, canvas.at(0.42, 0.93), canvas.from(failed.x - 10, failed.y + failed.height * 0.6), 8)
    await settle(page)
    // The strip is real DOM inside the (forced-open) shadow root.
    await page.getByRole('button', { name: 'Send' }).click()
    // 'Sent' shows for 700ms before the editor closes itself.
    await page.waitForTimeout(220)
    await page.screenshot({ path: join(RAW, '04-destinations.png') })
    await page.close()
  }

  // 5. Settings — the privacy claim, stated by the product itself.
  {
    const page = await context.newPage()
    await page.setViewportSize(PANEL)
    await page.goto(`chrome-extension://${extensionId}/src/ui/settings/index.html`)
    await page.waitForLoadState('networkidle')
    // Scroll to the section that carries the claim: three services, all
    // "Not connected", above the sentence about local-only tokens.
    await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find(
        (h) => h.textContent === 'Connected services',
      )
      window.scrollTo({ top: (heading?.offsetTop ?? 0) - 28, behavior: 'instant' })
    })
    await settle(page)
    await page.screenshot({ path: join(RAW, '05-settings.png') })
    await page.close()
  }

  // 6. The popup, for the promo tile.
  {
    const page = await context.newPage()
    await page.setViewportSize({ width: 268, height: 296 })
    await page.goto(`chrome-extension://${extensionId}/src/ui/popup/index.html`)
    await page.waitForLoadState('networkidle')
    await settle(page)
    await page.screenshot({ path: join(RAW, '06-popup.png') })
    await page.close()
  }

  // --- Compose --------------------------------------------------------------

  const framer = await context.newPage()
  const scenes = [
    {
      file: '01-element.png',
      out: '01-element-capture.png',
      title: 'Point at anything. Hotshot knows its exact bounds.',
      sub: 'Element mode reads the page and snaps to the real box — a card, a modal, one table row. Press [ or ] to take the parent or the child instead.',
    },
    {
      file: '02-annotate.png',
      out: '02-annotate.png',
      title: 'Mark it up without ever leaving the page.',
      sub: 'Arrows, boxes, freehand, text and numbered step badges that renumber themselves when you delete one. Every mark stays editable — select it, move it, resize it, recolour it. Redaction removes the pixels. Save as PNG, JPG or a paged PDF.',
    },
    {
      file: '03-pin.png',
      out: '03-pin.png',
      title: 'Pin the capture and write the report beside it.',
      sub: 'The screenshot stays on screen while you fill in the form. Drag it, fade it, see straight through it to the fields underneath.',
    },
    {
      file: '04-destinations.png',
      out: '04-destinations.png',
      title: 'Straight into the ticket, without leaving the page.',
      sub: 'Search your own issues, tasks and channels by name — Jira, Linear, ClickUp, Asana, Trello, Notion, Slack, Dropbox. The page URL, title and viewport size come along, and the image goes from your browser to that service directly.',
    },
    {
      file: '05-settings.png',
      out: '05-privacy.png',
      size: PANEL,
      title: 'No account. No server. No analytics.',
      sub: 'Hotshot has no backend to send anything to. Tokens are stored on this device using local extension storage, never Chrome sync, and the source is public.',
    },
  ]

  for (const scene of scenes) await frameShot(framer, scene)

  await promo(framer, {
    name: 'small-tile-440x280',
    width: 440,
    height: 280,
    titleSize: 30,
    tagSize: 14,
    gap: 30,
  })
  await promo(framer, {
    name: 'marquee-1400x560',
    width: 1400,
    height: 560,
    titleSize: 62,
    tagSize: 24,
    gap: 76,
    shot: pathToFileURL(join(RAW, '01-element.png')).href,
  })

  await framer.close()
  await context.close()

  // Dimensions are the one thing the store rejects outright, so assert them.
  verify()
}

function verify() {
  const expected = [
    ...['01-element-capture', '02-annotate', '03-pin', '04-destinations', '05-privacy'].map((n) => [
      join(SHOTS, `${n}.png`),
      1280,
      800,
    ]),
    [join(PROMO, 'small-tile-440x280.png'), 440, 280],
    [join(PROMO, 'marquee-1400x560.png'), 1400, 560],
  ]

  const problems = []
  for (const [path, width, height] of expected) {
    const buffer = readFileSync(path)
    // PNG IHDR: width and height are big-endian uint32 at bytes 16 and 20.
    const actualWidth = buffer.readUInt32BE(16)
    const actualHeight = buffer.readUInt32BE(20)
    if (actualWidth !== width || actualHeight !== height) {
      problems.push(`${path} is ${actualWidth}x${actualHeight}, expected ${width}x${height}`)
    }
  }

  if (problems.length > 0) {
    console.error('\n✗ Wrong dimensions:\n')
    for (const problem of problems) console.error(`  ${problem}`)
    process.exit(1)
  }
  console.log('\n  ✓ all assets at the dimensions the store requires\n')
}

await main()
