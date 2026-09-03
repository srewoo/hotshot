import { describe, expect, test, vi } from 'vitest'
import { createLinearProvider } from './client'
import { isErr, isOk } from '../../shared/result'

/**
 * Linear's traps:
 *   - A personal API key is sent BARE. `Bearer` yields an auth error that says
 *     nothing about the cause — the same trap ClickUp sets.
 *   - It is GraphQL, so an error arrives as an HTTP 200 with an `errors` array.
 *     Trusting the status makes a failed attach look successful.
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
      json: async () => spec.json ?? {},
      text: async () => JSON.stringify(spec.json ?? {}),
    } as Response
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

const config = { token: 'lin_api_SECRET' }
const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

describe('testConnection', () => {
  test('reports the authenticated account', async () => {
    const { fetch } = stubFetch([{ json: { data: { viewer: { id: 'u1', name: 'Sam' } } } }])
    const result = await createLinearProvider(config, fetch).testConnection()
    expect(isOk(result) && result.value).toEqual({ accountId: 'u1', displayName: 'Sam' })
  })

  /** Bare, not Bearer. This is the whole reason the test exists. */
  test('sends a personal key with NO Bearer prefix', async () => {
    const { fetch, calls } = stubFetch([{ json: { data: { viewer: { id: 'u1' } } } }])
    await createLinearProvider(config, fetch).testConnection()
    const auth = (calls[0]?.init.headers as Record<string, string>).Authorization ?? ''
    expect(auth).toBe(config.token)
    expect(auth.startsWith('Bearer')).toBe(false)
  })

  test('posts to the single GraphQL endpoint', async () => {
    const { fetch, calls } = stubFetch([{ json: { data: { viewer: { id: 'u1' } } } }])
    await createLinearProvider(config, fetch).testConnection()
    expect(calls[0]?.url).toBe('https://api.linear.app/graphql')
    expect(calls[0]?.init.method).toBe('POST')
  })

  /**
   * A GraphQL failure is a 200 with an `errors` array. Reading only the status
   * would report success on a revoked key.
   */
  test('treats a 200 carrying GraphQL errors as a failure', async () => {
    const { fetch } = stubFetch([
      { ok: true, status: 200, json: { errors: [{ message: 'Authentication required' }] } },
    ])
    const result = await createLinearProvider(config, fetch).testConnection()
    expect(isErr(result)).toBe(true)
    expect(isErr(result) && result.error.message).toContain('Authentication required')
  })

  test('never leaks the key into an error', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 500 }])
    const result = await createLinearProvider(config, fetch).testConnection()
    expect(JSON.stringify(isErr(result) && result.error)).not.toContain(config.token)
  })
})

describe('searchTargets', () => {
  const issues = {
    data: {
      issues: {
        nodes: [
          { id: 'i1', identifier: 'ENG-12', title: 'Login fails', state: { name: 'Todo' } },
        ],
      },
    },
  }

  test('returns the API id as the key and the human identifier as the hint', async () => {
    const { fetch } = stubFetch([{ json: issues }])
    const result = await createLinearProvider(config, fetch).searchTargets('login')
    expect(isOk(result) && result.value[0]).toEqual({
      key: 'i1',
      title: 'Login fails',
      hint: 'ENG-12 · Todo',
    })
  })

  test('an empty query asks for issues assigned to me', async () => {
    const { fetch, calls } = stubFetch([{ json: issues }])
    await createLinearProvider(config, fetch).searchTargets('')
    expect(JSON.parse(String(calls[0]?.init.body)).variables.filter).toEqual({
      assignee: { isMe: { eq: true } },
    })
  })

  test('a query filters by title', async () => {
    const { fetch, calls } = stubFetch([{ json: issues }])
    await createLinearProvider(config, fetch).searchTargets('login')
    expect(JSON.parse(String(calls[0]?.init.body)).variables.filter).toEqual({
      title: { containsIgnoreCase: 'login' },
    })
  })
})

describe('attachImage', () => {
  const ticket = {
    data: {
      fileUpload: {
        success: true,
        uploadFile: {
          uploadUrl: 'https://uploads.linear.app/signed',
          assetUrl: 'https://uploads.linear.app/asset/1',
          headers: [{ key: 'x-amz-acl', value: 'private' }],
        },
      },
    },
  }
  const attached = {
    data: { attachmentCreate: { success: true, attachment: { id: 'a1' } } },
  }

  test('uploads through the signed URL and then attaches the asset', async () => {
    const { fetch, calls } = stubFetch([{ json: ticket }, { json: {} }, { json: attached }])
    const result = await createLinearProvider(config, fetch).attachImage(
      { key: 'i1' },
      png,
      'shot.png',
    )
    expect(isOk(result) && result.value.id).toBe('a1')
    expect(calls[1]?.url).toBe('https://uploads.linear.app/signed')
    expect(calls[1]?.init.method).toBe('PUT')
  })

  /** The signed URL is the credential; the API key must not go with it. */
  test('does NOT send the API key to the upload URL', async () => {
    const { fetch, calls } = stubFetch([{ json: ticket }, { json: {} }, { json: attached }])
    await createLinearProvider(config, fetch).attachImage({ key: 'i1' }, png, 'shot.png')
    const headers = calls[1]?.init.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  test('echoes the headers Linear demands for the upload', async () => {
    const { fetch, calls } = stubFetch([{ json: ticket }, { json: {} }, { json: attached }])
    await createLinearProvider(config, fetch).attachImage({ key: 'i1' }, png, 'shot.png')
    expect((calls[1]?.init.headers as Record<string, string>)['x-amz-acl']).toBe('private')
  })

  test('refuses when Linear will not issue an upload', async () => {
    const { fetch } = stubFetch([
      { json: { data: { fileUpload: { success: false, uploadFile: null } } } },
    ])
    const result = await createLinearProvider(config, fetch).attachImage(
      { key: 'i1' },
      png,
      'shot.png',
    )
    expect(isErr(result) && result.error.message).toContain('would not issue an upload')
  })

  test('reports an upload that succeeded but an attachment that did not', async () => {
    const { fetch } = stubFetch([
      { json: ticket },
      { json: {} },
      { json: { data: { attachmentCreate: { success: false, attachment: null } } } },
    ])
    const result = await createLinearProvider(config, fetch).attachImage(
      { key: 'i1' },
      png,
      'shot.png',
    )
    expect(isErr(result) && result.error.message).toContain('not the attachment')
  })
})
