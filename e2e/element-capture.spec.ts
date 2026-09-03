import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures'

/**
 * The element-capture regression gate (PRD R-3).
 *
 * R-3 is explicit that an 80%-reliable element picker fails publicly, and the
 * unit tests only cover synthetic chains. This suite runs the REAL picker
 * against a REAL layout engine on pages that reproduce the structural patterns
 * that break naive pickers: shadow DOM, CSS transforms, sticky positioning,
 * full-bleed wrappers, absolute overlays, deep nesting, scrolled documents.
 *
 * Each fixture declares its own probes, so adding a pattern means adding one
 * HTML file and nothing else.
 */

interface Probe {
  readonly x: number
  readonly y: number
  /** CSS selector, or `shadow:<host> >>> <inner>` to cross a shadow boundary. */
  readonly expect?: string
  /** For walk probes: the tag expected after N `]` presses. */
  readonly expectTag?: string
  readonly walk?: number
  readonly why: string
}

const pagesDir = fileURLToPath(new URL('./fixtures/pages', import.meta.url))
const pages = readdirSync(pagesDir).filter((f) => f.endsWith('.html')).sort()

/** Bounds must match what the layout engine reports, to within a pixel. */
const TOLERANCE_PX = 1

test.describe('element picker fixture suite', () => {
  for (const file of pages) {
    test(`${file}`, async ({ page }) => {
      await page.goto(`file://${pagesDir}/${file}`)
      await page.waitForFunction(() => typeof window.__hotshotPick === 'function')

      const probes = (await page.evaluate(() =>
        JSON.parse(document.getElementById('probes')?.textContent ?? '[]'),
      )) as Probe[]

      expect(probes.length, `${file} declares no probes`).toBeGreaterThan(0)

      for (const probe of probes) {
        if (probe.walk !== undefined) {
          const walked = await page.evaluate(
            ([x, y, steps]) => window.__hotshotWalk(x as number, y as number, steps as number),
            [probe.x, probe.y, probe.walk],
          )
          expect(walked?.tag, `${probe.why}`).toBe(probe.expectTag)
          continue
        }

        const picked = await page.evaluate(
          ([x, y]) => window.__hotshotPick(x as number, y as number),
          [probe.x, probe.y],
        )
        expect(picked, `${probe.why} — nothing was picked`).not.toBeNull()

        const expected = await page.evaluate((selector) => {
          const shadow = selector.match(/^shadow:(.+?) >>> (.+)$/)
          const element = shadow
            ? document.querySelector(shadow[1]!)?.shadowRoot?.querySelector(shadow[2]!)
            : document.querySelector(selector)
          if (!element) return null
          const box = element.getBoundingClientRect()
          return { tag: element.tagName.toLowerCase(), x: box.x, y: box.y, w: box.width, h: box.height }
        }, probe.expect as string)

        expect(expected, `fixture selector ${probe.expect} matched nothing`).not.toBeNull()

        expect(picked?.tag, probe.why).toBe(expected?.tag)
        // The bounds are the product claim: "exact bounds, no eyeballed drag".
        expect(Math.abs((picked?.rect.x ?? 0) - (expected?.x ?? 0)), probe.why).toBeLessThanOrEqual(
          TOLERANCE_PX,
        )
        expect(Math.abs((picked?.rect.y ?? 0) - (expected?.y ?? 0)), probe.why).toBeLessThanOrEqual(
          TOLERANCE_PX,
        )
        expect(
          Math.abs((picked?.rect.width ?? 0) - (expected?.w ?? 0)),
          probe.why,
        ).toBeLessThanOrEqual(TOLERANCE_PX)
        expect(
          Math.abs((picked?.rect.height ?? 0) - (expected?.h ?? 0)),
          probe.why,
        ).toBeLessThanOrEqual(TOLERANCE_PX)
      }
    })
  }

  test('every fixture is reachable and none is silently empty', async () => {
    // A fixture that stops loading would otherwise pass by asserting nothing.
    expect(pages.length).toBeGreaterThanOrEqual(20)
  })
})
