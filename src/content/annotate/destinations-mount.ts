import { buildDestinationBar, type DestinationBar, type SearchOutcome } from './destination-bar'
import type { ProviderId } from '../../storage/token-repo'

/**
 * Builds the destination strip from whatever the worker says is configured.
 *
 * Kept separate from the editor so the editor stays about drawing: the strip
 * needs a round-trip to the worker (which owns tokens) before it can render.
 */
export async function mountDestinations(
  root: ShadowRoot,
  handlers: { onSend: (id: ProviderId, key: string) => void },
): Promise<DestinationBar> {
  const state = (await chrome.runtime.sendMessage({ kind: 'destinations/list' })) as
    | { configured?: ProviderId[]; remembered?: Partial<Record<ProviderId, string>> }
    | undefined

  const bar = buildDestinationBar(state?.configured ?? [], state?.remembered ?? {}, {
    onSend: (id, key) => {
      if (!key) {
        bar.setStatus('Choose a target, or paste an id.', 'error')
        bar.focusKey()
        return
      }
      handlers.onSend(id, key)
    },

    /**
     * FR-41's search, routed through the worker because only it holds tokens.
     * A transport failure is reported as a search failure rather than thrown:
     * the picker degrades to id entry and says so.
     */
    onSearch: async (id, query) => {
      try {
        const reply = (await chrome.runtime.sendMessage({
          kind: 'destinations/search',
          provider: id,
          query,
        })) as SearchOutcome | undefined
        return reply ?? { ok: false, candidates: [], message: 'No answer from Hotshot.' }
      } catch {
        return { ok: false, candidates: [], message: 'Could not search — paste an id instead.' }
      }
    },
  })

  root.append(bar.element)
  return bar
}
