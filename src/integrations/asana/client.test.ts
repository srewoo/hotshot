import { describe, expect, test, vi } from 'vitest'
import { createAsanaProvider } from './client'
import { isErr, isOk } from '../../shared/result'

/** Asana wraps every payload — and every error — in `data`. */

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

const config = { token: '1/1234:SECRETPAT' }
const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
const me = { json: { data: { gid: 'u1', name: 'Sam', workspaces: [{ gid: 'w1', name: 'Acme' }] } } }

describe('testConnection', () => {
  test('reports the authenticated account', async () => {
    const { fetch } = stubFetch([me])
    const result = await createAsanaProvider(config, fetch).testConnection()
    expect(isOk(result) && result.value).toEqual({ accountId: 'u1', displayName: 'Sam' })
  })

  test('sends the personal token as a Bearer credential', async () => {
    const { fetch, calls } = stubFetch([me])
    await createAsanaProvider(config, fetch).testConnection()
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${config.token}`,
    )
  })

  test('never leaks the token into an error', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 500 }])
    const result = await createAsanaProvider(config, fetch).testConnection()
    expect(JSON.stringify(isErr(result) && result.error)).not.toContain('SECRETPAT')
  })
})

describe('searchTargets', () => {
  const tasks = { json: { data: [{ gid: 't1', name: 'Invoice overflow' }] } }

  /** The task list is workspace-scoped, so discovery is two calls. */
  test('resolves the workspace before listing tasks', async () => {
    const { fetch, calls } = stubFetch([me, tasks])
    const result = await createAsanaProvider(config, fetch).searchTargets('')
    expect(calls[0]?.url).toContain('/users/me')
    expect(calls[1]?.url).toContain('workspace=w1')
    expect(calls[1]?.url).toContain('assignee=me')
    expect(isOk(result) && result.value[0]).toEqual({
      key: 't1',
      title: 'Invoice overflow',
      hint: 'Acme',
    })
  })

  test('filters locally by name', async () => {
    const { fetch } = stubFetch([me, tasks])
    const result = await createAsanaProvider(config, fetch).searchTargets('nothing')
    expect(isOk(result) && result.value).toHaveLength(0)
  })

  test('explains a token with no workspace', async () => {
    const { fetch } = stubFetch([{ json: { data: { gid: 'u1', workspaces: [] } } }])
    const result = await createAsanaProvider(config, fetch).searchTargets('')
    expect(isErr(result) && result.error.message).toContain('no workspace')
  })
})

describe('attachImage', () => {
  test('posts multipart with the task as the parent', async () => {
    const { fetch, calls } = stubFetch([{ json: { data: { gid: 'att1' } } }])
    const result = await createAsanaProvider(config, fetch).attachImage(
      { key: 't1' },
      png,
      'shot.png',
    )
    expect(isOk(result) && result.value.id).toBe('att1')
    const form = calls[0]?.init.body as FormData
    expect(form.get('parent')).toBe('t1')
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  test('lets fetch set the multipart boundary', async () => {
    const { fetch, calls } = stubFetch([{ json: { data: { gid: 'att1' } } }])
    await createAsanaProvider(config, fetch).attachImage({ key: 't1' }, png, 'shot.png')
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
    // The credential still has to be there.
    expect(headers.Authorization).toContain('Bearer')
  })

  test('explains a task this token cannot see', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 404 }])
    const result = await createAsanaProvider(config, fetch).attachImage(
      { key: 'gone' },
      png,
      'shot.png',
    )
    expect(isErr(result) && result.error.kind).toBe('not-found')
  })
})
