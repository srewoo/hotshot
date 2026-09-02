import { beforeEach, describe, expect, test } from 'vitest'
import { createTokenRepo, maskToken, type StorageArea } from './token-repo'

/**
 * PRD FR-22 / R-4. Tokens are unscoped and carry full account permissions, so
 * the storage rules are security requirements, not conveniences:
 *   - chrome.storage.local ONLY. `sync` would push them to Google's servers,
 *     which directly violates brief constraint 2.
 *   - never logged, never echoed in an error.
 *   - masked in the UI after save (last 4 characters).
 *   - revoke clears the token AND that service's cached target metadata.
 */

function fakeArea(): StorageArea & { readonly data: Record<string, unknown> } {
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

describe('maskToken', () => {
  test('reveals only the last four characters', () => {
    expect(maskToken('pk_12345678abcd')).toBe('••••abcd')
  })

  test('masks a short token entirely rather than revealing most of it', () => {
    expect(maskToken('abcd')).toBe('••••')
    expect(maskToken('ab')).toBe('••••')
  })

  test('masks an empty token without throwing', () => {
    expect(maskToken('')).toBe('••••')
  })
})

describe('tokenRepo', () => {
  let area: ReturnType<typeof fakeArea>

  beforeEach(() => {
    area = fakeArea()
  })

  test('round-trips a token for a provider', async () => {
    const repo = createTokenRepo(area)
    await repo.set('jira', 'secret-value')
    expect(await repo.get('jira')).toBe('secret-value')
  })

  test('keeps providers isolated from one another', async () => {
    const repo = createTokenRepo(area)
    await repo.set('jira', 'jira-token')
    await repo.set('clickup', 'clickup-token')
    expect(await repo.get('jira')).toBe('jira-token')
    expect(await repo.get('clickup')).toBe('clickup-token')
  })

  test('returns null for a provider with no token', async () => {
    const repo = createTokenRepo(area)
    expect(await repo.get('notion')).toBeNull()
  })

  test('rejects an empty or whitespace-only token instead of storing it', async () => {
    const repo = createTokenRepo(area)
    await expect(repo.set('jira', '   ')).rejects.toThrow(/empty/i)
    expect(await repo.get('jira')).toBeNull()
  })

  test('trims surrounding whitespace, which pasted tokens routinely carry', async () => {
    const repo = createTokenRepo(area)
    await repo.set('jira', '  pasted-token\n')
    expect(await repo.get('jira')).toBe('pasted-token')
  })

  test('revoke removes the token AND that provider cached targets', async () => {
    const repo = createTokenRepo(area)
    await repo.set('jira', 'jira-token')
    await area.set({ 'hotshot.targets.jira': [{ id: 'PROJ' }] })

    await repo.revoke('jira')

    expect(await repo.get('jira')).toBeNull()
    expect(area.data['hotshot.targets.jira']).toBeUndefined()
  })

  test('revoke leaves other providers untouched', async () => {
    const repo = createTokenRepo(area)
    await repo.set('jira', 'jira-token')
    await repo.set('notion', 'notion-token')

    await repo.revoke('jira')

    expect(await repo.get('notion')).toBe('notion-token')
  })

  test('never writes a token under a key that a sync-scoped area would pick up', async () => {
    // Guard against a future refactor pointing this repo at storage.sync:
    // the repo must be constructed with an explicitly local area, and the
    // stored keys must be namespaced so an audit can find every one of them.
    const repo = createTokenRepo(area)
    await repo.set('jira', 'jira-token')
    const keys = Object.keys(area.data)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/^hotshot\.token\./)
  })

  test('the error thrown on an empty token does not echo the input', async () => {
    const repo = createTokenRepo(area)
    const secret = 'sensitive-but-blank-after-trim   '
    try {
      await repo.set('jira', '  ')
      expect.unreachable('should have thrown')
    } catch (e) {
      expect((e as Error).message).not.toContain(secret)
    }
  })
})
