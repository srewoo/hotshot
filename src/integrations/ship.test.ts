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
