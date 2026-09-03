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
  /**
   * The service's own response body, truncated.
   *
   * Kept separate from `message` so a connector can distinguish causes that
   * share a status — a Notion 400 is an expired upload OR a malformed request,
   * and telling the user the wrong one sends them chasing the wrong problem.
   */
  readonly detail?: string
}

export interface Identity {
  readonly accountId: string
  readonly displayName: string
}

export interface TargetRef { readonly key: string }

/**
 * A destination the user could plausibly mean (PRD FR-41).
 *
 * The point of the type is the `title`: asking someone to type `ABC-412` from
 * memory sends them to another tab to look it up, which is the exact app
 * switch the product exists to remove. A picker needs something human to show.
 */
export interface TargetCandidate {
  /** The identifier `attachImage` takes. */
  readonly key: string
  readonly title: string
  /** Secondary line — project, list, or status. Never required. */
  readonly hint?: string | undefined
}

export interface IntegrationProvider {
  testConnection(): Promise<Result<Identity, ProviderError>>
  attachImage(target: TargetRef, blob: Blob, filename: string): Promise<Result<{ id: string }, ProviderError>>
  /**
   * Plausible targets for a query (FR-41).
   *
   * An EMPTY query means "what would I most likely want right now" — recently
   * viewed or assigned work — which is what makes the picker useful before the
   * user has typed anything. Searching happens service-side wherever the API
   * supports it, so the result reflects the whole account rather than a local
   * cache of whatever was seen before.
   */
  searchTargets(query: string): Promise<Result<readonly TargetCandidate[], ProviderError>>
}
