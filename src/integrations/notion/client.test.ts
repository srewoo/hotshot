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

/** A realistic Notion page id — 32 hex characters, as their URLs show. */
const PAGE = '2a1509b19e068000b573cf3c13abc281'

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
      { key: PAGE },
      png,
      'shot.png',
    )

    expect(isOk(result)).toBe(true)
    expect(calls.map((c) => c.url)).toEqual([
      'https://api.notion.com/v1/file_uploads',
      'https://api.notion.com/v1/file_uploads/upload-1/send',
      `https://api.notion.com/v1/blocks/${PAGE}/children`,
    ])
  })

  test('sends the bytes as multipart under the field name `file`', async () => {
    const { fetch, calls } = stubFetch(happyPath)
    await createNotionProvider(config, fetch).attachImage({ key: PAGE }, png, 'shot.png')

    const body = calls[1]?.init.body as FormData
    expect(body.get('file')).toBeInstanceOf(Blob)
    expect((calls[1]?.init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  test('references the upload id when attaching the block', async () => {
    const { fetch, calls } = stubFetch(happyPath)
    await createNotionProvider(config, fetch).attachImage({ key: PAGE }, png, 'shot.png')

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
      { key: PAGE },
      png,
      'a.png',
    )

    expect(isErr(result)).toBe(true)
    expect(isErr(result) && result.error.message).toMatch(/invite|share|connection/i)
    expect(isErr(result) && result.error.message.toLowerCase()).not.toBe('not found')
  })

  test('stops at the first failed step rather than continuing', async () => {
    const { fetch, calls } = stubFetch([{ ok: false, status: 401 }])
    const result = await createNotionProvider(config, fetch).attachImage({ key: PAGE }, png, 'a.png')

    expect(isErr(result) && result.error.kind).toBe('auth')
    expect(calls).toHaveLength(1)
  })

  test('rejects a file larger than the single-part limit before uploading', async () => {
    // 20MB cap; the request would fail anyway, but failing early gives the
    // user a real reason instead of a 400.
    const { fetch, calls } = stubFetch(happyPath)
    const huge = new Blob([new Uint8Array(21 * 1024 * 1024)], { type: 'image/png' })
    const result = await createNotionProvider(config, fetch).attachImage(
      { key: PAGE },
      huge,
      'big.png',
    )

    expect(isErr(result) && result.error.kind).toBe('too-large')
    expect(calls).toHaveLength(0)
  })

  test('never echoes the token in an error', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 401 }])
    const result = await createNotionProvider(config, fetch).attachImage({ key: PAGE }, png, 'a.png')
    expect(isErr(result) && JSON.stringify(result.error)).not.toContain('ntn_SECRET')
  })

  test('reports an expired upload id distinctly, since retrying blindly fails', async () => {
    const { fetch } = stubFetch([
      { json: { id: 'u1' } },
      { json: { id: 'u1' } },
      { ok: false, status: 400, json: { message: 'file_upload has expired' } },
    ])
    const result = await createNotionProvider(config, fetch).attachImage({ key: PAGE }, png, 'a.png')
    expect(isErr(result) && result.error.message).toMatch(/expired|again/i)
  })
})

describe('page id validation and 400 handling', () => {
  test('rejects an id that is not a Notion page id before uploading anything', async () => {
    // The user's real case: "sdjcvsjd-3cf509b19e06809f". Notion ids are 32 hex
    // characters. Sending it wasted a three-step upload and produced a
    // misleading "expired" error.
    const { fetch, calls } = stubFetch(happyPath)
    const result = await createNotionProvider(config, fetch).attachImage(
      { key: 'sdjcvsjd-3cf509b19e06809f' },
      png,
      'a.png',
    )

    expect(isErr(result)).toBe(true)
    expect(isErr(result) && result.error.kind).toBe('not-found')
    expect(isErr(result) && result.error.message).toMatch(/32|id/i)
    expect(calls, 'must not call Notion with an id we know is invalid').toHaveLength(0)
  })

  test('accepts a dashed page id, which is how Notion shows them in URLs', async () => {
    const { fetch } = stubFetch(happyPath)
    const result = await createNotionProvider(config, fetch).attachImage(
      { key: '2a1509b1-9e06-8000-b573-cf3c13abc281' },
      png,
      'a.png',
    )
    expect(isOk(result)).toBe(true)
  })

  test('accepts a bare 32-character page id', async () => {
    const { fetch } = stubFetch(happyPath)
    const result = await createNotionProvider(config, fetch).attachImage(
      { key: '2a1509b19e068000b573cf3c13abc281' },
      png,
      'a.png',
    )
    expect(isOk(result)).toBe(true)
  })

  test('only claims the upload expired when Notion actually says so', async () => {
    // Mapping every 400 to "expired" sent users chasing a timing problem that
    // was really a malformed request.
    const { fetch } = stubFetch([
      { json: { id: 'u1' } },
      { json: { id: 'u1' } },
      { ok: false, status: 400, json: { message: 'body failed validation' } },
    ])
    const result = await createNotionProvider(config, fetch).attachImage(
      { key: '2a1509b19e068000b573cf3c13abc281' },
      png,
      'a.png',
    )
    expect(isErr(result) && result.error.message).not.toMatch(/expired/i)
  })

  test('still explains an expired upload when that is the real cause', async () => {
    const { fetch } = stubFetch([
      { json: { id: 'u1' } },
      { json: { id: 'u1' } },
      { ok: false, status: 400, json: { message: 'file_upload has expired' } },
    ])
    const result = await createNotionProvider(config, fetch).attachImage(
      { key: '2a1509b19e068000b573cf3c13abc281' },
      png,
      'a.png',
    )
    expect(isErr(result) && result.error.message).toMatch(/expired/i)
  })
})

/** FR-41 for Notion, whose title shapes are the awkward part. */
describe('searchTargets', () => {
  test('titles a page from its title-typed property, whatever it is called', async () => {
    const { fetch } = stubFetch([
      {
        json: {
          results: [
            {
              id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              object: 'page',
              properties: {
                // The property NAME differs per database; only its type is fixed.
                'Bug title': { type: 'title', title: [{ plain_text: 'Login fails' }] },
                Status: { type: 'select' },
              },
            },
          ],
        },
      },
    ])
    const result = await createNotionProvider(config, fetch).searchTargets('login')
    expect(isOk(result) && result.value[0]?.title).toBe('Login fails')
  })

  test('titles a result from a top-level title array', async () => {
    const { fetch } = stubFetch([
      { json: { results: [{ id: 'p1', title: [{ plain_text: 'Runbook' }] }] } },
    ])
    const result = await createNotionProvider(config, fetch).searchTargets('run')
    expect(isOk(result) && result.value[0]?.title).toBe('Runbook')
  })

  test('joins a title split across rich-text runs', async () => {
    const { fetch } = stubFetch([
      {
        json: {
          results: [{ id: 'p1', title: [{ plain_text: 'Q3 ' }, { plain_text: 'report' }] }],
        },
      },
    ])
    const result = await createNotionProvider(config, fetch).searchTargets('q3')
    expect(isOk(result) && result.value[0]?.title).toBe('Q3 report')
  })

  test('falls back to Untitled rather than an empty row', async () => {
    const { fetch } = stubFetch([{ json: { results: [{ id: 'p1' }] } }])
    const result = await createNotionProvider(config, fetch).searchTargets('x')
    expect(isOk(result) && result.value[0]?.title).toBe('Untitled')
  })

  test('asks only for pages, which are the only thing a block can append to', async () => {
    const { fetch, calls } = stubFetch([{ json: { results: [] } }])
    await createNotionProvider(config, fetch).searchTargets('x')
    const body = JSON.parse(String(calls[0]?.init.body))
    expect(body.filter).toEqual({ property: 'object', value: 'page' })
    expect(body.query).toBe('x')
  })

  test('omits the query entirely when nothing was typed, for recent pages', async () => {
    const { fetch, calls } = stubFetch([{ json: { results: [] } }])
    await createNotionProvider(config, fetch).searchTargets('  ')
    const body = JSON.parse(String(calls[0]?.init.body))
    expect('query' in body).toBe(false)
    expect(body.sort).toEqual({ direction: 'descending', timestamp: 'last_edited_time' })
  })

  test('surfaces the invite-the-integration message on a 404', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 404 }])
    const result = await createNotionProvider(config, fetch).searchTargets('x')
    expect(isErr(result) && result.error.message).toContain('Connections')
  })

  test('never leaks the token into an error', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 500 }])
    const result = await createNotionProvider(config, fetch).searchTargets('x')
    expect(JSON.stringify(isErr(result) && result.error)).not.toContain(config.token)
  })
})
