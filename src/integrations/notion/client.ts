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

export interface NotionConfig {
  readonly token: string
}

const identitySchema = z.object({ id: z.string().min(1), name: z.string().nullable() })
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
        `${BASE}/blocks/${target.key}/children`,
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
        // An expired upload cannot be retried as-is; saying so saves the user
        // from a retry loop that can never succeed.
        if (attached.error.status === 400) {
          return err({
            ...attached.error,
            message:
              'The upload expired before it could be attached. Capture again and send it straight away.',
          })
        }
        return attached
      }

      return ok({ id: uploadId })
    },
  }
}
