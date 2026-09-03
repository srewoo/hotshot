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
 * Jira Cloud connector (PRD FR-14, §7.1).
 *
 * Three details are load-bearing and each has a test:
 *   - `X-Atlassian-Token: no-check` is REQUIRED; without it Jira rejects the
 *     upload as XSRF.
 *   - The multipart field is named `file`.
 *   - `Content-Type` must NOT be set by hand, or the boundary is missing and
 *     the upload fails with an opaque error.
 *
 * The API token is unscoped and carries full account permissions (R-4), so it
 * never appears in a log line, an error, or a thrown message.
 */

export interface JiraConfig {
  readonly site: string
  readonly email: string
  readonly token: string
}

const identitySchema = z.object({
  accountId: z.string().min(1),
  displayName: z.string().min(1),
})

const attachmentSchema = z
  .array(z.object({ id: z.string().min(1), filename: z.string() }))
  .nonempty()

/**
 * Jira's own type-ahead endpoint (FR-41).
 *
 * `/issue/picker` is exactly this feature server-side: with no query it
 * returns recently-viewed issues, and with one it searches keys and summaries.
 * Using it rather than a JQL search means Jira decides what "recent" means,
 * which it knows and Hotshot does not.
 *
 * The sections are permissive on purpose — Jira varies the set by deployment,
 * and an unexpected extra section must degrade to fewer suggestions rather
 * than to a schema error over a feature that is only a convenience.
 */
const pickerSchema = z.object({
  sections: z
    .array(
      z.object({
        issues: z
          .array(
            z.object({
              key: z.string().min(1),
              summaryText: z.string().optional(),
              summary: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
})

function authHeader(config: JiraConfig): string {
  return `Basic ${btoa(`${config.email}:${config.token}`)}`
}

export function createJiraProvider(
  config: JiraConfig,
  fetchImpl: typeof globalThis.fetch,
): IntegrationProvider {
  const base = `https://${config.site}/rest/api/3`

  const messageFor =
    (issueKey?: string) =>
    (status: number): string => {
      switch (status) {
        case 401:
          return 'Jira rejected the credentials. Check the account email and API token in Settings.'
        case 403:
          return 'Your Jira account cannot add attachments here — either the project denies it, or attachments are disabled site-wide.'
        case 404:
          return issueKey
            ? `Jira has no issue ${issueKey} visible to this account. Check the key and that you can open it in the browser.`
            : 'Jira could not find that item.'
        case 413:
          return 'The image is larger than this Jira site allows for attachments.'
        case 429:
          return 'Jira is rate-limiting this account. Wait a moment and retry.'
        default:
          return `Jira returned an unexpected status ${status}.`
      }
    }

  const NETWORK_MESSAGE = 'Could not reach Jira. Check your connection and try again.'

  return {
    async testConnection(): Promise<Result<Identity, ProviderError>> {
      const response = await request(
        fetchImpl,
        `${base}/myself`,
        { headers: { Authorization: authHeader(config), Accept: 'application/json' } },
        messageFor(),
        NETWORK_MESSAGE,
      )
      if (!response.ok) return response

      const parsed = identitySchema.safeParse(await response.value.json())
      if (!parsed.success) {
        return err({
          kind: 'schema',
          message: 'Jira replied in a shape Hotshot does not recognise. This usually means the API changed.',
        })
      }
      return ok(parsed.data)
    },

    async searchTargets(query: string) {
      const url = `${base}/issue/picker?currentJQL=${encodeURIComponent('order by updated desc')}${
        query.trim() ? `&query=${encodeURIComponent(query.trim())}` : ''
      }`
      const response = await request(
        fetchImpl,
        url,
        { headers: { Authorization: authHeader(config), Accept: 'application/json' } },
        messageFor(),
        NETWORK_MESSAGE,
      )
      if (!response.ok) return response

      const parsed = pickerSchema.safeParse(await response.value.json())
      if (!parsed.success) {
        return err({
          kind: 'schema',
          message: 'Jira replied to the issue search in an unrecognised shape.',
        })
      }

      const seen = new Set<string>()
      const candidates: TargetCandidate[] = []
      for (const section of parsed.data.sections ?? []) {
        for (const issue of section.issues ?? []) {
          // Sections overlap — "recent" and "matching" both list the same
          // issue — and a picker that shows a key twice looks broken.
          if (seen.has(issue.key)) continue
          seen.add(issue.key)
          candidates.push({
            key: issue.key,
            title: issue.summaryText ?? issue.summary ?? issue.key,
            hint: issue.key,
          })
        }
      }
      return ok(candidates)
    },

    async attachImage(target: TargetRef, blob: Blob, filename: string) {
      const form = new FormData()
      form.append('file', blob, filename)

      const response = await request(
        fetchImpl,
        `${base}/issue/${target.key}/attachments`,
        {
          method: 'POST',
          headers: {
            Authorization: authHeader(config),
            // Required. Without it Jira rejects the upload as XSRF.
            'X-Atlassian-Token': 'no-check',
            Accept: 'application/json',
            // Content-Type is deliberately absent: fetch must generate the
            // multipart boundary itself.
          },
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
          message: 'Jira accepted the upload but replied in an unrecognised shape.',
        })
      }
      return ok({ id: parsed.data[0].id })
    },
  }
}
