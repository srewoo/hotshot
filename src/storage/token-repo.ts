/**
 * Integration token storage (PRD FR-22).
 *
 * Tokens for all three services are UNSCOPED — they carry the full permissions
 * of the user's account (PRD R-4). That makes every rule here a security
 * requirement rather than a convenience:
 *
 *   - The storage area is injected, and callers must pass `chrome.storage.local`.
 *     `storage.sync` would replicate tokens to Google's servers, violating the
 *     brief's "nothing leaves the machine" constraint.
 *   - Token values are never logged and never interpolated into an error.
 *   - Revoking clears the cached target metadata too, so a revoked service
 *     leaves nothing behind that identifies the account.
 */

export type ProviderId = 'jira' | 'notion' | 'clickup'

/** The subset of `chrome.storage.StorageArea` this repo needs. Injected for testability. */
export interface StorageArea {
  get(keys: readonly string[]): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: readonly string[]): Promise<void>
}

/**
 * Adapts `chrome.storage.local` to `StorageArea`.
 *
 * The Chrome typings take a mutable `string[]`, which does not accept our
 * `readonly string[]`. Adapting here keeps every repo's interface honest
 * rather than widening it to match a third-party type.
 */
export function chromeLocalArea(): StorageArea {
  return {
    get: (keys) => chrome.storage.local.get([...keys]),
    set: (items) => chrome.storage.local.set(items),
    remove: (keys) => chrome.storage.local.remove([...keys]),
  }
}

export interface TokenRepo {
  get(provider: ProviderId): Promise<string | null>
  set(provider: ProviderId, token: string): Promise<void>
  revoke(provider: ProviderId): Promise<void>
}

const TOKEN_PREFIX = 'hotshot.token.'
const TARGETS_PREFIX = 'hotshot.targets.'

const tokenKey = (p: ProviderId): string => `${TOKEN_PREFIX}${p}`
const targetsKey = (p: ProviderId): string => `${TARGETS_PREFIX}${p}`

/** Renders a token for display. Only the last four characters survive. */
export function maskToken(token: string): string {
  const dots = '••••'
  return token.length > 4 ? `${dots}${token.slice(-4)}` : dots
}

export function createTokenRepo(area: StorageArea): TokenRepo {
  return {
    async get(provider) {
      const key = tokenKey(provider)
      const stored = await area.get([key])
      const value = stored[key]
      return typeof value === 'string' && value.length > 0 ? value : null
    },

    async set(provider, token) {
      const trimmed = token.trim()
      if (trimmed.length === 0) {
        // Deliberately does not include the input: an error message is a log
        // line waiting to happen.
        throw new Error(`Refusing to store an empty ${provider} token.`)
      }
      await area.set({ [tokenKey(provider)]: trimmed })
    },

    async revoke(provider) {
      await area.remove([tokenKey(provider), targetsKey(provider)])
    },
  }
}
