import type { HistoryEntry } from '../../storage/history-repo'
import type { ExportedLibrary } from '../../worker/library'

/**
 * The library page's view of the worker (PRD FR-25).
 *
 * Every operation is a message, because the worker owns IndexedDB — a content
 * script on an arbitrary page must never be able to read capture history, and
 * routing the library page the same way means there is only one door to guard.
 *
 * Failures are returned, never thrown: this page's job is to keep working when
 * one capture cannot be read.
 */

type Reply = { ok?: boolean; message?: string } & Record<string, unknown>

async function send(kind: string, payload: Record<string, unknown> = {}): Promise<Reply> {
  try {
    const reply = (await chrome.runtime.sendMessage({ kind, ...payload })) as Reply | undefined
    return reply ?? { ok: false, message: 'Hotshot did not answer.' }
  } catch (error: unknown) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Hotshot could not be reached.',
    }
  }
}

export const libraryApi = {
  async list(): Promise<readonly HistoryEntry[]> {
    const reply = await send('library/list')
    return Array.isArray(reply.entries) ? (reply.entries as HistoryEntry[]) : []
  },

  async read(id: string): Promise<string | null> {
    const reply = await send('library/read', { id })
    return typeof reply.dataUrl === 'string' ? reply.dataUrl : null
  },

  async toggleFavourite(id: string): Promise<void> {
    await send('library/favourite', { id })
  },

  async tag(id: string, tag: string, add: boolean): Promise<void> {
    await send('library/tag', { id, tag, add })
  },

  async remove(ids: readonly string[]): Promise<number> {
    const reply = await send('library/delete', { ids })
    return typeof reply.removed === 'number' ? reply.removed : 0
  },

  async undoRemove(): Promise<number> {
    const reply = await send('library/undo-delete')
    return typeof reply.restored === 'number' ? reply.restored : 0
  },

  async clear(): Promise<void> {
    await send('library/clear')
  },

  async exportAll(): Promise<ExportedLibrary | null> {
    const reply = await send('library/export')
    return (reply.document as ExportedLibrary | undefined) ?? null
  },

  async importAll(document: unknown): Promise<number> {
    const reply = await send('library/import', { document })
    return typeof reply.imported === 'number' ? reply.imported : 0
  },

  /** Opens a stored capture in the editor, on the active tab. */
  async reopen(id: string): Promise<string | null> {
    const reply = await send('library/reopen', { id })
    return reply.ok ? null : (reply.message ?? 'That capture could not be opened.')
  },

  /** Sends a stored capture to the destination it went to before. */
  async resend(id: string): Promise<string | null> {
    const reply = await send('library/resend', { id })
    return reply.ok ? null : (reply.message ?? 'That capture could not be sent.')
  },

  /** Pins a stored capture onto the active tab. */
  async pin(id: string): Promise<string | null> {
    const reply = await send('library/pin', { id })
    return reply.ok ? null : (reply.message ?? 'That capture could not be pinned.')
  },
}
