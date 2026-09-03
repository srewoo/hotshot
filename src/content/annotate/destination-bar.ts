import { el, TOKENS } from '../overlay/overlay-chrome'
import type { ProviderId } from '../../storage/token-repo'
import { buildTargetPicker } from './target-picker'
import type { TargetCandidate } from '../../integrations/provider'

/**
 * The destination strip (PRD FR-13, FR-41, DESIGN §3.4).
 *
 * Appears under the toolbar with the remembered target pre-filled and the key
 * field focused, so the common case is type-nothing-and-press-Enter. Bare
 * letters are deliberately NOT bound here (FR-44) — the commit ladder owns
 * them, which is what stops `c` and `n` colliding with the annotation tools.
 *
 * The field is backed by a type-ahead list of real targets (FR-41). Typing an
 * id still works and is still the fastest path for someone who knows it; the
 * list is for everyone else, who would otherwise switch to Jira to look one
 * up — the app switch §8 claims to remove.
 */

export interface DestinationSpec {
  readonly id: ProviderId
  readonly label: string
  readonly placeholder: string
}

export const DESTINATIONS: readonly DestinationSpec[] = [
  // The placeholder describes SEARCHING, because that is the primary path;
  // the id is the escape hatch, mentioned second.
  { id: 'jira', label: 'Jira', placeholder: 'Search issues, or paste ABC-412' },
  { id: 'clickup', label: 'ClickUp', placeholder: 'Search tasks, or paste a task ID' },
  { id: 'notion', label: 'Notion', placeholder: 'Search pages, or paste a page id' },
  { id: 'linear', label: 'Linear', placeholder: 'Search issues, or paste an issue id' },
  { id: 'slack', label: 'Slack', placeholder: 'Search channels, or paste a channel ID' },
  { id: 'trello', label: 'Trello', placeholder: 'Search your cards, or paste a card id' },
  { id: 'asana', label: 'Asana', placeholder: 'Search your tasks, or paste a task gid' },
  // A folder, not an item — the capture becomes a file inside it.
  { id: 'dropbox', label: 'Dropbox', placeholder: 'Choose a folder, or paste a path' },
]

export interface DestinationBar {
  readonly element: HTMLDivElement
  focusKey(): void
  /** Closes the target list, e.g. once a ship succeeds. */
  hidePicker(): void
  /**
   * True while the search field has focus.
   *
   * The editor's keymap is a capture-phase listener on `window`, so it sees
   * keystrokes BEFORE this field and cannot be stopped by propagation. Without
   * this guard, typing "invoice" lost the `n` to the numbered-badge tool and
   * the `o` to the ellipse — the search box silently dropped letters.
   */
  isTyping(): boolean
  setStatus(message: string, tone: 'idle' | 'busy' | 'ok' | 'error'): void
}

export interface DestinationBarHandlers {
  onSend: (id: ProviderId, key: string) => void
  /** Asks the worker for targets. Absent in tests that only drive sending. */
  onSearch?: (id: ProviderId, query: string) => Promise<SearchOutcome>
}

export interface SearchOutcome {
  readonly ok: boolean
  readonly candidates: readonly TargetCandidate[]
  readonly message?: string | undefined
}

/** Long enough that typing does not fire a request per keystroke. */
const SEARCH_DEBOUNCE_MS = 220

export function buildDestinationBar(
  configured: readonly ProviderId[],
  remembered: Partial<Record<ProviderId, string>>,
  handlers: DestinationBarHandlers,
): DestinationBar {
  const { onSend, onSearch } = handlers
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
    return {
      element: bar,
      focusKey: () => {},
      hidePicker: () => {},
      isTyping: () => false,
      setStatus: () => {},
    }
  }

  let active: ProviderId = configured[0] as ProviderId
  // The bar is the picker's positioning context.
  bar.style.position = 'fixed'

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
    picker.hide()
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

  const picker = buildTargetPicker((candidate) => {
    // Choosing a target fills the field rather than sending immediately: the
    // user still sees what they are about to attach to, and can change their
    // mind without undoing a ship.
    input.value = candidate.key
    picker.hide()
    input.focus()
  })
  bar.append(picker.element, input)

  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let searchSeq = 0

  /**
   * Runs a search and shows the result.
   *
   * Out-of-order replies are discarded by sequence number: a slow request for
   * "AB" must not overwrite the fast one for "ABC" and leave the user looking
   * at results for a prefix they have already typed past.
   */
  async function runSearch(query: string): Promise<void> {
    if (!onSearch) return
    const seq = ++searchSeq
    picker.setBusy(true)
    const outcome = await onSearch(active, query)
    if (seq !== searchSeq) return
    picker.setBusy(false)

    if (!outcome.ok) {
      // A picker that cannot reach the service degrades to the id field, and
      // says so — it never silently shows nothing.
      picker.show([], outcome.message ?? 'Could not search — paste an id instead.')
      return
    }
    picker.show(
      outcome.candidates,
      query.trim()
        ? 'Nothing matched — paste an id instead.'
        : 'Nothing recent to show — paste an id instead.',
    )
  }

  function scheduleSearch(query: string): void {
    if (!onSearch) return
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => void runSearch(query), SEARCH_DEBOUNCE_MS)
  }

  input.addEventListener('input', () => scheduleSearch(input.value))
  let typing = false

  input.addEventListener('blur', () => {
    typing = false
  })

  input.addEventListener('focus', () => {
    typing = true
    // Selected, not cleared: the remembered key stays visible and Enter still
    // sends it, but the first keystroke starts a fresh search instead of
    // appending to an id nobody wanted to edit.
    input.select()
    // Deliberately an EMPTY query, not the field's contents. The field is
    // pre-filled with the remembered target (FR-19) and Enter already sends
    // it, so the list's job is to offer the alternatives — recently viewed and
    // assigned work. Searching for the pre-filled key would show one row the
    // user already has.
    if (!picker.visible) void runSearch('')
  })

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
    // Every key is stopped here: the editor's keymap is a capture-phase
    // listener on `window`, and typing a search must not switch tools.
    event.stopPropagation()

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const moved = picker.move(event.key === 'ArrowDown' ? 1 : -1)
      if (moved) {
        event.preventDefault()
        // Fills as you arrow, so the field always shows what Enter will send.
        input.value = moved.key
      }
      return
    }

    if (event.key === 'Escape' && picker.visible) {
      // Closes the list, not the editor: the capture is not being abandoned.
      event.preventDefault()
      picker.hide()
      return
    }

    // Enter inside the field sends; it must not fall through to the editor's
    // own Enter, which downloads.
    if (event.key === 'Enter') {
      event.preventDefault()
      const chosen = picker.active()
      picker.hide()
      onSend(active, (chosen?.key ?? input.value).trim())
    }
  })

  selectService(active)

  return {
    element: bar,
    focusKey: () => input.focus(),
    hidePicker: () => picker.hide(),
    isTyping: () => typing,
    setStatus(message, tone) {
      status.textContent = message
      status.style.color =
        tone === 'error' ? '#F2604C' : tone === 'ok' ? '#3FA46A' : TOKENS.graphite25
    },
  }
}
