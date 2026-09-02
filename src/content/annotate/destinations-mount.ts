import { buildDestinationBar, type DestinationBar } from './destination-bar'
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

  const bar = buildDestinationBar(
    state?.configured ?? [],
    state?.remembered ?? {},
    (id, key) => {
      if (!key) {
        bar.setStatus('Enter a key first.', 'error')
        bar.focusKey()
        return
      }
      handlers.onSend(id, key)
    },
  )

  root.append(bar.element)
  return bar
}
