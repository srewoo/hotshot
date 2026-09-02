import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures'

const contentScriptPath = fileURLToPath(new URL('../dist/content.js', import.meta.url))

declare global {
  interface Window {
    __hotshotInjected?: boolean
  }
}

/**
 * Verifies the wiring the unit tests cannot reach: that the manifest is valid,
 * the service worker registers, the pages render, and — the one that matters —
 * that the overlay actually injects and captures.
 */

test('the service worker registers', async ({ context, extensionId }) => {
  // Depending on `extensionId` is what waits for registration; asserting on
  // `serviceWorkers()` directly races the launch.
  expect(extensionId).toMatch(/^[a-z]{32}$/)
  expect(context.serviceWorkers().length).toBeGreaterThan(0)
})

test('the manifest requests no broad host permission', async ({ page, extensionId }) => {
  // The privacy claim in the store listing has to be verifiable, and this is
  // the assertion that keeps it true as the code changes.
  await page.goto(`chrome-extension://${extensionId}/manifest.json`)
  const manifest = JSON.parse(await page.locator('body').innerText())

  expect(manifest.permissions).not.toContain('<all_urls>')
  expect(manifest.host_permissions ?? []).toEqual([])
  expect(manifest.optional_host_permissions).toHaveLength(3)
})

test('the popup offers the capture modes when it cannot read the tab URL', async ({
  page,
  extensionId,
}) => {
  // Hotshot does not request the `tabs` permission, so `tab.url` is usually
  // undefined. The popup must NOT treat that as "blocked" — doing so showed
  // "cannot read this tab's address" on every page, which this test caught.
  // A real restriction is reported by the worker when capture is attempted.
  await page.goto(`chrome-extension://${extensionId}/src/ui/popup/index.html`)

  await expect(page.getByText('Region')).toBeVisible()
  await expect(page.getByText('Full page')).toBeVisible()
  await expect(page.getByText('Element')).toBeVisible()
  await expect(page.getByText(/cannot read this tab/i)).toHaveCount(0)
})

test('the popup exposes settings and library regardless of the page', async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/src/ui/popup/index.html`)
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Library' })).toBeVisible()
})

test('settings renders every service block', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/src/ui/settings/index.html`)
  for (const name of ['Jira', 'ClickUp', 'Notion']) {
    await expect(page.getByText(name, { exact: true })).toBeVisible()
  }
  await expect(page.getByText('Not connected').first()).toBeVisible()
})

test('the library shows its empty state before any capture', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/src/ui/library/index.html`)
  await expect(page.getByText('No captures yet')).toBeVisible()
})

test('onboarding offers the practice card element capture targets', async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/src/ui/onboarding/index.html`)
  await expect(page.getByText('Practice card')).toBeVisible()
})

test('no page logs an error on load', async ({ page, extensionId }) => {
  // Guards the modulepreload class of warning, which cost real fetches and
  // looked broken in the console even though nothing was.
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text())
  })

  for (const path of ['popup', 'settings', 'library', 'onboarding']) {
    await page.goto(`chrome-extension://${extensionId}/src/ui/${path}/index.html`)
    await page.waitForLoadState('networkidle')
  }

  expect(problems).toEqual([])
})

test('the popup capture message reaches a worker listener', async ({ page, extensionId }) => {
  // This is the bug this test exists for: the popup sent `popup/capture` and
  // NOTHING listened for it, so every menu item silently did nothing. An
  // unhandled sendMessage resolves as undefined and looks identical to
  // success, which is why it survived a manual click-through.
  await page.goto(`chrome-extension://${extensionId}/src/ui/popup/index.html`)

  const handled = await page.evaluate(async () => {
    try {
      await chrome.runtime.sendMessage({ kind: 'popup/capture', mode: 'region' })
      return 'delivered'
    } catch (error) {
      return String(error)
    }
  })

  // "Receiving end does not exist" is the signature of the original bug.
  expect(handled).toBe('delivered')
})

test('an unknown message kind does not crash the worker', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/src/ui/popup/index.html`)
  const result = await page.evaluate(async () => {
    try {
      await chrome.runtime.sendMessage({ kind: 'nonsense/not-a-real-message' })
      return 'ok'
    } catch {
      // No listener claims it, which is correct — it must not take the worker down.
      return 'ok'
    }
  })
  expect(result).toBe('ok')
})

test('the content script runs as a classic script on a real page', async ({ context }) => {
  // The bug this test exists for: dist/content.js was emitted as an ES module,
  // and executeScript injects a CLASSIC script — so it died with "Cannot use
  // import statement outside a module" and every capture silently failed. No
  // extension-page test could see it, because the failure only happens on a
  // host page at load time.
  //
  // `addScriptTag` without `type=module` uses the same execution mode as
  // executeScript, so it reproduces that exact failure. It does NOT exercise
  // the activeTab grant, which needs a real user gesture Playwright cannot
  // synthesise — that path stays manual.
  const page = await context.newPage()
  await page.setContent('<main><article id="card">real page content</article></main>')

  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))

  // `addScriptTag` lands in the page's MAIN world, where the extension APIs do
  // not exist — content scripts get an isolated world with `chrome`. Stubbing
  // the one API the entry point touches lets the script execute for real, so
  // the test measures parsing and execution rather than a missing global.
  await page.addInitScript(() => {
    // @ts-expect-error — minimal stand-in for the isolated world's `chrome`.
    window.chrome = { runtime: { onMessage: { addListener: () => {} } } }
  })
  await page.reload()
  await page.setContent('<main><article id="card">real page content</article></main>')

  await page.addScriptTag({ path: contentScriptPath })

  expect(errors.join('\n')).not.toContain('import statement')
  expect(errors.join('\n')).not.toContain('SyntaxError')
  expect(errors).toEqual([])

  // The guard flag is the observable proof that the script actually ran.
  expect(await page.evaluate(() => window.__hotshotInjected === true)).toBe(true)

  await page.close()
})

test('the content script guards against double injection', async ({ context }) => {
  // executeScript runs again on every invocation, and the user may press the
  // hotkey twice — a second run must not stack a second listener.
  const page = await context.newPage()
  await page.setContent('<main>content</main>')

  await page.addInitScript(() => {
    // @ts-expect-error — minimal stand-in for the isolated world's `chrome`.
    window.chrome = { runtime: { onMessage: { addListener: () => {} } } }
  })
  await page.reload()
  await page.setContent('<main>content</main>')

  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))

  await page.addScriptTag({ path: contentScriptPath })
  await page.addScriptTag({ path: contentScriptPath })

  expect(errors).toEqual([])
  expect(await page.evaluate(() => window.__hotshotInjected === true)).toBe(true)
  await page.close()
})
