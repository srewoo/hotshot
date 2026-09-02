import { test as base, chromium, type BrowserContext } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const distPath = fileURLToPath(new URL('../dist', import.meta.url))

/**
 * Loads the built extension into a real Chromium.
 *
 * Headless Chrome historically could not load extensions; `--headless=new`
 * can, and is what makes this runnable in CI.
 */
export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext(
      mkdtempSync(join(tmpdir(), 'hotshot-e2e-')),
      {
        // The `chromium` channel ships the new headless mode, which is the
        // only headless path that actually starts an MV3 service worker.
        channel: 'chromium',
        headless: true,
        args: [
          `--disable-extensions-except=${distPath}`,
          `--load-extension=${distPath}`,
        ],
      },
    )
    await use(context)
    await context.close()
  },

  extensionId: async ({ context }, use) => {
    // The service worker registers shortly after launch; its URL carries the id.
    let [worker] = context.serviceWorkers()
    if (!worker) worker = await context.waitForEvent('serviceworker')
    await use(new URL(worker.url()).host)
  },
})

export const expect = test.expect
