import { test, expect } from './fixtures'

/**
 * The platform premise the capture geometry rests on (PRD FR-40).
 *
 * `device-rect.ts` converts CSS pixels to device pixels with
 * `devicePixelRatio` ALONE, deliberately not multiplying by
 * `chrome.tabs.getZoom()`. That is only correct because Chrome folds browser
 * zoom into `devicePixelRatio` — a fact no amount of reading FR-40 settles,
 * and getting it backwards silently crops the wrong pixels at any zoom but
 * 100%. It has already been wrong in both directions: absent from the first
 * PRD draft, then double-counted by the fix.
 *
 * So it is measured here rather than assumed. If this test fails, the crop
 * maths in `device-rect.ts` is wrong again and needs rederiving from whatever
 * this reports.
 */
test('Chrome folds browser zoom into devicePixelRatio', async ({ page, extensionId }) => {
  // An extension page, so the tab can identify itself with `getCurrent()`.
  // It is an ordinary renderer: the relationship it observes is the one a
  // content script observes.
  await page.goto(`chrome-extension://${extensionId}/src/ui/library/index.html`)

  const sample = async () =>
    await page.evaluate(async () => {
      const tab = await chrome.tabs.getCurrent()
      return {
        zoom: await chrome.tabs.getZoom(tab!.id!),
        dpr: window.devicePixelRatio,
        innerWidth: window.innerWidth,
      }
    })

  const setZoom = async (factor: number) => {
    await page.evaluate(async (f: number) => {
      const tab = await chrome.tabs.getCurrent()
      await chrome.tabs.setZoom(tab!.id!, f)
    }, factor)
    await page.waitForTimeout(400)
  }

  try {
    const before = await sample()
    expect(before.zoom).toBeCloseTo(1, 2)

    await setZoom(1.5)
    const after = await sample()
    expect(after.zoom, 'the zoom did not take effect').toBeCloseTo(1.5, 2)

    // The load-bearing assertion: devicePixelRatio TRACKS zoom. If it did not,
    // `toDeviceRect` would have to multiply by zoom separately.
    expect(
      after.dpr / before.dpr,
      'devicePixelRatio did not scale with browser zoom — device-rect.ts is now wrong',
    ).toBeCloseTo(1.5, 2)

    // And CSS pixels shrink by the same factor, so their product — the
    // window's physical width, which is what captureVisibleTab returns — is
    // unchanged. This is the identity the crop maths depends on.
    expect(after.innerWidth * after.dpr).toBeCloseTo(before.innerWidth * before.dpr, -1)
  } finally {
    // The profile is persistent, so a leaked zoom would corrupt later tests.
    await setZoom(1)
  }
})
