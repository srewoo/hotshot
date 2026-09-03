import { test, expect } from './fixtures'

/**
 * The library, against the real extension (PRD FR-25/FR-26).
 *
 * Driven through the worker's own messages and the real IndexedDB, because
 * that is the whole feature: the worker owns the store so a content script on
 * an arbitrary page can never read someone's capture history, and the library
 * page is deliberately just another caller of the same door.
 */

/** A tiny valid PNG, as the content script would send it. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABGdBTUEAALGPC/xhBQAAACBjSFJN' +
  'AAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAAmJLR0QA/4ePzL8AAAAHdElN' +
  'RQfmAQEAAAAJcEhZcwAAAEgAAABIAEbJaz4AAAAKdEVYdENvbW1lbnQA9syWvwAAAAxJREFUCNdj' +
  'YGBgAAAABAABJzQnCgAAAABJRU5ErkJggg=='

test.describe('library round trip', () => {
  test('records, lists, favourites, tags, searches, deletes and undoes', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/src/ui/library/index.html`)
    await page.waitForLoadState('networkidle')

    // Start from a known state, whatever earlier tests left behind.
    await page.evaluate(() => chrome.runtime.sendMessage({ kind: 'library/clear' }))

    /**
     * Records a capture the way the editor's commit does — as a PNG data URL.
     *
     * NOT an ArrayBuffer: `sendMessage` serialises through JSON, so a buffer
     * arrives as `{}` and gets stored as the string "[object Object]".
     */
    const record = async (title: string, url: string, base64: string) =>
      await page.evaluate(
        async ([t, u, b]) => {
          await chrome.runtime.sendMessage({
            kind: 'history/record',
            dataUrl: `data:image/png;base64,${b}`,
            widthDevicePx: 8,
            heightDevicePx: 8,
            sourceUrl: u,
            title: t,
          })
        },
        [title, url, base64] as const,
      )

    await record('Invoice 412', 'https://staging.acme.com/invoices/412', PNG_BASE64)
    await record('Login screen', 'https://app.example.org/login', PNG_BASE64)

    const list = async () =>
      await page.evaluate(async () => {
        const reply = (await chrome.runtime.sendMessage({ kind: 'library/list' })) as {
          entries?: Array<Record<string, unknown>>
        }
        return reply.entries ?? []
      })

    await expect.poll(async () => (await list()).length, { timeout: 5_000 }).toBe(2)

    const entries = await list()
    const invoice = entries.find((e) => e.title === 'Invoice 412')
    expect(invoice, 'the capture was not recorded').toBeDefined()
    expect(invoice?.bytes as number).toBeGreaterThan(0)

    // The bytes come back, which is what every other feature depends on.
    const dataUrl = await page.evaluate(async (id: string) => {
      const reply = (await chrome.runtime.sendMessage({ kind: 'library/read', id })) as {
        dataUrl?: string
      }
      return reply.dataUrl ?? null
    }, invoice?.id as string)
    expect(dataUrl?.startsWith('data:image/png;base64,')).toBe(true)
    // And it is the ACTUAL capture, not a JSON-mangled placeholder.
    expect(dataUrl, 'the stored bytes are not the capture').toBe(
      `data:image/png;base64,${PNG_BASE64}`,
    )

    // Favourite, then tag.
    await page.evaluate(
      async (id: string) => {
        await chrome.runtime.sendMessage({ kind: 'library/favourite', id })
        await chrome.runtime.sendMessage({ kind: 'library/tag', id, tag: 'Billing', add: true })
      },
      invoice?.id as string,
    )

    const tagged = (await list()).find((e) => e.id === invoice?.id)
    expect(tagged?.favourite).toBe(true)
    // Normalised on write, so a filter row cannot show both "Billing" and "billing".
    expect(tagged?.tags).toEqual(['billing'])

    /**
     * And the IMAGE survived the metadata write. Listing strips blobs so the
     * rows a caller holds are blob-less; writing one back with a plain `put`
     * destroyed the capture, so favouriting a screenshot silently deleted it.
     */
    const afterTagging = await page.evaluate(async (id: string) => {
      const reply = (await chrome.runtime.sendMessage({ kind: 'library/read', id })) as {
        dataUrl?: string
      }
      return reply.dataUrl ?? null
    }, invoice?.id as string)
    expect(afterTagging, 'favouriting a capture destroyed its image').toBe(dataUrl)

    // Delete both, then undo — the blobs are the only copy there is.
    const removed = await page.evaluate(async (ids: string[]) => {
      const reply = (await chrome.runtime.sendMessage({ kind: 'library/delete', ids })) as {
        removed?: number
      }
      return reply.removed ?? 0
    }, entries.map((e) => e.id as string))
    expect(removed).toBe(2)
    expect(await list()).toHaveLength(0)

    const restored = await page.evaluate(async () => {
      const reply = (await chrome.runtime.sendMessage({ kind: 'library/undo-delete' })) as {
        restored?: number
      }
      return reply.restored ?? 0
    })
    expect(restored, 'a bulk delete could not be undone').toBe(2)
    expect(await list()).toHaveLength(2)

    // The restored rows still carry their favourite and tag.
    const after = (await list()).find((e) => e.id === invoice?.id)
    expect(after?.favourite).toBe(true)
    expect(after?.tags).toEqual(['billing'])

    await page.close()
  })

  test('exports a self-contained document and imports it back', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/src/ui/library/index.html`)
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => chrome.runtime.sendMessage({ kind: 'library/clear' }))

    await page.evaluate(async (b: string) => {
      await chrome.runtime.sendMessage({
        kind: 'history/record',
        dataUrl: `data:image/png;base64,${b}`,
        widthDevicePx: 8,
        heightDevicePx: 8,
        sourceUrl: 'https://acme.com/one',
        title: 'Exported capture',
      })
    }, PNG_BASE64)

    const exported = await page.evaluate(async () => {
      const reply = (await chrome.runtime.sendMessage({ kind: 'library/export' })) as {
        document?: { version?: number; captures?: Array<Record<string, unknown>> }
      }
      return reply.document ?? null
    })

    expect(exported?.version).toBe(1)
    expect(exported?.captures).toHaveLength(1)
    // Self-contained: an export that references files alongside it is an
    // export the user eventually finds broken.
    expect(String(exported?.captures?.[0]?.dataUrl)).toContain('data:image/png;base64,')

    // Clear, then import the very document that was produced.
    await page.evaluate(() => chrome.runtime.sendMessage({ kind: 'library/clear' }))
    const imported = await page.evaluate(async (document_: unknown) => {
      const reply = (await chrome.runtime.sendMessage({
        kind: 'library/import',
        document: document_,
      })) as { imported?: number }
      return reply.imported ?? 0
    }, exported)

    expect(imported).toBe(1)
    const entries = await page.evaluate(async () => {
      const reply = (await chrome.runtime.sendMessage({ kind: 'library/list' })) as {
        entries?: Array<Record<string, unknown>>
      }
      return reply.entries ?? []
    })
    expect(entries[0]?.title).toBe('Exported capture')

    await page.close()
  })

  /**
   * Imported rows are untrusted input like any other boundary: the dataUrl
   * ends up in an `<img src>`, and a remote URL there would turn an import
   * into the one thing this product promises never to do.
   */
  test('refuses import rows that are not PNG data URLs', async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/src/ui/library/index.html`)
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => chrome.runtime.sendMessage({ kind: 'library/clear' }))

    const imported = await page.evaluate(async () => {
      const reply = (await chrome.runtime.sendMessage({
        kind: 'library/import',
        document: {
          version: 1,
          captures: [
            { id: 'a', dataUrl: 'https://exfiltrate.example/pixel.png', title: 'remote' },
            { id: 'b', dataUrl: 'data:text/html;base64,PHNjcmlwdD4=', title: 'html' },
            { id: 'c', title: 'no data url' },
          ],
        },
      })) as { imported?: number }
      return reply.imported ?? 0
    })

    expect(imported, 'a non-PNG import row was accepted').toBe(0)
    await page.close()
  })

  test('the library page renders its controls', async ({ context, extensionId }) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/src/ui/library/index.html`)
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('searchbox', { name: 'Search captures' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export all' })).toBeVisible()
    // Grid/list is a toggle, so exactly one of the two labels is showing.
    await expect(page.getByRole('button', { name: /^(Grid|List)$/ })).toBeVisible()
    await page.close()
  })

  /**
   * "Send it there again" (FR-25).
   *
   * Refuses plainly when a capture never went anywhere — a button that needed
   * a destination chosen first would be a button that fails — and repeats the
   * recorded one otherwise.
   */
  test('re-send refuses a capture with no destination, and repeats one that has', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/src/ui/library/index.html`)
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => chrome.runtime.sendMessage({ kind: 'library/clear' }))

    await page.evaluate(async (b: string) => {
      await chrome.runtime.sendMessage({
        kind: 'history/record',
        dataUrl: `data:image/png;base64,${b}`,
        widthDevicePx: 8,
        heightDevicePx: 8,
        sourceUrl: 'https://acme.com/x',
        title: 'Resendable',
      })
    }, PNG_BASE64)

    const list = async () =>
      await page.evaluate(async () => {
        const reply = (await chrome.runtime.sendMessage({ kind: 'library/list' })) as {
          entries?: Array<Record<string, unknown>>
        }
        return reply.entries ?? []
      })
    await expect.poll(async () => (await list()).length, { timeout: 5_000 }).toBe(1)
    const id = String((await list())[0]?.id)

    // No destination yet, so there is nothing to repeat.
    const refusal = await page.evaluate(
      async (captureId: string) =>
        (await chrome.runtime.sendMessage({ kind: 'library/resend', id: captureId })) as {
          ok?: boolean
          message?: string
        },
      id,
    )
    expect(refusal.ok).toBe(false)
    expect(String(refusal.message)).toContain('never sent anywhere')

    // Record an outcome the way a successful ship does.
    await page.evaluate(() =>
      chrome.runtime.sendMessage({
        kind: 'history/destination',
        destination: { provider: 'jira', key: 'ABC-412' },
      }),
    )
    await expect
      .poll(async () => (await list())[0]?.destination, { timeout: 5_000 })
      .toMatchObject({ provider: 'jira', key: 'ABC-412' })

    // Now it has somewhere to go. Jira is not connected in this profile, so
    // the attempt fails on the token — which is still proof the destination
    // was resolved and the ship was attempted rather than refused up front.
    const attempt = await page.evaluate(
      async (captureId: string) =>
        (await chrome.runtime.sendMessage({ kind: 'library/resend', id: captureId })) as {
          ok?: boolean
          message?: string
        },
      id,
    )
    expect(attempt.ok).toBe(false)
    expect(String(attempt.message)).toContain('not connected')

    await page.close()
  })

})