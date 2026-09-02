/**
 * Notion CORS / file-upload spike (PRD R-1). See README.md.
 *
 * Deliberately standalone: it shares no code with `src/integrations` so that a
 * bug in our own abstraction cannot be mistaken for a Notion behaviour. Once
 * the questions are answered this file is deleted, not promoted.
 */

const NOTION = 'https://api.notion.com/v1'

/** Pinned deliberately. A version bump is a tested change, never a surprise. */
const NOTION_VERSION = '2022-06-28'

export interface SpikeInput {
  readonly token: string
  readonly pageId: string
  /** Pass an unshared page id to prove finding 5. */
  readonly unsharedPageId?: string
}

export interface SpikeStep {
  readonly name: string
  readonly ok: boolean
  readonly status?: number
  readonly detail: string
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Notion-Version': NOTION_VERSION,
  }
}

async function describe(response: Response): Promise<string> {
  const text = await response.text()
  return text.slice(0, 400)
}

/** A 1×1 PNG, so the upload path is exercised without a real capture. */
function tinyPng(): Blob {
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return new Blob([bytes], { type: 'image/png' })
}

export async function runNotionSpike(input: SpikeInput): Promise<SpikeStep[]> {
  const steps: SpikeStep[] = []
  const record = (s: SpikeStep): SpikeStep => {
    steps.push(s)
    // eslint-disable-next-line no-console
    console.log(`[spike] ${s.ok ? 'PASS' : 'FAIL'} ${s.name} — ${s.detail}`)
    return s
  }

  // 0. The permission must be granted at runtime, not at install (FR-23).
  const granted = await chrome.permissions.request({
    origins: ['https://api.notion.com/*'],
  })
  record({
    name: 'optional host permission granted',
    ok: granted,
    detail: granted ? 'user granted api.notion.com' : 'user declined; the rest will fail',
  })
  if (!granted) return steps

  // 1. Reachability + auth. If CORS binds us, this is where it shows.
  try {
    const me = await fetch(`${NOTION}/users/me`, { headers: headers(input.token) })
    record({
      name: 'GET /users/me (proves CORS does not block a background fetch)',
      ok: me.ok,
      status: me.status,
      detail: me.ok ? 'reachable and authenticated' : await describe(me),
    })
    if (!me.ok) return steps
  } catch (error) {
    record({
      name: 'GET /users/me',
      ok: false,
      detail: `threw before a status: ${String(error)} — this is the CORS-blocked signature`,
    })
    return steps
  }

  // 2. Create the upload.
  const created = await fetch(`${NOTION}/file_uploads`, {
    method: 'POST',
    headers: { ...headers(input.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  const createdBody = (await created.json().catch(() => null)) as { id?: string } | null
  record({
    name: 'POST /file_uploads',
    ok: created.ok && typeof createdBody?.id === 'string',
    status: created.status,
    detail: createdBody?.id ? `upload id ${createdBody.id}` : JSON.stringify(createdBody),
  })
  if (!createdBody?.id) return steps

  // 3. Send the bytes. Multipart, field name `file`.
  const form = new FormData()
  form.append('file', tinyPng(), 'spike.png')
  const sent = await fetch(`${NOTION}/file_uploads/${createdBody.id}/send`, {
    method: 'POST',
    // Content-Type is intentionally NOT set: the browser must add the
    // multipart boundary itself.
    headers: headers(input.token),
    body: form,
  })
  record({
    name: 'POST /file_uploads/{id}/send (multipart)',
    ok: sent.ok,
    status: sent.status,
    detail: sent.ok ? 'bytes accepted' : await describe(sent),
  })
  if (!sent.ok) return steps

  // 4. Attach it. An upload never attached expires in 1 hour.
  const attached = await fetch(`${NOTION}/blocks/${input.pageId}/children`, {
    method: 'PATCH',
    headers: { ...headers(input.token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      children: [
        {
          object: 'block',
          type: 'image',
          image: { type: 'file_upload', file_upload: { id: createdBody.id } },
        },
      ],
    }),
  })
  record({
    name: 'PATCH /blocks/{id}/children',
    ok: attached.ok,
    status: attached.status,
    detail: attached.ok ? 'image block appended — check the page' : await describe(attached),
  })

  // 5. The un-shared page case, which drives FR-30's copy.
  if (input.unsharedPageId) {
    const unshared = await fetch(`${NOTION}/blocks/${input.unsharedPageId}/children`, {
      method: 'PATCH',
      headers: { ...headers(input.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ children: [] }),
    })
    record({
      name: 'un-shared page returns 404 (drives the "invite the integration" copy)',
      ok: unshared.status === 404,
      status: unshared.status,
      detail: await describe(unshared),
    })
  }

  return steps
}

declare global {
  // eslint-disable-next-line no-var
  var runNotionSpike: typeof import('./spike').runNotionSpike | undefined
}

if (import.meta.env?.DEV) {
  globalThis.runNotionSpike = runNotionSpike
}
