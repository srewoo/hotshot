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
 * Asana connector (PRD §10 v2 destinations).
 *
 * A personal access token, sent as a Bearer credential. The attachment
 * endpoint is a plain multipart POST with the task gid as `parent`, which
 * makes this the most conventional of the connectors here.
 *
 * Every Asana reply wraps its payload in `data`, including the errors.
 *
 * VERIFY: written from Asana's published REST shape, not against a live
 * workspace.
 */

const BASE = 'https://app.asana.com/api/1.0'

export interface AsanaConfig {
  readonly token: string
}

const NETWORK_MESSAGE = 'Could not reach Asana. Check your connection and try again.'

function messageFor(status: number): string {
  switch (status) {
    case 401:
      return 'Asana rejected the token. Check the personal access token in Settings.'
    case 403:
      return 'This Asana token cannot attach to that task.'
    case 404:
      return 'Asana has no such task visible to this token.'
    case 413:
      return 'Asana rejected the image as too large.'
    case 429:
      return 'Asana is rate-limiting this token. Wait a moment and retry.'
    default:
      return `Asana returned an unexpected status ${status}.`
  }
}

const userSchema = z.object({
  data: z.object({
    gid: z.string(),
    name: z.string().optional(),
    workspaces: z.array(z.object({ gid: z.string(), name: z.string().optional() })).optional(),
  }),
})

const tasksSchema = z.object({
  data: z.array(
    z.object({
      gid: z.string(),
      name: z.string().optional(),
      completed: z.boolean().optional(),
    }),
  ),
})

const attachmentSchema = z.object({ data: z.object({ gid: z.string() }) })

export function createAsanaProvider(
  config: AsanaConfig,
  fetchImpl: typeof globalThis.fetch,
): IntegrationProvider {
  const headers = { Authorization: `Bearer ${config.token}`, Accept: 'application/json' }

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

      const parsed = userSchema.safeParse(await response.value.json())
      if (!parsed.success) {
        return err({ kind: 'schema', message: 'Asana replied in an unrecognised shape.' })
      }
      return ok({
        accountId: parsed.data.data.gid,
        displayName: parsed.data.data.name ?? 'Asana',
      })
    },

    async searchTargets(query: string) {
      // Asana's task list is scoped to a workspace, so the first call is what
      // makes the second possible — the same discovery chain ClickUp needs.
      const me = await request(
        fetchImpl,
        `${BASE}/users/me`,
        { headers },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!me.ok) return me

      const identity = userSchema.safeParse(await me.value.json())
      if (!identity.success) {
        return err({ kind: 'schema', message: 'Asana replied in an unrecognised shape.' })
      }
      const workspace = identity.data.data.workspaces?.[0]
      if (!workspace) {
        return err({
          kind: 'not-found',
          message: 'This Asana token belongs to no workspace, so there are no tasks to list.',
        })
      }

      const response = await request(
        fetchImpl,
        `${BASE}/tasks?assignee=me&workspace=${workspace.gid}&completed_since=now&opt_fields=name,completed&limit=50`,
        { headers },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!response.ok) return response

      const parsed = tasksSchema.safeParse(await response.value.json())
      if (!parsed.success) {
        return err({ kind: 'schema', message: 'Asana replied with an unrecognised task list.' })
      }

      const needle = query.trim().toLowerCase()
      const candidates: TargetCandidate[] = parsed.data.data
        .filter((task) => !needle || (task.name ?? '').toLowerCase().includes(needle))
        .slice(0, 20)
        .map((task) => ({
          key: task.gid,
          title: task.name ?? task.gid,
          hint: workspace.name ?? task.gid,
        }))
      return ok(candidates)
    },

    async attachImage(target: TargetRef, blob: Blob, filename: string) {
      const form = new FormData()
      form.append('parent', target.key)
      form.append('file', blob, filename)

      const response = await request(
        fetchImpl,
        `${BASE}/attachments`,
        {
          method: 'POST',
          // Only the Authorization header: fetch must generate the multipart
          // boundary itself.
          headers: { Authorization: headers.Authorization },
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
          message: 'Asana accepted the upload but replied in an unrecognised shape.',
        })
      }
      return ok({ id: parsed.data.data.gid })
    },
  }
}
