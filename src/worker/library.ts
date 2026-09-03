import { createHistoryRepo, HISTORY_LIMIT, type HistoryEntry } from '../storage/history-repo'
import { handleShip } from './destinations'
import type { ProviderId } from '../storage/token-repo'
import { idbHistoryStore, type StoredCapture } from '../storage/idb-history'
import { quotaPlan } from '../storage/library-query'
import { withTag, withoutTag } from '../storage/library-query'

/**
 * The library's operations, in the worker (PRD FR-25/FR-26).
 *
 * The worker owns IndexedDB for the same reason it owns tokens: a content
 * script on an arbitrary page must never be able to read a user's capture
 * history. Every one of these is reached by message, and the library page is
 * just another caller.
 */

/** Total bytes the library may hold before old captures are evicted. */
export const LIBRARY_BYTE_BUDGET = 256 * 1024 * 1024

const store = idbHistoryStore()
const repo = createHistoryRepo(store)

export async function listLibrary(): Promise<readonly HistoryEntry[]> {
  return await repo.list()
}

/**
 * Reads one capture's bytes.
 *
 * Returned as a data URL rather than a blob: a structured clone of a Blob
 * across the extension message boundary is not reliable in every Chrome
 * version, and the library page needs a src it can hand to an `<img>` anyway.
 */
export async function readCapture(id: string): Promise<string | null> {
  const blob = await store.blobFor(id)
  if (!blob) return null
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the capture.'))
    reader.readAsDataURL(blob)
  })
}

export async function updateCapture(id: string, patch: Partial<HistoryEntry>): Promise<void> {
  await repo.update(id, patch)
}

export async function toggleFavourite(id: string): Promise<boolean> {
  const entry = (await repo.list()).find((row) => row.id === id)
  if (!entry) return false
  const next = !entry.favourite
  await repo.update(id, { favourite: next })
  return next
}

export async function tagCapture(id: string, tag: string, add: boolean): Promise<void> {
  const entry = (await repo.list()).find((row) => row.id === id)
  if (!entry) return
  await repo.update(id, {
    tags: add ? withTag(entry.tags, tag) : withoutTag(entry.tags, tag),
  })
}

/**
 * Deletes captures, returning enough to put them back.
 *
 * Bulk delete without an undo is how a library loses someone's afternoon. The
 * blobs come back with the rows because they are the only copy — this is a
 * local-first product, and there is no server to re-fetch from.
 */
export async function deleteCaptures(ids: readonly string[]): Promise<readonly StoredCapture[]> {
  const removed: StoredCapture[] = []
  const rows = await repo.list()

  for (const id of ids) {
    const entry = rows.find((row) => row.id === id)
    if (!entry) continue
    const blob = await store.blobFor(id)
    if (blob) removed.push({ ...entry, blob })
  }

  await repo.remove(ids)
  return removed
}

export async function restoreCaptures(entries: readonly StoredCapture[]): Promise<void> {
  for (const entry of entries) await store.putWithBlob(entry)
}

export async function clearLibrary(): Promise<void> {
  await repo.clear()
}

/**
 * Evicts old captures to stay inside the count and byte budgets.
 *
 * Runs after every write. The plan is computed by `quotaPlan`, which spares
 * favourites — the cap exists to bound memory, and a user who marked a capture
 * is telling us which ones to bound.
 */
export async function enforceQuota(): Promise<readonly string[]> {
  const entries = await repo.list()
  const doomed = quotaPlan(entries, {
    maxCount: HISTORY_LIMIT,
    maxBytes: LIBRARY_BYTE_BUDGET,
  })
  if (doomed.length > 0) await repo.remove(doomed)
  return doomed
}

/**
 * Sends a stored capture to the destination it went to before (FR-25).
 *
 * The common case it serves: a capture went to the wrong ticket, or the ticket
 * was reopened, and re-attaching it should not mean re-taking it. Refuses
 * plainly when the capture never had a destination — there is nothing to
 * repeat, and guessing one would attach a screenshot somewhere nobody asked.
 */
export async function resendCapture(
  id: string,
): Promise<{ ok: boolean; message: string; url?: string }> {
  const entry = (await repo.list()).find((row) => row.id === id)
  if (!entry) return { ok: false, message: 'That capture is no longer in the library.' }
  if (!entry.destination) {
    return { ok: false, message: 'That capture was never sent anywhere, so there is nowhere to resend it.' }
  }

  const dataUrl = await readCapture(id)
  if (!dataUrl) return { ok: false, message: 'That capture’s image is no longer stored.' }

  const outcome = await handleShip({
    provider: entry.destination.provider as ProviderId,
    key: entry.destination.key,
    dataUrl,
    url: entry.sourceUrl,
    title: entry.title,
    viewportWidth: entry.widthDevicePx,
    viewportHeight: entry.heightDevicePx,
    devicePixelRatio: 1,
  })

  if (outcome.ok && outcome.destination) {
    await repo.update(id, { destination: outcome.destination })
  }
  return { ok: outcome.ok, message: outcome.message, ...(outcome.url ? { url: outcome.url } : {}) }
}

export interface ExportedLibrary {
  readonly version: 1
  readonly exportedAt: string
  readonly captures: ReadonlyArray<HistoryEntry & { readonly dataUrl: string }>
}

/**
 * Exports the library as one JSON document.
 *
 * Self-contained, with the images inline as data URLs, because an export that
 * references files the user has to keep alongside it is an export they will
 * eventually find broken. It is also the answer to "what happens to my
 * captures if I uninstall" for a product with no cloud.
 */
export async function exportLibrary(): Promise<ExportedLibrary> {
  const entries = await repo.list()
  const captures: Array<HistoryEntry & { dataUrl: string }> = []
  for (const entry of entries) {
    const dataUrl = await readCapture(entry.id)
    if (dataUrl) captures.push({ ...entry, dataUrl })
  }
  return { version: 1, exportedAt: new Date().toISOString(), captures }
}

/** Imported rows are untrusted input: every field is checked before a write. */
export function parseImport(value: unknown): ExportedLibrary['captures'] {
  if (typeof value !== 'object' || value === null) return []
  const document = value as { version?: unknown; captures?: unknown }
  if (document.version !== 1 || !Array.isArray(document.captures)) return []

  return document.captures.flatMap((row: unknown) => {
    if (typeof row !== 'object' || row === null) return []
    const capture = row as Record<string, unknown>
    const dataUrl = capture.dataUrl
    // Only PNG data URLs, for the same reason the stitch handoff is pinned to
    // one: this value ends up in an `<img src>` and must not be able to become
    // a network request.
    if (typeof dataUrl !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
      return []
    }
    if (typeof capture.id !== 'string' || !capture.id) return []

    return [
      {
        id: capture.id,
        capturedAt: typeof capture.capturedAt === 'number' ? capture.capturedAt : Date.now(),
        sourceUrl: typeof capture.sourceUrl === 'string' ? capture.sourceUrl : '',
        title: typeof capture.title === 'string' ? capture.title : '',
        widthDevicePx: typeof capture.widthDevicePx === 'number' ? capture.widthDevicePx : 0,
        heightDevicePx: typeof capture.heightDevicePx === 'number' ? capture.heightDevicePx : 0,
        bytes: typeof capture.bytes === 'number' ? capture.bytes : 0,
        // An imported capture is never marked incognito: it is being written
        // deliberately, and the flag exists to stop an incognito WRITE.
        incognito: false,
        favourite: capture.favourite === true,
        tags: Array.isArray(capture.tags)
          ? capture.tags.filter((tag): tag is string => typeof tag === 'string')
          : [],
        dataUrl,
      },
    ]
  })
}

export async function importLibrary(value: unknown): Promise<number> {
  const captures = parseImport(value)
  for (const capture of captures) {
    const response = await fetch(capture.dataUrl)
    const blob = await response.blob()
    const { dataUrl: _dataUrl, ...entry } = capture
    await store.putWithBlob({ ...entry, bytes: blob.size, blob })
  }
  await enforceQuota()
  return captures.length
}
