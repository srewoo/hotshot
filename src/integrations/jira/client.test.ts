import { describe, expect, test, vi } from 'vitest'
import { createJiraProvider } from './client'
import { isErr, isOk } from '../../shared/result'

/**
 * PRD FR-14 / §7.1. Verified API details:
 *   - Basic auth over base64(email:apiToken)
 *   - `X-Atlassian-Token: no-check` is REQUIRED or the request is rejected as XSRF
 *   - multipart field name is `file`
 *
 * Tested against a stub fetch rather than the live API: contract tests belong
 * in CI, and a test suite that needs a real Jira instance is a test suite
 * nobody runs.
 */

const config = {
  site: 'acme.atlassian.net',
  email: 'someone@acme.com',
  token: 'jira-token',
}

/** `json` is the decoded body here, not Response's method — hence the Omit. */
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
      json: async () => spec.json ?? {},
      text: async () => JSON.stringify(spec.json ?? {}),
    } as Response
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

describe('testConnection', () => {
  test('reports the authenticated account on success', async () => {
    const { fetch, calls } = stubFetch([
      { json: { accountId: 'a1', displayName: 'Sam Reeve', emailAddress: 'someone@acme.com' } },
    ])
    const provider = createJiraProvider(config, fetch)

    const result = await provider.testConnection()

    expect(isOk(result)).toBe(true)
    expect(isOk(result) && result.value.displayName).toBe('Sam Reeve')
    expect(calls[0]?.url).toBe('https://acme.atlassian.net/rest/api/3/myself')
  })

  test('sends Basic auth built from the email and token', async () => {
    const { fetch, calls } = stubFetch([{ json: { accountId: 'a', displayName: 'x' } }])
    await createJiraProvider(config, fetch).testConnection()

    const auth = (calls[0]?.init.headers as Record<string, string>)['Authorization']
    expect(auth).toBe(`Basic ${btoa('someone@acme.com:jira-token')}`)
  })

  test('maps 401 to a plain-language auth failure', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 401 }])
    const result = await createJiraProvider(config, fetch).testConnection()

    expect(isErr(result)).toBe(true)
    expect(isErr(result) && result.error.kind).toBe('auth')
    expect(isErr(result) && result.error.message).toMatch(/email|token/i)
  })

  test('never echoes the token in an error', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 401 }])
    const result = await createJiraProvider(config, fetch).testConnection()
    expect(isErr(result) && JSON.stringify(result.error)).not.toContain('jira-token')
  })

  test('rejects a response whose shape does not match, rather than trusting it', async () => {
    const { fetch } = stubFetch([{ json: { unexpected: true } }])
    const result = await createJiraProvider(config, fetch).testConnection()
    expect(isErr(result) && result.error.kind).toBe('schema')
  })
})

describe('attachImage', () => {
  const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

  test('posts multipart to the issue attachments endpoint', async () => {
    const { fetch, calls } = stubFetch([{ json: [{ id: '10001', filename: 'shot.png' }] }])
    const provider = createJiraProvider(config, fetch)

    const result = await provider.attachImage({ key: 'ABC-412' }, png, 'shot.png')

    expect(isOk(result)).toBe(true)
    expect(calls[0]?.url).toBe(
      'https://acme.atlassian.net/rest/api/3/issue/ABC-412/attachments',
    )
    expect(calls[0]?.init.method).toBe('POST')
  })

  test('sends the X-Atlassian-Token header, without which Jira rejects the upload', async () => {
    const { fetch, calls } = stubFetch([{ json: [{ id: '1', filename: 'shot.png' }] }])
    await createJiraProvider(config, fetch).attachImage({ key: 'ABC-1' }, png, 'shot.png')

    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['X-Atlassian-Token']).toBe('no-check')
  })

  test('does NOT set Content-Type, so the boundary is generated', async () => {
    // Setting it by hand omits the multipart boundary and the upload fails
    // with an opaque 500.
    const { fetch, calls } = stubFetch([{ json: [{ id: '1', filename: 'a.png' }] }])
    await createJiraProvider(config, fetch).attachImage({ key: 'ABC-1' }, png, 'a.png')

    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
  })

  test('uses the field name `file`', async () => {
    const { fetch, calls } = stubFetch([{ json: [{ id: '1', filename: 'a.png' }] }])
    await createJiraProvider(config, fetch).attachImage({ key: 'ABC-1' }, png, 'a.png')

    const body = calls[0]?.init.body as FormData
    expect(body.get('file')).toBeInstanceOf(Blob)
  })

  test('maps 403 to the attach-permission explanation', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 403 }])
    const result = await createJiraProvider(config, fetch).attachImage({ key: 'A-1' }, png, 'a.png')
    expect(isErr(result) && result.error.kind).toBe('forbidden')
    expect(isErr(result) && result.error.message).toMatch(/permission|attachment/i)
  })

  test('maps 404 to a missing-issue explanation naming the key', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 404 }])
    const result = await createJiraProvider(config, fetch).attachImage(
      { key: 'GONE-9' },
      png,
      'a.png',
    )
    expect(isErr(result) && result.error.message).toContain('GONE-9')
  })

  test('maps 413 to a size explanation rather than a raw status', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 413 }])
    const result = await createJiraProvider(config, fetch).attachImage({ key: 'A-1' }, png, 'a.png')
    expect(isErr(result) && result.error.kind).toBe('too-large')
  })

  test('surfaces Retry-After on 429', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 429 }])
    const result = await createJiraProvider(config, fetch).attachImage({ key: 'A-1' }, png, 'a.png')
    expect(isErr(result) && result.error.kind).toBe('rate-limited')
  })

  test('reports a network failure without throwing', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof globalThis.fetch

    const result = await createJiraProvider(config, fetch).attachImage({ key: 'A-1' }, png, 'a.png')
    expect(isErr(result) && result.error.kind).toBe('network')
  })
})
