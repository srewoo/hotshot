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
 * Dropbox connector (PRD §10 v2 destinations).
 *
 * The one connector whose "target" is a FOLDER rather than an item, so the
 * picker lists folders and the capture becomes a file inside the chosen one.
 *
 * Two Dropbox-specific traps, both load-bearing:
 *   - Upload goes to `content.dropboxapi.com`, not `api.dropboxapi.com`. The
 *     API host answers and rejects the body.
 *   - The parameters travel in a `Dropbox-API-Arg` HEADER as JSON, with the
 *     raw bytes as the body under `application/octet-stream`. A header cannot
 *     carry non-ASCII, so the path has to be escaped — a capture from a page
 *     with an accented title would otherwise fail with an error about the
 *     header rather than about the name.
 *
 * VERIFY: written from Dropbox's published API shape, not against a live
 * account.
 */

const API = 'https://api.dropboxapi.com/2'
const CONTENT = 'https://content.dropboxapi.com/2'

export interface DropboxConfig {
  readonly token: string
}

const NETWORK_MESSAGE = 'Could not reach Dropbox. Check your connection and try again.'

function messageFor(status: number): string {
  switch (status) {
    case 400:
      return 'Dropbox rejected the request. This usually means the file path was not usable.'
    case 401:
      return 'Dropbox rejected the token. Check the access token in Settings.'
    case 403:
      return 'This Dropbox token is not allowed to write there.'
    case 409:
      return 'Dropbox could not write that path — the folder may not exist.'
    case 413:
      return 'Dropbox rejected the image as too large.'
    case 429:
      return 'Dropbox is rate-limiting this token. Wait a moment and retry.'
    default:
      return `Dropbox returned an unexpected status ${status}.`
  }
}

/**
 * Escapes a value for an HTTP header.
 *
 * `Dropbox-API-Arg` is a header, and headers are ASCII. Dropbox documents
 * `\uXXXX` escaping for exactly this: without it a capture from a page titled
 * "Rapport trimestriel" fails with an opaque header error rather than
 * anything about the filename.
 */
export function escapeApiArg(json: string): string {
  return json.replace(/[\u0080-\uffff]/g, (char) => {
    const code = char.codePointAt(0) ?? 0
    return `\\u${code.toString(16).padStart(4, '0')}`
  })
}

const accountSchema = z.object({
  account_id: z.string(),
  name: z.object({ display_name: z.string().optional() }).optional(),
  email: z.string().optional(),
})

const entriesSchema = z.object({
  entries: z.array(
    z.object({
      '.tag': z.string().optional(),
      name: z.string().optional(),
      path_lower: z.string().optional(),
      path_display: z.string().optional(),
    }),
  ),
})

const uploadSchema = z.object({ id: z.string(), path_display: z.string().optional() })

export function createDropboxProvider(
  config: DropboxConfig,
  fetchImpl: typeof globalThis.fetch,
): IntegrationProvider {
  const auth = { Authorization: `Bearer ${config.token}` }

  return {
    async testConnection(): Promise<Result<Identity, ProviderError>> {
      const response = await request(
        fetchImpl,
        `${API}/users/get_current_account`,
        // An RPC endpoint with no arguments still needs `null` as its body; an
        // empty body is a 400.
        { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: 'null' },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!response.ok) return response

      const parsed = accountSchema.safeParse(await response.value.json())
      if (!parsed.success) {
        return err({ kind: 'schema', message: 'Dropbox replied in an unrecognised shape.' })
      }
      return ok({
        accountId: parsed.data.account_id,
        displayName: parsed.data.name?.display_name ?? parsed.data.email ?? 'Dropbox',
      })
    },

    async searchTargets(query: string) {
      const needle = query.trim()

      // With a query Dropbox can search; without one, list the root — which is
      // the honest answer to "where would this go by default".
      const url = needle ? `${API}/files/search_v2` : `${API}/files/list_folder`
      const body = needle
        ? JSON.stringify({
            query: needle,
            options: { max_results: 20, file_status: 'active', filename_only: true },
          })
        : JSON.stringify({ path: '', recursive: false, limit: 50 })

      const response = await request(
        fetchImpl,
        url,
        { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!response.ok) return response

      const payload = (await response.value.json()) as Record<string, unknown>
      // `search_v2` nests each hit under `matches[].metadata.metadata`, while
      // `list_folder` returns `entries` directly. Normalised here so the
      // picker only ever sees one shape.
      const entries = Array.isArray(payload.matches)
        ? (payload.matches as Array<{ metadata?: { metadata?: unknown } }>).map(
            (match) => match.metadata?.metadata,
          )
        : payload.entries

      const parsed = entriesSchema.safeParse({ entries: entries ?? [] })
      if (!parsed.success) {
        return err({ kind: 'schema', message: 'Dropbox replied with an unrecognised listing.' })
      }

      const candidates: TargetCandidate[] = [
        // The root always works and needs no listing to discover.
        ...(needle ? [] : [{ key: '', title: 'Dropbox (root)', hint: '/' }]),
        ...parsed.data.entries
          .filter((entry) => entry['.tag'] === 'folder')
          .slice(0, 20)
          .map((entry) => ({
            key: entry.path_lower ?? entry.path_display ?? '',
            title: entry.name ?? entry.path_display ?? 'folder',
            hint: entry.path_display ?? '/',
          })),
      ]
      return ok(candidates)
    },

    async attachImage(target: TargetRef, blob: Blob, filename: string) {
      // The target is a folder, so the path is folder + filename. `add` with
      // `autorename` rather than `overwrite`: two captures a minute apart must
      // not silently replace one another.
      const folder = target.key.replace(/\/$/, '')
      const path = `${folder}/${filename}`.replace(/^([^/])/, '/$1')

      const response = await request(
        fetchImpl,
        `${CONTENT}/files/upload`,
        {
          method: 'POST',
          headers: {
            ...auth,
            'Content-Type': 'application/octet-stream',
            'Dropbox-API-Arg': escapeApiArg(
              JSON.stringify({ path, mode: 'add', autorename: true, mute: false }),
            ),
          },
          body: blob,
        },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!response.ok) return response

      const parsed = uploadSchema.safeParse(await response.value.json())
      if (!parsed.success) {
        return err({
          kind: 'schema',
          message: 'Dropbox accepted the upload but replied in an unrecognised shape.',
        })
      }
      return ok({ id: parsed.data.id })
    },
  }
}
