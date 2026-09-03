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

/**
 * FR-41. Jira ships this feature server-side as `/issue/picker`, so the test
 * is about using it correctly — and about the parts of the reply that vary by
 * deployment not becoming a schema error over a convenience.
 */
describe('searchTargets', () => {
  const picker = {
    sections: [
      {
        id: 'cs',
        issues: [
          { key: 'ABC-1', summaryText: 'Login fails on Safari' },
          { key: 'ABC-2', summaryText: 'Invoice table overflows' },
        ],
      },
      { id: 'hs', issues: [{ key: 'ABC-9', summaryText: 'History match' }] },
    ],
  }

  test('returns candidates with a human title', async () => {
    const { fetch } = stubFetch([{ json: picker }])
    const result = await createJiraProvider(config, fetch).searchTargets('login')
    expect(isOk(result) && result.value).toEqual([
      { key: 'ABC-1', title: 'Login fails on Safari', hint: 'ABC-1' },
      { key: 'ABC-2', title: 'Invoice table overflows', hint: 'ABC-2' },
      { key: 'ABC-9', title: 'History match', hint: 'ABC-9' },
    ])
  })

  test('sends the query to the picker endpoint', async () => {
    const { fetch, calls } = stubFetch([{ json: picker }])
    await createJiraProvider(config, fetch).searchTargets('inv oice')
    expect(calls[0]?.url).toContain('/issue/picker')
    expect(calls[0]?.url).toContain('query=inv%20oice')
  })

  /**
   * An empty query is "what would I most likely want": Jira answers with
   * recently-viewed issues, which is why no `query` parameter is sent at all
   * rather than an empty one.
   */
  test('omits the query entirely when nothing was typed', async () => {
    const { fetch, calls } = stubFetch([{ json: picker }])
    await createJiraProvider(config, fetch).searchTargets('   ')
    expect(calls[0]?.url).not.toContain('query=')
    expect(calls[0]?.url).toContain('currentJQL=')
  })

  test('authenticates the same way as every other call', async () => {
    const { fetch, calls } = stubFetch([{ json: picker }])
    await createJiraProvider(config, fetch).searchTargets('x')
    const auth = (calls[0]?.init.headers as Record<string, string>).Authorization
    expect(auth).toBe(`Basic ${btoa(`${config.email}:${config.token}`)}`)
  })

  /** Jira lists the same issue in "current search" and "history" sections. */
  test('deduplicates an issue that appears in two sections', async () => {
    const { fetch } = stubFetch([
      {
        json: {
          sections: [
            { issues: [{ key: 'ABC-1', summaryText: 'Once' }] },
            { issues: [{ key: 'ABC-1', summaryText: 'Twice' }] },
          ],
        },
      },
    ])
    const result = await createJiraProvider(config, fetch).searchTargets('')
    expect(isOk(result) && result.value).toHaveLength(1)
  })

  test('accepts a reply with no sections as simply no suggestions', async () => {
    const { fetch } = stubFetch([{ json: {} }])
    const result = await createJiraProvider(config, fetch).searchTargets('nope')
    expect(isOk(result) && result.value).toEqual([])
  })

  test('tolerates a section with no issues array', async () => {
    const { fetch } = stubFetch([{ json: { sections: [{ id: 'empty' }] } }])
    const result = await createJiraProvider(config, fetch).searchTargets('')
    expect(isOk(result) && result.value).toEqual([])
  })

  test('falls back to the key when a suggestion has no summary', async () => {
    const { fetch } = stubFetch([{ json: { sections: [{ issues: [{ key: 'ABC-7' }] }] } }])
    const result = await createJiraProvider(config, fetch).searchTargets('')
    expect(isOk(result) && result.value[0]).toEqual({
      key: 'ABC-7',
      title: 'ABC-7',
      hint: 'ABC-7',
    })
  })

  test('reports a rejected token in the same plain language as the rest', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 401 }])
    const result = await createJiraProvider(config, fetch).searchTargets('x')
    expect(isErr(result) && result.error.kind).toBe('auth')
    expect(isErr(result) && result.error.message).toContain('API token')
  })

  test('never leaks the token into an error', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 500 }])
    const result = await createJiraProvider(config, fetch).searchTargets('x')
    expect(JSON.stringify(isErr(result) && result.error)).not.toContain(config.token)
  })
})
