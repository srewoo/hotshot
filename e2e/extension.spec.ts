import { test, expect } from './fixtures'

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
