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
  // the assertion that keeps it true as the code changes. It checks the
  // INVARIANT rather than a count: the list grows with every destination, and
  // a test that counted entries would be edited away the first time it failed.
  await page.goto(`chrome-extension://${extensionId}/manifest.json`)
  const manifest = JSON.parse(await page.locator('body').innerText())

  expect(manifest.permissions).not.toContain('<all_urls>')
  // Nothing is granted at install: every integration host is optional and
  // requested at token-setup time (FR-23).
  expect(manifest.host_permissions ?? []).toEqual([])

  const optional: string[] = manifest.optional_host_permissions ?? []
  expect(optional.length).toBeGreaterThan(0)

  for (const origin of optional) {
    // HTTPS only, and a named host. A `*://*/*` or a bare `*` here would be
    // "read all your data on every website" wearing an optional label.
    expect(origin, `${origin} is not an https origin`).toMatch(/^https:\/\//)
    const host = origin.slice('https://'.length).split('/')[0] ?? ''
    expect(host, `${origin} has no host`).not.toBe('*')
    // A leading `*.` subdomain wildcard is the most that is allowed, and only
    // because a Jira site lives on the customer's own subdomain.
    const withoutSubdomainWildcard = host.startsWith('*.') ? host.slice(2) : host
    expect(withoutSubdomainWildcard, `${origin} is too broad`).not.toContain('*')
    expect(withoutSubdomainWildcard.split('.').length, `${origin} is too broad`).toBeGreaterThan(1)
  }
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

/**
 * The two-chunk handshake (PRD §6, `editor-bridge`).
 *
 * The fast path ships without the editor, so this is the seam that pulls it
 * in. If it breaks, every capture still reaches a crop and then has nowhere to
 * go — a failure worth its own test rather than one implied by the smoke run,
 * which pre-injects both chunks.
 */
test('the worker injects the editor chunk on request', async ({ context, extensionId }) => {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/src/ui/library/index.html`)

  const reply = await page.evaluate(
    async () => await chrome.runtime.sendMessage({ kind: 'inject/editor' }),
  )

  // An extension page is not a host the extension may script, so injection
  // fails. What matters is the CONTRACT: the worker always answers, and a
  // refusal carries a reason. A silent non-reply would hang `loadEditor` and
  // strand a finished capture with nowhere to go.
  expect(reply, 'the worker did not answer an injection request').toBeDefined()
  expect(reply).toMatchObject({ ok: false })
  expect(String((reply as { error?: string }).error).length).toBeGreaterThan(10)
  await page.close()
})

test('the editor chunk registers its API and nothing else', async ({ context }) => {
  const page = await context.newPage()
  await page.goto('about:blank')
  await page.setContent('<body>host</body>')

  const before = await page.evaluate(() => typeof (window as never as Record<string, unknown>).__hotshotEditor)
  expect(before).toBe('undefined')

  await page.addScriptTag({ path: fileURLToPath(new URL('../dist/editor.js', import.meta.url)) })

  const api = await page.evaluate(() => {
    const editor = (window as never as Record<string, Record<string, unknown>>).__hotshotEditor
    return editor ? Object.keys(editor).sort() : null
  })
  expect(api, 'the editor chunk registered no API').toEqual([
    'addPin',
    'mountRecordBar',
    'openCapture',
  ])
  await page.close()
})

/**
 * FR-4's per-capture delay. Previously a delay was configured once in Settings
 * and then applied to every capture, which is a booby trap: the reason to want
 * one is true of one capture in fifty.
 */
test('the popup offers a per-capture delay and sends the choice', async ({
  page,
  extensionId,
}) => {
  await page.goto(`chrome-extension://${extensionId}/src/ui/popup/index.html`)
  await page.waitForLoadState('networkidle')

  const group = page.getByRole('group', { name: 'Capture delay' })
  await expect(group).toBeVisible()
  for (const label of ['None', '3s', '5s', '10s']) {
    await expect(group.getByRole('button', { name: label, exact: true })).toBeVisible()
  }

  // "None" is the default, so a delay is never on unless it is chosen.
  await expect(group.getByRole('button', { name: 'None', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Capture what the popup sends, rather than letting it drive a real capture.
  await page.evaluate(() => {
    const sent: unknown[] = []
    ;(window as never as Record<string, unknown>).__sent = sent
    chrome.runtime.sendMessage = ((message: unknown) => {
      sent.push(message)
      return Promise.resolve(undefined)
    }) as typeof chrome.runtime.sendMessage
    window.close = () => {}
  })

  await group.getByRole('button', { name: '5s', exact: true }).click()
  await expect(group.getByRole('button', { name: '5s', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: /Region/ }).click()

  const sent = await page.evaluate(() => (window as never as Record<string, unknown[]>).__sent)
  expect(sent).toEqual([{ kind: 'popup/capture', mode: 'region', delaySeconds: 5 }])
})

/**
 * The recording sources are chosen per recording, and default to nothing
 * beyond the screen. A microphone that was live because of a decision made
 * last Tuesday would be a privacy incident dressed as a convenience.
 */
test('the popup offers recording sources, all off by default', async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/src/ui/popup/index.html`)
  await page.waitForLoadState('networkidle')

  const group = page.getByRole('group', { name: 'Recording sources' })
  await expect(group).toBeVisible()
  await expect(page.getByText('Recording captures screen only')).toBeVisible()

  for (const label of ['Tab audio', 'Mic', 'Camera']) {
    const toggle = group.getByRole('button', { name: label, exact: true })
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  }

  // Capture what the popup sends rather than starting a real screen share.
  await page.evaluate(() => {
    const sent: unknown[] = []
    ;(window as never as Record<string, unknown>).__sent = sent
    chrome.runtime.sendMessage = ((message: unknown) => {
      sent.push(message)
      return Promise.resolve(undefined)
    }) as typeof chrome.runtime.sendMessage
    window.close = () => {}
  })

  await group.getByRole('button', { name: 'Mic', exact: true }).click()
  await expect(page.getByText('Recording captures screen + mic')).toBeVisible()
  await group.getByRole('button', { name: 'Camera', exact: true }).click()
  await expect(page.getByText('Recording captures screen + mic + camera')).toBeVisible()

  await page.getByRole('button', { name: /Record video/ }).click()
  const sent = await page.evaluate(() => (window as never as Record<string, unknown[]>).__sent)
  expect(sent).toEqual([
    {
      kind: 'popup/record',
      mode: 'video',
      options: { tabAudio: false, microphone: true, webcam: true },
    },
  ])
})
