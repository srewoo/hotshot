import { describe, expect, test, vi } from 'vitest'
import { shipCapture, type ShipDeps } from './ship'
import { isErr, isOk, ok, err } from '../shared/result'
import { DEFAULT_SETTINGS } from '../storage/settings-repo'
import type { CaptureFacts } from '../shared/capture-context'

/**
 * PRD FR-13..FR-19. The "last mile" the product is positioned on: this is
 * where the connector, the auto-context, the title template and the
 * remembered target finally meet.
 */

const facts: CaptureFacts = {
  url: 'https://example.com/orders/412',
  title: 'Order 412',
  viewportWidth: 1280,
  viewportHeight: 800,
  devicePixelRatio: 2,
  userAgent: 'Chrome/140',
  capturedAt: new Date(Date.UTC(2026, 8, 2, 14, 30, 5)),
}

const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

function deps(overrides: Partial<ShipDeps> = {}): ShipDeps {
  return {
    provider: {
      testConnection: vi.fn(async () => ok({ accountId: 'a', displayName: 'Sam' })),
      attachImage: vi.fn(async () => ok({ id: 'att-1' })),
      // Shipping never searches; present only to satisfy the seam.
      searchTargets: vi.fn(async () => ok([])),
    },
    settings: DEFAULT_SETTINGS,
    rememberTarget: vi.fn(async () => undefined),
    lastTarget: vi.fn(async () => null),
    ...overrides,
  }
}

describe('shipCapture', () => {
  test('attaches the image to the named target', async () => {
    const d = deps()
    const result = await shipCapture('jira', { key: 'ABC-412' }, png, facts, d)

    expect(isOk(result)).toBe(true)
    expect(d.provider.attachImage).toHaveBeenCalledTimes(1)
  })

  test('names the file from the title template rather than a generic name', async () => {
    const d = deps()
    await shipCapture('jira', { key: 'ABC-1' }, png, facts, d)

    const filename = vi.mocked(d.provider.attachImage).mock.calls[0]?.[2]
    expect(filename).toMatch(/order-412/i)
    expect(filename).toMatch(/\.png$/)
  })

  test('returns a deep link so the toast can point at the created item', async () => {
    const result = await shipCapture('jira', { key: 'ABC-412' }, png, facts, deps())
    expect(isOk(result) && result.value.url).toContain('ABC-412')
  })

  test('remembers the target for next time (FR-19)', async () => {
    const d = deps()
    await shipCapture('clickup', { key: 'task-9' }, png, facts, d)
    expect(d.rememberTarget).toHaveBeenCalledWith('clickup', { key: 'task-9' })
  })

  test('does not remember a target when the ship failed', async () => {
    // Remembering a target that does not work would reproduce the failure on
    // every later capture.
    const d = deps({
      provider: {
        testConnection: vi.fn(async () => ok({ accountId: 'a', displayName: 'Sam' })),
        attachImage: vi.fn(async () => err({ kind: 'not-found' as const, message: 'gone' })),
        searchTargets: vi.fn(async () => ok([])),
      },
    })
    await shipCapture('jira', { key: 'GONE-1' }, png, facts, d)
    expect(d.rememberTarget).not.toHaveBeenCalled()
  })

  test('falls back to the remembered target when none is given', async () => {
    const d = deps({ lastTarget: vi.fn(async () => ({ key: 'REMEMBERED-7' })) })
    const result = await shipCapture('jira', null, png, facts, d)

    expect(isOk(result)).toBe(true)
    expect(vi.mocked(d.provider.attachImage).mock.calls[0]?.[0]).toEqual({ key: 'REMEMBERED-7' })
  })

  test('asks for a target rather than guessing when nothing is remembered', async () => {
    const d = deps()
    const result = await shipCapture('jira', null, png, facts, d)

    expect(isErr(result) && result.error.kind).toBe('no-target')
    expect(d.provider.attachImage).not.toHaveBeenCalled()
  })

  test('surfaces the connector error message unchanged', async () => {
    // The connectors already write plain-language messages; rewrapping them
    // here would lose Notion's "invite the integration" wording.
    const d = deps({
      provider: {
        testConnection: vi.fn(async () => ok({ accountId: 'a', displayName: 'Sam' })),
        attachImage: vi.fn(async () =>
          err({ kind: 'not-found' as const, message: 'Invite the integration to that page.' }),
        ),
        searchTargets: vi.fn(async () => ok([])),
      },
    })
    const result = await shipCapture('notion', { key: 'p1' }, png, facts, d)
    expect(isErr(result) && result.error.message).toBe('Invite the integration to that page.')
  })
})

describe('auto-context (FR-17)', () => {
  test('includes the enabled context in the comment body', async () => {
    const d = deps()
    const result = await shipCapture('jira', { key: 'A-1' }, png, facts, d)
    expect(isOk(result) && result.value.context.join('\n')).toContain(
      'https://example.com/orders/412',
    )
  })

  test('omits the user agent by default', async () => {
    const result = await shipCapture('jira', { key: 'A-1' }, png, facts, deps())
    expect(isOk(result) && result.value.context.join('\n')).not.toContain('Chrome/140')
  })

  test('emits no context when every field is disabled', async () => {
    const d = deps({
      settings: {
        ...DEFAULT_SETTINGS,
        autoContext: {
          url: false,
          title: false,
          viewport: false,
          devicePixelRatio: false,
          timestamp: false,
          userAgent: false,
        },
      },
    })
    const result = await shipCapture('jira', { key: 'A-1' }, png, facts, d)
    expect(isOk(result) && result.value.context).toEqual([])
  })
})

describe('share links (FR-20)', () => {
  test('builds a real Jira URL when the site is known', async () => {
    // The share link with no backend: the destination hosts it, not us.
    const result = await shipCapture('jira', { key: 'ABC-412' }, png, facts, {
      ...deps(),
      linkContext: { jiraSite: 'acme.atlassian.net' },
    })
    expect(isOk(result) && result.value.url).toBe('https://acme.atlassian.net/browse/ABC-412')
  })

  test('returns the bare key rather than a link that goes nowhere', async () => {
    // Without the site there is no URL to build; a plausible-looking broken
    // link is worse than an honest key.
    const result = await shipCapture('jira', { key: 'ABC-412' }, png, facts, deps())
    expect(isOk(result) && result.value.url).toBe('ABC-412')
  })

  test('builds a ClickUp task URL', async () => {
    const result = await shipCapture('clickup', { key: 'abc123' }, png, facts, deps())
    expect(isOk(result) && result.value.url).toBe('https://app.clickup.com/t/abc123')
  })

  test('strips dashes from a Notion page id, as Notion URLs require', async () => {
    const result = await shipCapture(
      'notion',
      { key: '2a1509b1-9e06-8000-b573-cf3c13abc281' },
      png,
      facts,
      deps(),
    )
    expect(isOk(result) && result.value.url).toBe(
      'https://www.notion.so/2a1509b19e068000b573cf3c13abc281',
    )
  })
})

describe('the uploaded filename follows the bytes', () => {
  test('a PNG keeps its .png suffix', async () => {
    const d = deps()
    await shipCapture('jira', { key: 'ABC-1' }, png, facts, d)
    const attach = d.provider.attachImage as unknown as {
      mock: { calls: Array<[unknown, Blob, string]> }
    }
    expect(attach.mock.calls[0]?.[2]).toMatch(/\.png$/)
  })

  /**
   * A capture compressed to JPEG to fit an attachment limit must not be
   * uploaded named `.png` — that is how a service refuses or mis-renders a
   * perfectly good image.
   */
  test('a JPEG is renamed, because it is no longer a PNG', async () => {
    const d = deps()
    const jpeg = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })
    await shipCapture('jira', { key: 'ABC-1' }, jpeg, facts, d)
    const attach = d.provider.attachImage as unknown as {
      mock: { calls: Array<[unknown, Blob, string]> }
    }
    expect(attach.mock.calls[0]?.[2]).toMatch(/\.jpg$/)
  })
})
