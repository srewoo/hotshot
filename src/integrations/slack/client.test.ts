import { describe, expect, test, vi } from 'vitest'
import { createSlackProvider } from './client'
import { isErr, isOk } from '../../shared/result'

/**
 * Slack's two traps, both tested:
 *   - An API error is an HTTP 200 with `{ ok: false }`. Trusting the status
 *     makes a failed upload look like a successful one.
 *   - `files.upload` is deprecated; the supported path is three calls.
 *
 * Against a stub fetch: a suite that needs a live workspace is a suite nobody
 * runs.
 */

type StubResponse = Omit<Partial<Response>, 'json' | 'text'> & { json?: unknown }

function stubFetch(responses: StubResponse[]) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  let index = 0
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const spec = responses[Math.min(index++, responses.length - 1)] ?? {}
    return {
      ok: spec.ok ?? true,
      status: spec.status ?? 200,
      json: async () => spec.json ?? { ok: true },
      text: async () => JSON.stringify(spec.json ?? { ok: true }),
    } as Response
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

const config = { token: 'xoxb-SECRET-TOKEN' }
const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

describe('testConnection', () => {
  test('reports the authenticated account', async () => {
    const { fetch } = stubFetch([{ json: { ok: true, user_id: 'U1', user: 'sam' } }])
    const result = await createSlackProvider(config, fetch).testConnection()
    expect(isOk(result) && result.value).toEqual({ accountId: 'U1', displayName: 'sam' })
  })

  test('sends the token as a Bearer credential', async () => {
    const { fetch, calls } = stubFetch([{ json: { ok: true, user_id: 'U1' } }])
    await createSlackProvider(config, fetch).testConnection()
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${config.token}`,
    )
  })

  /**
   * The load-bearing one. Slack answers 200 and puts the failure in the body,
   * so a connector that checks only the status reports success on a dead token.
   */
  test('treats a 200 with ok:false as a failure', async () => {
    const { fetch } = stubFetch([{ ok: true, status: 200, json: { ok: false, error: 'invalid_auth' } }])
    const result = await createSlackProvider(config, fetch).testConnection()
    expect(isErr(result)).toBe(true)
    expect(isErr(result) && result.error.kind).toBe('auth')
    expect(isErr(result) && result.error.message).toContain('rejected the token')
  })

  test('translates a missing scope into something actionable', async () => {
    const { fetch } = stubFetch([{ json: { ok: false, error: 'missing_scope' } }])
    const result = await createSlackProvider(config, fetch).testConnection()
    expect(isErr(result) && result.error.message).toContain('files:write')
  })

  test('never leaks the token into an error', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 500 }])
    const result = await createSlackProvider(config, fetch).testConnection()
    expect(JSON.stringify(isErr(result) && result.error)).not.toContain(config.token)
  })
})

describe('searchTargets', () => {
  const channels = {
    ok: true,
    channels: [
      { id: 'C1', name: 'bugs', is_private: false },
      { id: 'C2', name: 'design-review', is_private: true },
    ],
  }

  test('lists channels with a readable title', async () => {
    const { fetch } = stubFetch([{ json: channels }])
    const result = await createSlackProvider(config, fetch).searchTargets('')
    expect(isOk(result) && result.value).toEqual([
      { key: 'C1', title: '#bugs', hint: 'public' },
      { key: 'C2', title: '#design-review', hint: 'private' },
    ])
  })

  test('filters locally, because conversations.list has no query', async () => {
    const { fetch } = stubFetch([{ json: channels }])
    const result = await createSlackProvider(config, fetch).searchTargets('design')
    expect(isOk(result) && result.value).toHaveLength(1)
  })

  test('reports an ok:false rather than an empty list', async () => {
    const { fetch } = stubFetch([{ json: { ok: false, error: 'ratelimited' } }])
    const result = await createSlackProvider(config, fetch).searchTargets('')
    expect(isErr(result) && result.error.message).toContain('rate-limiting')
  })
})

describe('attachImage', () => {
  const ticket = { ok: true, upload_url: 'https://files.slack.com/upload/abc', file_id: 'F1' }

  test('uses the three-call external upload, not the removed files.upload', async () => {
    const { fetch, calls } = stubFetch([{ json: ticket }, { json: {} }, { json: { ok: true } }])
    const result = await createSlackProvider(config, fetch).attachImage(
      { key: 'C1' },
      png,
      'shot.png',
    )

    expect(isOk(result) && result.value.id).toBe('F1')
    expect(calls).toHaveLength(3)
    expect(calls[0]?.url).toContain('files.getUploadURLExternal')
    expect(calls[1]?.url).toBe('https://files.slack.com/upload/abc')
    expect(calls[2]?.url).toContain('files.completeUploadExternal')
    // Nothing may reach the deprecated endpoint.
    expect(calls.every((call) => !call.url.includes('files.upload'))).toBe(true)
  })

  test('declares the filename and length when asking for a URL', async () => {
    const { fetch, calls } = stubFetch([{ json: ticket }, { json: {} }, { json: { ok: true } }])
    await createSlackProvider(config, fetch).attachImage({ key: 'C1' }, png, 'shot.png')
    expect(calls[0]?.url).toContain('filename=shot.png')
    expect(calls[0]?.url).toContain(`length=${png.size}`)
  })

  /**
   * The upload URL is itself the credential. Sending the workspace token to
   * Slack's CDN would hand it to a host that has no business seeing it.
   */
  test('does NOT send the token to the upload URL', async () => {
    const { fetch, calls } = stubFetch([{ json: ticket }, { json: {} }, { json: { ok: true } }])
    await createSlackProvider(config, fetch).attachImage({ key: 'C1' }, png, 'shot.png')
    expect(calls[1]?.init.headers).toBeUndefined()
  })

  test('posts the file into the requested channel', async () => {
    const { fetch, calls } = stubFetch([{ json: ticket }, { json: {} }, { json: { ok: true } }])
    await createSlackProvider(config, fetch).attachImage({ key: 'C9' }, png, 'shot.png')
    expect(JSON.parse(String(calls[2]?.init.body))).toMatchObject({ channel_id: 'C9' })
  })

  test('explains a channel the app was never invited to', async () => {
    const { fetch } = stubFetch([
      { json: ticket },
      { json: {} },
      { json: { ok: false, error: 'not_in_channel' } },
    ])
    const result = await createSlackProvider(config, fetch).attachImage(
      { key: 'C1' },
      png,
      'shot.png',
    )
    expect(isErr(result) && result.error.message).toContain('Invite it')
  })

  test('refuses an upload ticket with no URL rather than guessing one', async () => {
    const { fetch } = stubFetch([{ json: { ok: true, file_id: 'F1' } }])
    const result = await createSlackProvider(config, fetch).attachImage(
      { key: 'C1' },
      png,
      'shot.png',
    )
    expect(isErr(result) && result.error.kind).toBe('schema')
  })
})
