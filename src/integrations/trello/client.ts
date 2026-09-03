import { z } from 'zod'
import { err, ok, type Result } from '../../shared/result'
import type {
  Identity,
  IntegrationProvider,
  ProviderError,
  TargetCandidate,
  TargetRef,
} from '../provider'
import { request } from '../http'

/**
 * Trello connector (PRD §10 v2 destinations).
 *
 * Trello authenticates with a key AND a token, both as query parameters rather
 * than a header. That is unusual enough to state: it means the credential is
 * in the URL, so it must never be interpolated into an error message or a log
 * line — `http.ts` already refuses to echo a failed request's URL for exactly
 * this reason.
 *
 * The token field holds `key:token`, so the existing single-secret storage
 * carries both without a second field.
 *
 * VERIFY: written from Trello's published REST shape, not against a live board.
 */

const BASE = 'https://api.trello.com/1'

export interface TrelloConfig {
  /** `key:token`, as pasted from Trello's developer page. */
  readonly token: string
}

const NETWORK_MESSAGE = 'Could not reach Trello. Check your connection and try again.'

function messageFor(status: number): string {
  switch (status) {
    case 401:
      return 'Trello rejected the credentials. Check the key and token in Settings.'
    case 403:
      return 'This Trello token cannot attach to that card.'
    case 404:
      return 'Trello has no such card visible to this token.'
    case 413:
      return 'Trello rejected the image as too large.'
    case 429:
      return 'Trello is rate-limiting this token. Wait a moment and retry.'
    default:
      return `Trello returned an unexpected status ${status}.`
  }
}

const memberSchema = z.object({
  id: z.string(),
  fullName: z.string().optional(),
  username: z.string().optional(),
})

const cardsSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string().optional(),
    shortLink: z.string().optional(),
  }),
)

const attachmentSchema = z.object({ id: z.string() })

/** Splits the stored `key:token` pair, refusing anything else. */
export function splitCredentials(value: string): { key: string; token: string } | null {
  const separator = value.indexOf(':')
  if (separator <= 0) return null
  const key = value.slice(0, separator).trim()
  const token = value.slice(separator + 1).trim()
  return key && token ? { key, token } : null
}

export function createTrelloProvider(
  config: TrelloConfig,
  fetchImpl: typeof globalThis.fetch,
): IntegrationProvider {
  const credentials = splitCredentials(config.token)

  /** Appends the credentials, which Trello takes as query parameters. */
  function url(path: string, params: Record<string, string> = {}): string {
    const search = new URLSearchParams({
      key: credentials?.key ?? '',
      token: credentials?.token ?? '',
      ...params,
    })
    return `${BASE}${path}?${search.toString()}`
  }

  const misconfigured = (): Result<never, ProviderError> =>
    err({
      kind: 'auth',
      message: 'Trello needs a key and a token, entered as `key:token` in Settings.',
    })

  return {
    async testConnection(): Promise<Result<Identity, ProviderError>> {
      if (!credentials) return misconfigured()

      const response = await request(
        fetchImpl,
        url('/members/me', { fields: 'fullName,username' }),
        { headers: { Accept: 'application/json' } },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!response.ok) return response

      const parsed = memberSchema.safeParse(await response.value.json())
      if (!parsed.success) {
        return err({ kind: 'schema', message: 'Trello replied in an unrecognised shape.' })
      }
      return ok({
        accountId: parsed.data.id,
        displayName: parsed.data.fullName ?? parsed.data.username ?? 'Trello',
      })
    },

    async searchTargets(query: string) {
      if (!credentials) return misconfigured()

      const response = await request(
        fetchImpl,
        url('/members/me/cards', { fields: 'name,shortLink', limit: '100' }),
        { headers: { Accept: 'application/json' } },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!response.ok) return response

      const parsed = cardsSchema.safeParse(await response.value.json())
      if (!parsed.success) {
        return err({ kind: 'schema', message: 'Trello replied with an unrecognised card list.' })
      }

      // Filtered locally: `/members/me/cards` has no query parameter, and the
      // search API needs a different token scope than attaching does.
      const needle = query.trim().toLowerCase()
      const candidates: TargetCandidate[] = parsed.data
        .filter((card) => !needle || (card.name ?? '').toLowerCase().includes(needle))
        .slice(0, 20)
        .map((card) => ({
          key: card.id,
          title: card.name ?? card.id,
          hint: card.shortLink ?? card.id.slice(0, 8),
        }))
      return ok(candidates)
    },

    async attachImage(target: TargetRef, blob: Blob, filename: string) {
      if (!credentials) return misconfigured()

      const form = new FormData()
      form.append('file', blob, filename)
      form.append('name', filename)

      const response = await request(
        fetchImpl,
        url(`/cards/${target.key}/attachments`),
        {
          method: 'POST',
          // Content-Type is deliberately absent: fetch must generate the
          // multipart boundary itself.
          body: form,
        },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!response.ok) return response

      const parsed = attachmentSchema.safeParse(await response.value.json())
      if (!parsed.success) {
        return err({
          kind: 'schema',
          message: 'Trello accepted the upload but replied in an unrecognised shape.',
        })
      }
      return ok({ id: parsed.data.id })
    },
  }
}
