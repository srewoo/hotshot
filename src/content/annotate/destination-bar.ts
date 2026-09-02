import { el, TOKENS } from '../overlay/overlay-chrome'
import type { ProviderId } from '../../storage/token-repo'

/**
 * The destination strip (PRD FR-13, FR-41, DESIGN §3.4).
 *
 * Appears under the toolbar with the remembered target pre-filled and the key
 * field focused, so the common case is type-nothing-and-press-Enter. Bare
 * letters are deliberately NOT bound here (FR-44) — the commit ladder owns
 * them, which is what stops `c` and `n` colliding with the annotation tools.
 */

export interface DestinationSpec {
  readonly id: ProviderId
  readonly label: string
  readonly placeholder: string
}

export const DESTINATIONS: readonly DestinationSpec[] = [
  { id: 'jira', label: 'Jira', placeholder: 'Issue key, e.g. ABC-412' },
  { id: 'clickup', label: 'ClickUp', placeholder: 'Task ID' },
  { id: 'notion', label: 'Notion', placeholder: 'Page ID' },
]

export interface DestinationBar {
  readonly element: HTMLDivElement
  focusKey(): void
  setStatus(message: string, tone: 'idle' | 'busy' | 'ok' | 'error'): void
}

export function buildDestinationBar(
  configured: readonly ProviderId[],
  remembered: Partial<Record<ProviderId, string>>,
  onSend: (id: ProviderId, key: string) => void,
): DestinationBar {
  const bar = el('div', {
    position: 'fixed',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px',
    borderRadius: '4px',
    background: TOKENS.graphite950,
    boxShadow: `0 0 0 1px ${TOKENS.ruleOuter}, 0 6px 16px rgba(0,0,0,.28)`,
    zIndex: '3',
  })

  const status = el('span', {
    font: `400 11px/1 ${TOKENS.sans}`,
    color: TOKENS.graphite25,
    padding: '0 4px',
    whiteSpace: 'nowrap',
  })

  if (configured.length === 0) {
    // The zero-integration case is the MODAL one (PRD §9 forecasts ~75%), so
    // it gets a real sentence rather than an empty row.
    status.textContent = 'No services connected — copy, download and pin still work.'
    bar.append(status)
    return { element: bar, focusKey: () => {}, setStatus: () => {} }
  }

  let active: ProviderId = configured[0] as ProviderId

  const input = el('input', {
    font: `400 12px/1 ${TOKENS.mono}`,
    color: TOKENS.graphite25,
    background: 'transparent',
    border: `1px solid ${TOKENS.ruleOuter}`,
    borderRadius: '3px',
    padding: '6px 8px',
    width: '180px',
  }) as HTMLInputElement

  function selectService(id: ProviderId): void {
    active = id
    const spec = DESTINATIONS.find((d) => d.id === id)
    input.placeholder = spec?.placeholder ?? ''
    // FR-19: the remembered target is pre-filled, not merely offered.
    input.value = remembered[id] ?? ''
    for (const [candidate, button] of buttons) {
      button.style.background = candidate === id ? TOKENS.flare : 'transparent'
      button.style.color = candidate === id ? '#FFFFFF' : TOKENS.graphite25
    }
  }

  const buttons = new Map<ProviderId, HTMLButtonElement>()
  for (const spec of DESTINATIONS) {
    if (!configured.includes(spec.id)) continue
    const button = el('button', {
      font: `500 12px/1 ${TOKENS.sans}`,
      color: TOKENS.graphite25,
      background: 'transparent',
      border: '0',
      borderRadius: '3px',
      padding: '7px 9px',
      cursor: 'pointer',
    })
    button.type = 'button'
    button.textContent = spec.label
    button.addEventListener('click', () => selectService(spec.id))
    buttons.set(spec.id, button)
    bar.append(button)
  }

  bar.append(input)

  const send = el('button', {
    font: `500 12px/1 ${TOKENS.sans}`,
    color: '#FFFFFF',
    background: TOKENS.flare,
    border: '0',
    borderRadius: '3px',
    padding: '7px 11px',
    cursor: 'pointer',
  })
  send.type = 'button'
  send.textContent = 'Send'
  send.addEventListener('click', () => onSend(active, input.value.trim()))
  bar.append(send, status)

  input.addEventListener('keydown', (event) => {
    // Enter inside the field sends; it must not fall through to the editor's
    // own Enter, which downloads.
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      onSend(active, input.value.trim())
    }
  })

  selectService(active)

  return {
    element: bar,
    focusKey: () => input.focus(),
    setStatus(message, tone) {
      status.textContent = message
      status.style.color =
        tone === 'error' ? '#F2604C' : tone === 'ok' ? '#3FA46A' : TOKENS.graphite25
    },
  }
}
