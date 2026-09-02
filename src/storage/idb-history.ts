import type { HistoryEntry, HistoryStore } from './history-repo'

/**
 * IndexedDB backing for capture history (PRD FR-25).
 *
 * Blobs stay compressed on disk and are read one at a time; only thumbnails
 * decode eagerly. That is what keeps the 20-capture cap inside the memory
 * budget in PRD §6.
 */

const DB_NAME = 'hotshot'
const STORE = 'captures'
const VERSION = 1

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the capture store.'))
  })
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('The capture store rejected a request.'))
  })
}

export interface StoredCapture extends HistoryEntry {
  readonly blob: Blob
}

export function idbHistoryStore(): HistoryStore & {
  blobFor(id: string): Promise<Blob | null>
  putWithBlob(entry: StoredCapture): Promise<void>
} {
  return {
    async put(entry) {
      const db = await open()
      const tx = db.transaction(STORE, 'readwrite')
      await promisify(tx.objectStore(STORE).put(entry))
      db.close()
    },

    async putWithBlob(entry) {
      const db = await open()
      const tx = db.transaction(STORE, 'readwrite')
      await promisify(tx.objectStore(STORE).put(entry))
      db.close()
    },

    async all() {
      const db = await open()
      const tx = db.transaction(STORE, 'readonly')
      const rows = await promisify(tx.objectStore(STORE).getAll() as IDBRequest<StoredCapture[]>)
      db.close()
      // The blob is deliberately dropped here: listing must not decode 20
      // images to render a table of 20 rows.
      return rows.map(({ blob: _blob, ...entry }) => entry)
    },

    async blobFor(id) {
      const db = await open()
      const tx = db.transaction(STORE, 'readonly')
      const row = await promisify(tx.objectStore(STORE).get(id) as IDBRequest<StoredCapture | undefined>)
      db.close()
      return row?.blob ?? null
    },

    async delete(ids) {
      const db = await open()
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      await Promise.all(ids.map((id) => promisify(store.delete(id))))
      db.close()
    },
  }
}
