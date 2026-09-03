import { err, ok, type Result } from '../shared/result'
import type { ProviderError, ProviderErrorKind } from './provider'

/**
 * Shared transport for every connector (Architecture §4.2).
 *
 * Status→kind mapping is common; the WORDING is not. Each service fails for
 * its own reasons — Notion's 404 almost always means "you forgot to invite the
 * integration", which is nothing like Jira's 404 — so messages stay in each
 * client and only the plumbing lives here.
 */

export function kindForStatus(status: number): ProviderErrorKind {
  switch (status) {
    case 401:
      return 'auth'
    case 403:
      return 'forbidden'
    case 404:
      return 'not-found'
    case 413:
      return 'too-large'
    case 429:
      return 'rate-limited'
    default:
      return 'unknown'
  }
}

export type MessageFor = (status: number) => string

/**
 * Performs the request and normalises failure. Never throws: a rejected fetch
 * becomes a `network` error, because an exception crossing a realm boundary
 * loses its stack anyway (Architecture §6).
 */
export async function request(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  init: RequestInit,
  messageFor: MessageFor,
  networkMessage: string,
): Promise<Result<Response, ProviderError>> {
  try {
    const response = await fetchImpl(url, init)
    if (response.ok) return ok(response)

    // Read the body once, here: a Response can only be consumed once, and a
    // connector that needs the reason cannot re-read it later.
    const detail = await response.text().catch(() => '')

    return err({
      kind: kindForStatus(response.status),
      status: response.status,
      message: messageFor(response.status),
      detail: detail.slice(0, 400),
    })
  } catch {
    // The caught value is deliberately not interpolated: a fetch rejection can
    // carry a URL with query parameters, and those can carry credentials.
    return err({ kind: 'network', message: networkMessage })
  }
}
