import { describe, expect, test, vi } from 'vitest'
import { createNotionProvider, NOTION_VERSION } from './client'
import { isErr, isOk } from '../../shared/result'

/**
 * PRD FR-15 / §7.2. Notion is the only connector whose upload is a THREE-STEP
 * flow: create → send (multipart) → attach. An upload never attached expires
 * in one hour.
 *
 * NOTE: the live behaviour of this flow from an MV3 background fetch is still
 * unverified (PRD R-1, spike in `spikes/notion-cors/`). These tests pin the
 * request shapes we believe are correct; they do NOT prove Notion accepts them.
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

const config = { token: 'ntn_SECRET' }
const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

const happyPath: StubResponse[] = [
  { json: { id: 'upload-1' } },
  { json: { id: 'upload-1', status: 'uploaded' } },
  { json: { object: 'list', results: [{ id: 'block-1' }] } },
]

describe('notion testConnection', () => {
  test('identifies the integration via /users/me', async () => {
    const { fetch, calls } = stubFetch([{ json: { id: 'bot-1', name: 'Hotshot' } }])
    const result = await createNotionProvider(config, fetch).testConnection()

    expect(isOk(result)).toBe(true)
    expect(calls[0]?.url).toBe('https://api.notion.com/v1/users/me')
  })

  test('pins an explicit Notion-Version on every request', async () => {
    // An unpinned version means Notion can change our behaviour without us
    // shipping anything.
    const { fetch, calls } = stubFetch([{ json: { id: 'b', name: 'n' } }])
    await createNotionProvider(config, fetch).testConnection()

    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['Notion-Version']).toBe(NOTION_VERSION)
    expect(NOTION_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('uses Bearer auth, unlike ClickUp', async () => {
    const { fetch, calls } = stubFetch([{ json: { id: 'b', name: 'n' } }])
    await createNotionProvider(config, fetch).testConnection()
    expect((calls[0]?.init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer ntn_SECRET',
    )
  })
})

describe('notion attachImage — the three-step upload', () => {
  test('performs create, send, then attach in order', async () => {
    const { fetch, calls } = stubFetch(happyPath)
    const result = await createNotionProvider(config, fetch).attachImage(
      { key: 'page-1' },
      png,
      'shot.png',
    )

    expect(isOk(result)).toBe(true)
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.notion.com/v1/file_uploads',
      'https://api.notion.com/v1/file_uploads/upload-1/send',
      'https://api.notion.com/v1/blocks/page-1/children',
    ])
  })

  test('sends the bytes as multipart under the field name `file`', async () => {
    const { fetch, calls } = stubFetch(happyPath)
    await createNotionProvider(config, fetch).attachImage({ key: 'p' }, png, 'shot.png')

    const body = calls[1]?.init.body as FormData
    expect(body.get('file')).toBeInstanceOf(Blob)
    expect((calls[1]?.init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  test('references the upload id when attaching the block', async () => {
    const { fetch, calls } = stubFetch(happyPath)
    await createNotionProvider(config, fetch).attachImage({ key: 'p' }, png, 'shot.png')

    const body = JSON.parse(calls[2]?.init.body as string)
    expect(body.children[0].type).toBe('image')
    expect(body.children[0].image.type).toBe('file_upload')
    expect(body.children[0].image.file_upload.id).toBe('upload-1')
  })

  test('explains a 404 as an un-shared integration, the top support burden', async () => {
    // "Not found" would be technically true and practically useless: the page
    // exists, the user simply has not invited the integration to it.
    const { fetch } = stubFetch([
      { json: { id: 'u1' } },
      { json: { id: 'u1' } },
      { ok: false, status: 404 },
    ])
    const result = await createNotionProvider(config, fetch).attachImage(
      { key: 'p' },
      png,
      'a.png',
    )

    expect(isErr(result)).toBe(true)
    expect(isErr(result) && result.error.message).toMatch(/invite|share|connection/i)
    expect(isErr(result) && result.error.message.toLowerCase()).not.toBe('not found')
  })

  test('stops at the first failed step rather than continuing', async () => {
    const { fetch, calls } = stubFetch([{ ok: false, status: 401 }])
    const result = await createNotionProvider(config, fetch).attachImage({ key: 'p' }, png, 'a.png')

    expect(isErr(result) && result.error.kind).toBe('auth')
    expect(calls).toHaveLength(1)
  })

  test('rejects a file larger than the single-part limit before uploading', async () => {
    // 20MB cap; the request would fail anyway, but failing early gives the
    // user a real reason instead of a 400.
    const { fetch, calls } = stubFetch(happyPath)
    const huge = new Blob([new Uint8Array(21 * 1024 * 1024)], { type: 'image/png' })
    const result = await createNotionProvider(config, fetch).attachImage(
      { key: 'p' },
      huge,
      'big.png',
    )

    expect(isErr(result) && result.error.kind).toBe('too-large')
    expect(calls).toHaveLength(0)
  })

  test('never echoes the token in an error', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 401 }])
    const result = await createNotionProvider(config, fetch).attachImage({ key: 'p' }, png, 'a.png')
    expect(isErr(result) && JSON.stringify(result.error)).not.toContain('ntn_SECRET')
  })

  test('reports an expired upload id distinctly, since retrying blindly fails', async () => {
    const { fetch } = stubFetch([
      { json: { id: 'u1' } },
      { json: { id: 'u1' } },
      { ok: false, status: 400, json: { message: 'file_upload has expired' } },
    ])
    const result = await createNotionProvider(config, fetch).attachImage({ key: 'p' }, png, 'a.png')
    expect(isErr(result) && result.error.message).toMatch(/expired|again/i)
  })
})
