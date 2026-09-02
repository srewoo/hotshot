import type { Result } from '../shared/result'

/**
 * The seam OAuth drops into in v2 (Architecture §4.2).
 *
 * If a v2 change forces edits outside a provider's own `client.ts`, this
 * interface was drawn wrong.
 */
export type ProviderErrorKind =
  | 'auth' | 'forbidden' | 'not-found' | 'too-large'
  | 'rate-limited' | 'network' | 'schema' | 'unknown'

export interface ProviderError {
  readonly kind: ProviderErrorKind
  /** Plain language, shown to the user. Never contains a token. */
  readonly message: string
  readonly status?: number
}

export interface Identity {
  readonly accountId: string
  readonly displayName: string
}

export interface TargetRef { readonly key: string }

export interface IntegrationProvider {
  testConnection(): Promise<Result<Identity, ProviderError>>
  attachImage(target: TargetRef, blob: Blob, filename: string): Promise<Result<{ id: string }, ProviderError>>
}
