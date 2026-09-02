import { beforeEach, describe, expect, test } from 'vitest'
import { createSettingsRepo, DEFAULT_SETTINGS } from './settings-repo'
import type { StorageArea } from './token-repo'

/** PRD FR-17 / FR-24 / FR-26. */

function fakeArea(): StorageArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {}
  return {
    data,
    async get(keys) {
      const out: Record<string, unknown> = {}
      for (const k of keys) if (k in data) out[k] = data[k]
      return out
    },
    async set(items) {
      Object.assign(data, items)
    },
    async remove(keys) {
      for (const k of keys) delete data[k]
    },
  }
}

describe('defaults', () => {
  test('auto-context fields default on, except user agent', () => {
    // FR-17: the user agent is PII-adjacent in some organisations, so it is
    // the one field that must be opted into.
    expect(DEFAULT_SETTINGS.autoContext).toEqual({
      url: true,
      title: true,
      viewport: true,
      devicePixelRatio: true,
      timestamp: true,
      userAgent: false,
    })
  })

  test('retention defaults to 7 days', () => {
    expect(DEFAULT_SETTINGS.retention).toBe('7d')
  })

  test('anonymous stats default OFF', () => {
    // PRD §9: default-off is the whole basis of the privacy claim.
    expect(DEFAULT_SETTINGS.anonymousStats).toBe(false)
  })

  test('default capture mode is region', () => {
    expect(DEFAULT_SETTINGS.defaultMode).toBe('region')
  })
})

describe('settings repo', () => {
  let area: ReturnType<typeof fakeArea>

  beforeEach(() => {
    area = fakeArea()
  })

  test('returns defaults when nothing is stored', async () => {
    expect(await createSettingsRepo(area).read()).toEqual(DEFAULT_SETTINGS)
  })

  test('round-trips a changed setting', async () => {
    const repo = createSettingsRepo(area)
    await repo.update({ retention: '30d' })
    expect((await repo.read()).retention).toBe('30d')
  })

  test('merges a partial update rather than replacing everything', async () => {
    const repo = createSettingsRepo(area)
    await repo.update({ retention: '30d' })
    await repo.update({ defaultMode: 'element' })

    const settings = await repo.read()
    expect(settings.retention).toBe('30d')
    expect(settings.defaultMode).toBe('element')
  })

  test('merges nested auto-context flags without dropping siblings', async () => {
    const repo = createSettingsRepo(area)
    await repo.update({ autoContext: { ...DEFAULT_SETTINGS.autoContext, userAgent: true } })

    const settings = await repo.read()
    expect(settings.autoContext.userAgent).toBe(true)
    expect(settings.autoContext.url).toBe(true)
  })

  test('falls back to defaults when stored data is corrupt', async () => {
    // Never trust storage: an older version, or a hand-edited profile, can
    // put anything here. Failing to defaults beats crashing on every capture.
    await area.set({ 'hotshot.settings': { retention: 'forever', defaultMode: 42 } })
    expect(await createSettingsRepo(area).read()).toEqual(DEFAULT_SETTINGS)
  })

  test('stores under a single namespaced key', async () => {
    await createSettingsRepo(area).update({ retention: '30d' })
    expect(Object.keys(area.data)).toEqual(['hotshot.settings'])
  })
})
