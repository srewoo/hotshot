import { z } from 'zod'
import { err, ok, type Result } from '../../shared/result'
import type { Identity, IntegrationProvider, ProviderError, TargetRef } from '../provider'
import { request } from '../http'

/**
 * ClickUp connector (PRD FR-16, §7.3).
 *
 * Two details that differ from every other connector here:
 *   - A PERSONAL token is sent bare, with no `Bearer` prefix. Only the OAuth
 *     flow uses `Bearer`, and getting this wrong yields a confusing 401.
 *   - The multipart field is `attachment`, not `file`.
 *
 * The token is unscoped and carries full account permissions, same caveat as
 * Jira (R-4), so it never reaches a log or an error message.
 */

const BASE = 'https://api.clickup.com/api/v2'

export interface ClickUpConfig {
  readonly token: string
}

const identitySchema = z.object({
  user: z.object({
    id: z.union([z.number(), z.string()]),
    username: z.string().min(1),
  }),
})

const attachmentSchema = z.object({ id: z.string().min(1) })

const NETWORK_MESSAGE = 'Could not reach ClickUp. Check your connection and try again.'

function messageFor(taskKey?: string): (status: number) => string {
  return (status) => {
    switch (status) {
      case 401:
        return 'ClickUp rejected the token. Check the personal API token in Settings.'
      case 403:
        return 'This ClickUp token cannot add attachments to that task.'
      case 404:
        return taskKey
          ? `ClickUp has no task ${taskKey} visible to this token. Check the task ID.`
          : 'ClickUp could not find that item.'
      case 413:
        return 'ClickUp rejected the image as too large.'
      case 429:
        return 'ClickUp is rate-limiting this token. Wait a moment and retry.'
      default:
        return `ClickUp returned an unexpected status ${status}.`
    }
  }
}

export function createClickUpProvider(
  config: ClickUpConfig,
  fetchImpl: typeof globalThis.fetch,
): IntegrationProvider {
  // No `Bearer` — a personal token is sent exactly as issued.
  const headers = { Authorization: config.token, Accept: 'application/json' }

  return {
    async testConnection(): Promise<Result<Identity, ProviderError>> {
      const response = await request(
        fetchImpl,
        `${BASE}/user`,
        { headers },
        messageFor(),
        NETWORK_MESSAGE,
      )
      if (!response.ok) return response

      const parsed = identitySchema.safeParse(await response.value.json())
      if (!parsed.success) {
        return err({
          kind: 'schema',
          message: 'ClickUp replied in a shape Hotshot does not recognise.',
        })
      }
      return ok({
        accountId: String(parsed.data.user.id),
        displayName: parsed.data.user.username,
      })
    },

    async attachImage(target: TargetRef, blob: Blob, filename: string) {
      const form = new FormData()
      form.append('attachment', blob, filename)

      const response = await request(
        fetchImpl,
        `${BASE}/task/${target.key}/attachment`,
        {
          method: 'POST',
          // Content-Type omitted so fetch generates the multipart boundary.
          headers,
          body: form,
        },
        messageFor(target.key),
        NETWORK_MESSAGE,
      )
      if (!response.ok) return response

      const parsed = attachmentSchema.safeParse(await response.value.json())
      if (!parsed.success) {
        return err({
          kind: 'schema',
          message: 'ClickUp accepted the upload but replied in an unrecognised shape.',
        })
      }
      return ok({ id: parsed.data.id })
    },
  }
}
