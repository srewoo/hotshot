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
 * Slack connector (PRD §10 v2 destinations).
 *
 * The upload is three calls, not one, and that is not a choice: `files.upload`
 * was deprecated and stops working, so the supported path is
 * `files.getUploadURLExternal` → POST the bytes to the URL it returns →
 * `files.completeUploadExternal` with the channel. Getting this wrong yields a
 * 200 with `ok: false`, which is the other thing worth knowing about Slack:
 *
 * A Slack API error is an HTTP 200 with `{ ok: false, error: "..." }`. Every
 * response has to be inspected rather than trusted, or a failed upload looks
 * like a successful one.
 *
 * VERIFY: written from Slack's published API shape, not against a live
 * workspace. The three-step upload and the `ok: false` convention are
 * documented; the exact error strings are not exhaustively pinned here.
 */

const BASE = 'https://slack.com/api'

export interface SlackConfig {
  /** A bot or user token, `xoxb-`/`xoxp-`. Sent as a Bearer credential. */
  readonly token: string
}

const NETWORK_MESSAGE = 'Could not reach Slack. Check your connection and try again.'

/** Slack's own error strings, mapped to something a person can act on. */
function slackMessage(error: string): string {
  switch (error) {
    case 'invalid_auth':
    case 'not_authed':
    case 'token_revoked':
      return 'Slack rejected the token. Check it in Settings.'
    case 'missing_scope':
      return 'This Slack token lacks the files:write scope, so it cannot upload.'
    case 'channel_not_found':
      return 'Slack has no such channel visible to this token. Invite the app to the channel.'
    case 'not_in_channel':
      return 'The Slack app is not a member of that channel. Invite it, then try again.'
    case 'file_too_large':
      return 'Slack rejected the image as too large.'
    case 'ratelimited':
      return 'Slack is rate-limiting this token. Wait a moment and retry.'
    default:
      return `Slack refused the request: ${error}.`
  }
}

function messageFor(status: number): string {
  switch (status) {
    case 401:
      return 'Slack rejected the token. Check it in Settings.'
    case 403:
      return 'This Slack token is not allowed to do that.'
    case 413:
      return 'Slack rejected the image as too large.'
    case 429:
      return 'Slack is rate-limiting this token. Wait a moment and retry.'
    default:
      return `Slack returned an unexpected status ${status}.`
  }
}

/** Every Slack reply carries `ok`; an error is a 200 with `ok: false`. */
const envelope = z.object({ ok: z.boolean(), error: z.string().optional() })

const identitySchema = envelope.extend({
  user_id: z.string().optional(),
  user: z.string().optional(),
  team: z.string().optional(),
})

const uploadUrlSchema = envelope.extend({
  upload_url: z.string().optional(),
  file_id: z.string().optional(),
})

const conversationsSchema = envelope.extend({
  channels: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        is_private: z.boolean().optional(),
      }),
    )
    .optional(),
})

export function createSlackProvider(
  config: SlackConfig,
  fetchImpl: typeof globalThis.fetch,
): IntegrationProvider {
  const headers = { Authorization: `Bearer ${config.token}` }

  /** Reads a Slack reply, turning `ok: false` into a real error. */
  async function readEnvelope<T extends z.ZodType>(
    response: Response,
    schema: T,
  ): Promise<Result<z.infer<T>, ProviderError>> {
    const parsed = schema.safeParse(await response.json())
    if (!parsed.success) {
      return err({ kind: 'schema', message: 'Slack replied in an unrecognised shape.' })
    }
    const body = parsed.data as z.infer<typeof envelope>
    if (!body.ok) {
      const reason = body.error ?? 'unknown_error'
      return err({
        kind: reason.includes('auth') || reason.includes('token') ? 'auth' : 'unknown',
        message: slackMessage(reason),
        detail: reason,
      })
    }
    return ok(parsed.data)
  }

  return {
    async testConnection(): Promise<Result<Identity, ProviderError>> {
      const response = await request(
        fetchImpl,
        `${BASE}/auth.test`,
        { method: 'POST', headers },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!response.ok) return response

      const body = await readEnvelope(response.value, identitySchema)
      if (!body.ok) return body
      return ok({
        accountId: body.value.user_id ?? 'unknown',
        displayName: body.value.user ?? body.value.team ?? 'Slack',
      })
    },

    async searchTargets(query: string) {
      const response = await request(
        fetchImpl,
        `${BASE}/conversations.list?limit=200&exclude_archived=true&types=public_channel,private_channel`,
        { headers },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!response.ok) return response

      const body = await readEnvelope(response.value, conversationsSchema)
      if (!body.ok) return body

      // Filtered locally: `conversations.list` has no query parameter, and
      // pretending otherwise would silently return the first page instead.
      const needle = query.trim().toLowerCase()
      const candidates: TargetCandidate[] = (body.value.channels ?? [])
        .filter((channel) => !needle || (channel.name ?? '').toLowerCase().includes(needle))
        .slice(0, 20)
        .map((channel) => ({
          key: channel.id,
          title: `#${channel.name ?? channel.id}`,
          hint: channel.is_private ? 'private' : 'public',
        }))
      return ok(candidates)
    },

    async attachImage(target: TargetRef, blob: Blob, filename: string) {
      // 1. Ask for an upload URL. `files.upload` is deprecated and removed.
      const ticket = await request(
        fetchImpl,
        `${BASE}/files.getUploadURLExternal?filename=${encodeURIComponent(filename)}&length=${blob.size}`,
        { method: 'POST', headers },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!ticket.ok) return ticket

      const issued = await readEnvelope(ticket.value, uploadUrlSchema)
      if (!issued.ok) return issued
      const { upload_url: uploadUrl, file_id: fileId } = issued.value
      if (!uploadUrl || !fileId) {
        return err({
          kind: 'schema',
          message: 'Slack issued an upload without a URL, which Hotshot cannot use.',
        })
      }

      // 2. POST the bytes to the issued URL. No auth header here — the URL is
      // the credential, and sending the token would leak it to Slack's CDN.
      const form = new FormData()
      form.append('file', blob, filename)
      const upload = await request(
        fetchImpl,
        uploadUrl,
        { method: 'POST', body: form },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!upload.ok) return upload

      // 3. Complete, which is what actually posts it into the channel.
      const complete = await request(
        fetchImpl,
        `${BASE}/files.completeUploadExternal`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({
            files: [{ id: fileId, title: filename }],
            channel_id: target.key,
          }),
        },
        messageFor,
        NETWORK_MESSAGE,
      )
      if (!complete.ok) return complete

      const finished = await readEnvelope(complete.value, envelope)
      if (!finished.ok) return finished
      return ok({ id: fileId })
    },
  }
}
