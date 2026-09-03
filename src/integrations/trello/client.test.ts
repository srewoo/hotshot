import { describe, expect, test, vi } from 'vitest'
import { createTrelloProvider, splitCredentials } from './client'
import { isErr, isOk } from '../../shared/result'

/**
 * Trello authenticates with a key AND a token, both as query parameters. That
 * puts the credential in the URL, which is why `http.ts` refuses to echo a
 * failed request's URL — and why these tests check that it never leaks.
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

const config = { token: 'KEY123:TOKEN456SECRET' }
const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

describe('splitCredentials', () => {
  test('splits the pair', () => {
    expect(splitCredentials('abc:def')).toEqual({ key: 'abc', token: 'def' })
  })

  test('trims whitespace, since this is pasted by hand', () => {
    expect(splitCredentials(' abc : def ')).toEqual({ key: 'abc', token: 'def' })
  })

  test.each(['', 'nocolon', ':onlytoken', 'onlykey:', '   :   '])(
    'refuses %j rather than half-authenticating',
    (value) => {
      expect(splitCredentials(value)).toBeNull()
    },
  )

  test('keeps a token containing a colon intact', () => {
    expect(splitCredentials('key:tok:en')).toEqual({ key: 'key', token: 'tok:en' })
  })
})

describe('testConnection', () => {
  test('reports the authenticated member', async () => {
    const { fetch } = stubFetch([{ json: { id: 'm1', fullName: 'Sam Rivers' } }])
    const result = await createTrelloProvider(config, fetch).testConnection()
    expect(isOk(result) && result.value).toEqual({ accountId: 'm1', displayName: 'Sam Rivers' })
  })

  test('sends both credentials as query parameters', async () => {
    const { fetch, calls } = stubFetch([{ json: { id: 'm1' } }])
    await createTrelloProvider(config, fetch).testConnection()
    expect(calls[0]?.url).toContain('key=KEY123')
    expect(calls[0]?.url).toContain('token=TOKEN456SECRET')
  })

  /**
   * A half-entered credential must fail with an instruction, not with a 401
   * that says the token is wrong when the format is.
   */
  test('explains a missing half rather than calling the API', async () => {
    const { fetch, calls } = stubFetch([{ json: {} }])
    const result = await createTrelloProvider({ token: 'justakey' }, fetch).testConnection()
    expect(isErr(result) && result.error.message).toContain('key:token')
    expect(calls, 'a malformed credential must not reach the network').toHaveLength(0)
  })

  test('never leaks the token into an error', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 500 }])
    const result = await createTrelloProvider(config, fetch).testConnection()
    expect(JSON.stringify(isErr(result) && result.error)).not.toContain('TOKEN456SECRET')
  })
})

describe('searchTargets', () => {
  const cards = [
    { id: 'c1', name: 'Invoice overflow', shortLink: 'aB1' },
    { id: 'c2', name: 'Login bug', shortLink: 'cD2' },
  ]

  test('lists the member cards', async () => {
    const { fetch } = stubFetch([{ json: cards }])
    const result = await createTrelloProvider(config, fetch).searchTargets('')
    expect(isOk(result) && result.value).toEqual([
      { key: 'c1', title: 'Invoice overflow', hint: 'aB1' },
      { key: 'c2', title: 'Login bug', hint: 'cD2' },
    ])
  })

  test('filters locally, because the card list has no query parameter', async () => {
    const { fetch } = stubFetch([{ json: cards }])
    const result = await createTrelloProvider(config, fetch).searchTargets('login')
    expect(isOk(result) && result.value).toHaveLength(1)
  })
})

describe('attachImage', () => {
  test('posts multipart with the file field', async () => {
    const { fetch, calls } = stubFetch([{ json: { id: 'att1' } }])
    const result = await createTrelloProvider(config, fetch).attachImage(
      { key: 'c1' },
      png,
      'shot.png',
    )
    expect(isOk(result) && result.value.id).toBe('att1')
    expect(calls[0]?.url).toContain('/cards/c1/attachments')
    expect(calls[0]?.init.body).toBeInstanceOf(FormData)
    expect((calls[0]?.init.body as FormData).get('file')).toBeInstanceOf(Blob)
  })

  /**
   * Setting Content-Type by hand omits the boundary, and the upload fails with
   * an opaque error — the same trap Jira sets.
   */
  test('lets fetch set the multipart boundary', async () => {
    const { fetch, calls } = stubFetch([{ json: { id: 'att1' } }])
    await createTrelloProvider(config, fetch).attachImage({ key: 'c1' }, png, 'shot.png')
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
  })

  test('explains a card this token cannot see', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 404 }])
    const result = await createTrelloProvider(config, fetch).attachImage(
      { key: 'gone' },
      png,
      'shot.png',
    )
    expect(isErr(result) && result.error.kind).toBe('not-found')
  })
})
