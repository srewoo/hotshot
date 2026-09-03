import { describe, expect, test, vi } from 'vitest'
import { createClickUpProvider } from './client'
import { isErr, isOk } from '../../shared/result'

/**
 * PRD FR-16 / §7.3. The detail that bites: a ClickUp PERSONAL token is sent
 * bare, with NO `Bearer` prefix — only the OAuth flow uses `Bearer`. The
 * multipart field is named `attachment`, not `file`.
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

const config = { token: 'pk_12345_SECRET' }
const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

describe('clickup testConnection', () => {
  test('reports the authenticated user', async () => {
    const { fetch, calls } = stubFetch([{ json: { user: { id: 42, username: 'sam' } } }])
    const result = await createClickUpProvider(config, fetch).testConnection()

    expect(isOk(result)).toBe(true)
    expect(isOk(result) && result.value.displayName).toBe('sam')
    expect(calls[0]?.url).toBe('https://api.clickup.com/api/v2/user')
  })

  test('sends the personal token WITHOUT a Bearer prefix', async () => {
    const { fetch, calls } = stubFetch([{ json: { user: { id: 1, username: 'x' } } }])
    await createClickUpProvider(config, fetch).testConnection()

    const auth = (calls[0]?.init.headers as Record<string, string>)['Authorization']
    expect(auth).toBe('pk_12345_SECRET')
    expect(auth).not.toMatch(/^Bearer/)
  })

  test('maps 401 to an auth failure without echoing the token', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 401 }])
    const result = await createClickUpProvider(config, fetch).testConnection()

    expect(isErr(result) && result.error.kind).toBe('auth')
    expect(isErr(result) && JSON.stringify(result.error)).not.toContain('pk_12345_SECRET')
  })
})

describe('clickup attachImage', () => {
  test('posts multipart with the field name `attachment`', async () => {
    const { fetch, calls } = stubFetch([{ json: { id: 'att1' } }])
    const result = await createClickUpProvider(config, fetch).attachImage(
      { key: 'task123' },
      png,
      'shot.png',
    )

    expect(isOk(result)).toBe(true)
    expect(calls[0]?.url).toBe('https://api.clickup.com/api/v2/task/task123/attachment')
    expect((calls[0]?.init.body as FormData).get('attachment')).toBeInstanceOf(Blob)
  })

  test('does not set Content-Type by hand', async () => {
    const { fetch, calls } = stubFetch([{ json: { id: 'a' } }])
    await createClickUpProvider(config, fetch).attachImage({ key: 't' }, png, 'a.png')
    expect((calls[0]?.init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  test('maps 404 naming the task', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 404 }])
    const result = await createClickUpProvider(config, fetch).attachImage(
      { key: 'ghost' },
      png,
      'a.png',
    )
    expect(isErr(result) && result.error.message).toContain('ghost')
  })

  test('rejects an unrecognised success shape', async () => {
    const { fetch } = stubFetch([{ json: { nope: true } }])
    const result = await createClickUpProvider(config, fetch).attachImage({ key: 't' }, png, 'a.png')
    expect(isErr(result) && result.error.kind).toBe('schema')
  })

  test('reports a network failure without throwing', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof globalThis.fetch
    const result = await createClickUpProvider(config, fetch).attachImage({ key: 't' }, png, 'a.png')
    expect(isErr(result) && result.error.kind).toBe('network')
  })
})

/**
 * FR-41 for ClickUp, which has no search endpoint a personal token can use —
 * so discovery is teams → tasks, and narrowing happens locally. The tests pin
 * that the local filter is honest about what it is.
 */
describe('searchTargets', () => {
  const teams = { json: { teams: [{ id: 123 }] } }
  const tasks = {
    json: {
      tasks: [
        { id: 'abc1', name: 'Login fails', list: { name: 'Bugs' }, status: { status: 'open' } },
        { id: 'abc2', name: 'Invoice overflow', list: { name: 'Bugs' }, status: { status: 'wip' } },
      ],
    },
  }

  test('lists tasks from the first workspace', async () => {
    const { fetch, calls } = stubFetch([teams, tasks])
    const result = await createClickUpProvider(config, fetch).searchTargets('')
    expect(calls[0]?.url).toContain('/team')
    expect(calls[1]?.url).toContain('/team/123/task')
    expect(isOk(result) && result.value).toEqual([
      { key: 'abc1', title: 'Login fails', hint: 'Bugs · open' },
      { key: 'abc2', title: 'Invoice overflow', hint: 'Bugs · wip' },
    ])
  })

  test('narrows by name locally, because the endpoint cannot', async () => {
    const { fetch } = stubFetch([teams, tasks])
    const result = await createClickUpProvider(config, fetch).searchTargets('invoice')
    expect(isOk(result) && result.value).toHaveLength(1)
    expect(isOk(result) && result.value[0]?.key).toBe('abc2')
  })

  test('matches a task id as well as a name, so a pasted id still finds it', async () => {
    const { fetch } = stubFetch([teams, tasks])
    const result = await createClickUpProvider(config, fetch).searchTargets('ABC1')
    expect(isOk(result) && result.value[0]?.key).toBe('abc1')
  })

  test('sends the personal token with no Bearer prefix, as everywhere else', async () => {
    const { fetch, calls } = stubFetch([teams, tasks])
    await createClickUpProvider(config, fetch).searchTargets('')
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(config.token)
  })

  test('explains a token that belongs to no workspace', async () => {
    const { fetch } = stubFetch([{ json: { teams: [] } }])
    const result = await createClickUpProvider(config, fetch).searchTargets('')
    expect(isErr(result) && result.error.kind).toBe('not-found')
    expect(isErr(result) && result.error.message).toContain('no workspace')
  })

  test('falls back to the id when a task has no name', async () => {
    const { fetch } = stubFetch([teams, { json: { tasks: [{ id: 'bare' }] } }])
    const result = await createClickUpProvider(config, fetch).searchTargets('')
    expect(isOk(result) && result.value[0]).toEqual({
      key: 'bare',
      title: 'bare',
      hint: 'bare',
    })
  })

  test('reports a rejected token rather than an empty list', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 401 }])
    const result = await createClickUpProvider(config, fetch).searchTargets('')
    expect(isErr(result) && result.error.kind).toBe('auth')
  })

  test('never leaks the token into an error', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 500 }])
    const result = await createClickUpProvider(config, fetch).searchTargets('')
    expect(JSON.stringify(isErr(result) && result.error)).not.toContain(config.token)
  })
})
