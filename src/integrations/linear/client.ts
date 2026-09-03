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
 * Linear connector (PRD §10 v2 destinations).
 *
 * Two things differ from every other connector here:
 *   - It is GraphQL. One endpoint, and the operation is in the body.
 *   - A personal API key is sent BARE, with no `Bearer` prefix. Only OAuth
 *     access tokens take `Bearer`, and getting it wrong yields an
 *     authentication error that says nothing about the cause — the same trap
 *     ClickUp sets.
 *
 * The upload is two steps: `fileUpload` returns a pre-signed PUT, then the
 * returned asset URL is attached to the issue. Linear has no multipart
 * attachment endpoint.
 *
 * VERIFY: written from Linear's published GraphQL schema, not against a live
 * workspace.
 */

const ENDPOINT = 'https://api.linear.app/graphql'

export interface LinearConfig {
  readonly token: string
}

const NETWORK_MESSAGE = 'Could not reach Linear. Check your connection and try again.'

function messageFor(status: number): string {
  switch (status) {
    case 400:
      return 'Linear rejected the request. This usually means the API changed.'
    case 401:
      return 'Linear rejected the key. Check the personal API key in Settings.'
    case 403:
      return 'This Linear key cannot do that.'
    case 413:
      return 'Linear rejected the image as too large.'
    case 429:
      return 'Linear is rate-limiting this key. Wait a moment and retry.'
    default:
      return `Linear returned an unexpected status ${status}.`
  }
}

/** A GraphQL 200 can still carry errors, so every reply is inspected. */
const graphql = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
})

const viewerSchema = z.object({
  viewer: z.object({ id: z.string(), name: z.string().optional() }),
})

const issuesSchema = z.object({
  issues: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        identifier: z.string().optional(),
        title: z.string().optional(),
        state: z.object({ name: z.string().optional() }).nullish(),
      }),
    ),
  }),
})

const uploadSchema = z.object({
  fileUpload: z.object({
    success: z.boolean(),
    uploadFile: z
      .object({
        uploadUrl: z.string(),
        assetUrl: z.string(),
        headers: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
      })
      .nullish(),
  }),
})

export function createLinearProvider(
  config: LinearConfig,
  fetchImpl: typeof globalThis.fetch,
): IntegrationProvider {
  // No `Bearer` — a personal API key is sent exactly as issued.
  const headers = { Authorization: config.token, 'Content-Type': 'application/json' }

  async function query<T extends z.ZodType>(
    body: { query: string; variables?: Record<string, unknown> },
    schema: T,
  ): Promise<Result<z.infer<T>, ProviderError>> {
    const response = await request(
      fetchImpl,
      ENDPOINT,
      { method: 'POST', headers, body: JSON.stringify(body) },
      messageFor,
      NETWORK_MESSAGE,
    )
    if (!response.ok) return response

    const envelope = graphql.safeParse(await response.value.json())
    if (!envelope.success) {
      return err({ kind: 'schema', message: 'Linear replied in an unrecognised shape.' })
    }
    // A GraphQL error arrives as a 200. Treating it as success is how a failed
    // attach looks like a successful one.
    if (envelope.data.errors?.length) {
      const first = envelope.data.errors[0]?.message ?? 'unknown error'
      return err({ kind: 'unknown', message: `Linear refused the request: ${first}`, detail: first })
    }

    const parsed = schema.safeParse(envelope.data.data)
    if (!parsed.success) {
      return err({ kind: 'schema', message: 'Linear replied with unexpected data.' })
    }
    return ok(parsed.data)
  }

  return {
    async testConnection(): Promise<Result<Identity, ProviderError>> {
      const result = await query({ query: '{ viewer { id name } }' }, viewerSchema)
      if (!result.ok) return result
      return ok({
        accountId: result.value.viewer.id,
        displayName: result.value.viewer.name ?? 'Linear',
      })
    },

    async searchTargets(searchQuery: string) {
      const needle = searchQuery.trim()
      const result = await query(
        {
          // With no search term this is "assigned to me, recently updated",
          // which is the same "what would I most likely want" answer Jira's
          // picker gives (FR-41).
          query: `query Targets($filter: IssueFilter) {
            issues(first: 20, filter: $filter, orderBy: updatedAt) {
              nodes { id identifier title state { name } }
            }
          }`,
          variables: {
            filter: needle
              ? { title: { containsIgnoreCase: needle } }
              : { assignee: { isMe: { eq: true } } },
          },
        },
        issuesSchema,
      )
      if (!result.ok) return result

      const candidates: TargetCandidate[] = result.value.issues.nodes.map((issue) => ({
        // The identifier is what a human types; the id is what the API takes.
        key: issue.id,
        title: issue.title ?? issue.identifier ?? issue.id,
        hint: [issue.identifier, issue.state?.name].filter(Boolean).join(' · '),
      }))
      return ok(candidates)
    },

    async attachImage(target: TargetRef, blob: Blob, filename: string) {
      // 1. Ask for a pre-signed PUT.
      const ticket = await query(
        {
          query: `mutation Upload($contentType: String!, $filename: String!, $size: Int!) {
            fileUpload(contentType: $contentType, filename: $filename, size: $size) {
              success
              uploadFile { uploadUrl assetUrl headers { key value } }
            }
          }`,
          variables: { contentType: blob.type || 'image/png', filename, size: blob.size },
        },
        uploadSchema,
      )
      if (!ticket.ok) return ticket

      const file = ticket.value.fileUpload.uploadFile
      if (!ticket.value.fileUpload.success || !file) {
        return err({ kind: 'unknown', message: 'Linear would not issue an upload for that file.' })
      }

      // 2. PUT the bytes. Linear's own headers must be echoed exactly, and the
      // API key must NOT be sent — the signed URL is the credential.
      const uploadHeaders: Record<string, string> = { 'Content-Type': blob.type || 'image/png' }
      for (const header of file.headers ?? []) uploadHeaders[header.key] = header.value

      const upload = await request(
        fetchImpl,
        file.uploadUrl,
        { method: 'PUT', headers: uploadHeaders, body: blob },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!upload.ok) return upload

      // 3. Attach the asset to the issue.
      const attached = await query(
        {
          query: `mutation Attach($issueId: String!, $url: String!, $title: String!) {
            attachmentCreate(input: { issueId: $issueId, url: $url, title: $title }) {
              success
              attachment { id }
            }
          }`,
          variables: { issueId: target.key, url: file.assetUrl, title: filename },
        },
        z.object({
          attachmentCreate: z.object({
            success: z.boolean(),
            attachment: z.object({ id: z.string() }).nullish(),
          }),
        }),
      )
      if (!attached.ok) return attached
      if (!attached.value.attachmentCreate.success) {
        return err({ kind: 'unknown', message: 'Linear accepted the upload but not the attachment.' })
      }
      return ok({ id: attached.value.attachmentCreate.attachment?.id ?? file.assetUrl })
    },
  }
}
