import { z } from 'zod'
import { err, ok, type Result } from '../../shared/result'
import type { Identity, IntegrationProvider, ProviderError, TargetRef } from '../provider'
import { request } from '../http'

/**
 * Notion connector (PRD FR-15, §7.2).
 *
 * The only three-step upload in the product: create → send → attach. An upload
 * that is never attached expires in one hour, and retrying an expired id fails
 * in a way that looks like a bug, so that case is reported distinctly.
 *
 * UNVERIFIED AGAINST THE LIVE API. PRD R-1 flags that browser-context CORS
 * behaviour from an MV3 background fetch has not been proven; the spike in
 * `spikes/notion-cors/` settles it. Until then this connector must not be
 * treated as P0-complete.
 */

const BASE = 'https://api.notion.com/v1'

/** Pinned. An unpinned version lets Notion change our behaviour silently. */
export const NOTION_VERSION = '2022-06-28'

/** §7.2: 20MB for the single-part path. Larger needs multi-part, out of scope. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/**
 * A Notion page or block id is a UUID: 32 hex characters, dashed or not.
 *
 * Validating up front turns a wasted three-step upload and a misleading error
 * into one clear sentence. Notion's own URLs show the id in both forms, so
 * both are accepted.
 */
function normalisePageId(key: string): string | null {
  const bare = key.trim().replaceAll('-', '')
  return /^[0-9a-f]{32}$/i.test(bare) ? bare : null
}

export interface NotionConfig {
  readonly token: string
}

const identitySchema = z.object({ id: z.string().min(1), name: z.string().nullable() })

/**
 * Notion search results (FR-41).
 *
 * Titles are awkward: a page's title lives in whichever property has type
 * `title`, whose NAME differs per database, and a database's title is a
 * top-level rich-text array. Both shapes are accepted and everything else is
 * optional, because a search result Hotshot cannot title is still a result it
 * can offer by id rather than one that breaks the picker.
 */
const richText = z.array(z.object({ plain_text: z.string() })).optional()

const searchSchema = z.object({
  results: z.array(
    z.object({
      id: z.string().min(1),
      object: z.string().optional(),
      title: richText,
      properties: z.record(z.object({ type: z.string().optional(), title: richText })).optional(),
    }),
  ),
})

/** Notion's own id format, which the picker hands straight to `attachImage`. */
function titleOf(result: z.infer<typeof searchSchema>['results'][number]): string {
  const fromTop = result.title?.map((part) => part.plain_text).join('')
  if (fromTop) return fromTop

  for (const property of Object.values(result.properties ?? {})) {
    if (property.type !== 'title') continue
    const text = property.title?.map((part) => part.plain_text).join('')
    if (text) return text
  }
  return 'Untitled'
}
const uploadSchema = z.object({ id: z.string().min(1) })

const NETWORK_MESSAGE = 'Could not reach Notion. Check your connection and try again.'

function messageFor(status: number): string {
  switch (status) {
    case 401:
      return 'Notion rejected the token. Check the integration token in Settings.'
    case 403:
      return 'This Notion integration lacks permission to insert content.'
    case 404:
      // The single most valuable error message in the product. "Not found" is
      // technically true and practically useless: the page exists, the user
      // simply has not invited the integration to it (§7.2).
      return 'Notion cannot see that page. Open it, choose ••• → Connections, and invite the Hotshot integration — then try again.'
    case 413:
      return 'Notion rejected the image as too large.'
    case 429:
      return 'Notion is rate-limiting this integration. Wait a moment and retry.'
    default:
      return `Notion returned an unexpected status ${status}.`
  }
}

export function createNotionProvider(
  config: NotionConfig,
  fetchImpl: typeof globalThis.fetch,
): IntegrationProvider {
  const headers = {
    Authorization: `Bearer ${config.token}`,
    'Notion-Version': NOTION_VERSION,
  }
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' }

  return {
    async searchTargets(query: string) {
      const response = await request(
        fetchImpl,
        `${BASE}/search`,
        {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({
            ...(query.trim() ? { query: query.trim() } : {}),
            // Pages only: a database is not something an image block can be
            // appended to, so offering one would be offering a failure.
            filter: { property: 'object', value: 'page' },
            sort: { direction: 'descending', timestamp: 'last_edited_time' },
            page_size: 20,
          }),
        },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!response.ok) return response

      const parsed = searchSchema.safeParse(await response.value.json())
      if (!parsed.success) {
        return err({
          kind: 'schema',
          message: 'Notion replied to the search in an unrecognised shape.',
        })
      }

      return ok(
        parsed.data.results.map((result) => ({
          key: result.id,
          title: titleOf(result),
          // Notion ids are opaque, so the hint is the only way a user can tell
          // two identically-titled pages apart.
          hint: result.id.replaceAll('-', '').slice(0, 8),
        })),
      )
    },

    async testConnection(): Promise<Result<Identity, ProviderError>> {
      const response = await request(
        fetchImpl,
        `${BASE}/users/me`,
        { headers },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!response.ok) return response

      const parsed = identitySchema.safeParse(await response.value.json())
      if (!parsed.success) {
        return err({ kind: 'schema', message: 'Notion replied in an unrecognised shape.' })
      }
      return ok({
        accountId: parsed.data.id,
        displayName: parsed.data.name ?? 'Notion integration',
      })
    },

    async attachImage(target: TargetRef, blob: Blob, filename: string) {
      const pageId = normalisePageId(target.key)
      if (!pageId) {
        return err({
          kind: 'not-found',
          message: `“${target.key}” is not a Notion page id. Open the page, copy its URL, and use the 32-character id at the end.`,
        })
      }

      // Fail before uploading rather than after: a 400 halfway through a
      // three-step flow is far harder for the user to interpret.
      if (blob.size > MAX_UPLOAD_BYTES) {
        return err({
          kind: 'too-large',
          message: `Notion accepts uploads up to 20 MB; this capture is ${Math.round(blob.size / 1024 / 1024)} MB.`,
        })
      }

      // Step 1 — create the upload.
      const created = await request(
        fetchImpl,
        `${BASE}/file_uploads`,
        { method: 'POST', headers: jsonHeaders, body: JSON.stringify({}) },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!created.ok) return created

      const upload = uploadSchema.safeParse(await created.value.json())
      if (!upload.success) {
        return err({ kind: 'schema', message: 'Notion did not return an upload id.' })
      }
      const uploadId = upload.data.id

      // Step 2 — send the bytes. Content-Type omitted for the boundary.
      const form = new FormData()
      form.append('file', blob, filename)
      const sent = await request(
        fetchImpl,
        `${BASE}/file_uploads/${uploadId}/send`,
        { method: 'POST', headers, body: form },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!sent.ok) return sent

      // Step 3 — attach. Beyond this point the upload has been consumed.
      const attached = await request(
        fetchImpl,
        `${BASE}/blocks/${pageId}/children`,
        {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify({
            children: [
              {
                object: 'block',
                type: 'image',
                image: { type: 'file_upload', file_upload: { id: uploadId } },
              },
            ],
          }),
        },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!attached.ok) {
        // Only claim expiry when Notion actually says so. Mapping EVERY 400 to
        // "expired" sent users chasing a timing problem that was really a
        // malformed request — the failure this check exists to prevent.
        if (attached.error.status === 400) {
          const detail = attached.error.detail ?? ''
          if (/expire/i.test(detail)) {
            return err({
              ...attached.error,
              message:
                'The upload expired before it could be attached. Capture again and send it straight away.',
            })
          }
          return err({
            ...attached.error,
            message: `Notion rejected the request: ${detail.slice(0, 160) || 'no reason given'}`,
          })
        }
        return attached
      }

      return ok({ id: uploadId })
    },
  }
}
