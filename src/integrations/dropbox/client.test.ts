import { describe, expect, test, vi } from 'vitest'
import { createDropboxProvider, escapeApiArg } from './client'
import { isErr, isOk } from '../../shared/result'

/**
 * Dropbox's two traps:
 *   - Upload goes to `content.dropboxapi.com`, not the API host.
 *   - Parameters travel in a HEADER as JSON, so non-ASCII must be escaped or
 *     the request fails with an error about the header rather than the name.
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

const config = { token: 'sl.SECRETTOKEN' }
const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })

describe('escapeApiArg', () => {
  test('leaves ASCII alone', () => {
    expect(escapeApiArg('{"path":"/shots/a.png"}')).toBe('{"path":"/shots/a.png"}')
  })

  /**
   * The reason this exists: a capture from a page titled "Rapport trimestriel"
   * otherwise fails with an opaque header error rather than anything about the
   * filename.
   */
  test('escapes non-ASCII, which a header cannot carry', () => {
    expect(escapeApiArg('{"path":"/é.png"}')).toBe('{"path":"/\\u00e9.png"}')
  })

  test('escapes characters well outside Latin-1 too', () => {
    expect(escapeApiArg('日')).toBe('\\u65e5')
  })

  test('produces only ASCII, whatever went in', () => {
    const escaped = escapeApiArg('{"path":"/報告-café-😀.png"}')
    expect([...escaped].every((char) => char.codePointAt(0)! < 128)).toBe(true)
  })
})

describe('testConnection', () => {
  test('reports the authenticated account', async () => {
    const { fetch } = stubFetch([
      { json: { account_id: 'a1', name: { display_name: 'Sam Rivers' } } },
    ])
    const result = await createDropboxProvider(config, fetch).testConnection()
    expect(isOk(result) && result.value).toEqual({ accountId: 'a1', displayName: 'Sam Rivers' })
  })

  /** An RPC endpoint with no arguments still needs `null`; empty is a 400. */
  test('sends null as the body, not an empty one', async () => {
    const { fetch, calls } = stubFetch([{ json: { account_id: 'a1' } }])
    await createDropboxProvider(config, fetch).testConnection()
    expect(calls[0]?.init.body).toBe('null')
  })

  test('never leaks the token into an error', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 500 }])
    const result = await createDropboxProvider(config, fetch).testConnection()
    expect(JSON.stringify(isErr(result) && result.error)).not.toContain('SECRETTOKEN')
  })
})

describe('searchTargets', () => {
  const listing = {
    json: {
      entries: [
        { '.tag': 'folder', name: 'Screenshots', path_lower: '/screenshots', path_display: '/Screenshots' },
        { '.tag': 'file', name: 'notes.txt', path_lower: '/notes.txt' },
      ],
    },
  }

  test('offers the root plus the folders, and never a file', async () => {
    const { fetch } = stubFetch([listing])
    const result = await createDropboxProvider(config, fetch).searchTargets('')
    expect(isOk(result) && result.value).toEqual([
      { key: '', title: 'Dropbox (root)', hint: '/' },
      { key: '/screenshots', title: 'Screenshots', hint: '/Screenshots' },
    ])
  })

  test('lists the root when nothing was typed', async () => {
    const { fetch, calls } = stubFetch([listing])
    await createDropboxProvider(config, fetch).searchTargets('')
    expect(calls[0]?.url).toContain('/files/list_folder')
  })

  test('uses the search endpoint when something was typed', async () => {
    const { fetch, calls } = stubFetch([{ json: { matches: [] } }])
    await createDropboxProvider(config, fetch).searchTargets('shots')
    expect(calls[0]?.url).toContain('/files/search_v2')
    expect(JSON.parse(String(calls[0]?.init.body)).query).toBe('shots')
  })

  /** `search_v2` double-nests each hit; the picker must see one shape. */
  test('normalises the search reply shape', async () => {
    const { fetch } = stubFetch([
      {
        json: {
          matches: [
            {
              metadata: {
                metadata: { '.tag': 'folder', name: 'Shots', path_lower: '/shots' },
              },
            },
          ],
        },
      },
    ])
    const result = await createDropboxProvider(config, fetch).searchTargets('shots')
    expect(isOk(result) && result.value).toEqual([
      { key: '/shots', title: 'Shots', hint: '/' },
    ])
  })
})

describe('attachImage', () => {
  test('uploads to the CONTENT host, not the API host', async () => {
    const { fetch, calls } = stubFetch([{ json: { id: 'id:1' } }])
    const result = await createDropboxProvider(config, fetch).attachImage(
      { key: '/screenshots' },
      png,
      'shot.png',
    )
    expect(isOk(result) && result.value.id).toBe('id:1')
    expect(calls[0]?.url).toBe('https://content.dropboxapi.com/2/files/upload')
  })

  test('sends the parameters in the Dropbox-API-Arg header, bytes in the body', async () => {
    const { fetch, calls } = stubFetch([{ json: { id: 'id:1' } }])
    await createDropboxProvider(config, fetch).attachImage(
      { key: '/screenshots' },
      png,
      'shot.png',
    )
    const headers = calls[0]?.init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/octet-stream')
    expect(JSON.parse(headers['Dropbox-API-Arg'] as string)).toMatchObject({
      path: '/screenshots/shot.png',
      mode: 'add',
      autorename: true,
    })
    expect(calls[0]?.init.body).toBe(png)
  })

  /** Two captures a minute apart must not silently replace one another. */
  test('adds with autorename rather than overwriting', async () => {
    const { fetch, calls } = stubFetch([{ json: { id: 'id:1' } }])
    await createDropboxProvider(config, fetch).attachImage({ key: '' }, png, 'shot.png')
    const arg = JSON.parse(
      (calls[0]?.init.headers as Record<string, string>)['Dropbox-API-Arg'] as string,
    )
    expect(arg.mode).toBe('add')
    expect(arg.autorename).toBe(true)
  })

  test('builds a leading-slash path for the root folder', async () => {
    const { fetch, calls } = stubFetch([{ json: { id: 'id:1' } }])
    await createDropboxProvider(config, fetch).attachImage({ key: '' }, png, 'shot.png')
    const arg = JSON.parse(
      (calls[0]?.init.headers as Record<string, string>)['Dropbox-API-Arg'] as string,
    )
    expect(arg.path).toBe('/shot.png')
  })

  test('does not double the slash on a folder that ends with one', async () => {
    const { fetch, calls } = stubFetch([{ json: { id: 'id:1' } }])
    await createDropboxProvider(config, fetch).attachImage({ key: '/shots/' }, png, 'a.png')
    const arg = JSON.parse(
      (calls[0]?.init.headers as Record<string, string>)['Dropbox-API-Arg'] as string,
    )
    expect(arg.path).toBe('/shots/a.png')
  })

  test('explains a folder that does not exist', async () => {
    const { fetch } = stubFetch([{ ok: false, status: 409 }])
    const result = await createDropboxProvider(config, fetch).attachImage(
      { key: '/nope' },
      png,
      'a.png',
    )
    expect(isErr(result) && result.error.message).toContain('folder may not exist')
  })
})
