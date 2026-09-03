import { el, TOKENS } from '../overlay/overlay-chrome'
import type { TargetCandidate } from '../../integrations/provider'

/**
 * The type-ahead target list (PRD FR-41).
 *
 * The field it hangs under used to be the whole feature: "type the issue key".
 * In practice nobody remembers `ABC-412`, so they switch to Jira to look it
 * up — one app switch, which is the exact cost the product exists to remove
 * and which the review called out as breaking §8's central claim.
 *
 * Raw ids still work. The field is the same field; this list is what appears
 * above it, and typing filters it instead of being the only way in.
 */

export interface TargetPicker {
  readonly element: HTMLDivElement
  /** Replaces the list. An empty list shows the reason, never a blank box. */
  show(candidates: readonly TargetCandidate[], emptyMessage: string): void
  /** Reports progress without clearing what is already on screen. */
  setBusy(busy: boolean): void
  hide(): void
  /** Moves the highlight. Returns the newly highlighted candidate, if any. */
  move(direction: 1 | -1): TargetCandidate | null
  /** The highlighted candidate, or null when nothing is highlighted. */
  active(): TargetCandidate | null
  readonly visible: boolean
}

const MAX_ROWS = 8

export function buildTargetPicker(onChoose: (candidate: TargetCandidate) => void): TargetPicker {
  const list = el('div', {
    position: 'absolute',
    left: '0',
    /**
     * Above the bar AND clear of the toolbar.
     *
     * Downwards would fall off screen — the bar is docked near the bottom.
     * Straight up covered the toolbar's palette and export buttons, so the
     * offset is the toolbar's height plus both gaps: a list that hides the
     * controls beside it is a list that has to be dismissed to work.
     */
    bottom: 'calc(100% + 48px)',
    minWidth: '320px',
    maxWidth: '520px',
    maxHeight: `${MAX_ROWS * 34}px`,
    overflowY: 'auto',
    padding: '4px',
    borderRadius: '4px',
    background: TOKENS.graphite950,
    boxShadow: `0 0 0 1px ${TOKENS.ruleOuter}, 0 8px 24px rgba(0,0,0,.36)`,
    display: 'none',
    zIndex: '5',
  })
  list.setAttribute('role', 'listbox')
  list.setAttribute('aria-label', 'Destination targets')

  const spinner = el('div', {
    padding: '8px 10px',
    font: `400 11px/1.3 ${TOKENS.sans}`,
    color: TOKENS.graphite400,
  })
  spinner.textContent = 'Searching…'

  let rows: Array<{ node: HTMLButtonElement; candidate: TargetCandidate }> = []
  let index = -1
  let shown = false
  let busy = false

  function paintHighlight(): void {
    for (const [i, row] of rows.entries()) {
      const on = i === index
      row.node.style.background = on ? 'rgba(255,90,0,0.22)' : 'transparent'
      row.node.setAttribute('aria-selected', on ? 'true' : 'false')
      if (on) row.node.scrollIntoView({ block: 'nearest' })
    }
  }

  function buildRow(candidate: TargetCandidate, position: number): HTMLButtonElement {
    const row = el('button', {
      display: 'block',
      width: '100%',
      textAlign: 'left',
      border: '0',
      borderRadius: '3px',
      background: 'transparent',
      padding: '6px 8px',
      cursor: 'pointer',
    })
    row.type = 'button'
    row.setAttribute('role', 'option')

    const title = el('div', {
      font: `500 12px/1.2 ${TOKENS.sans}`,
      color: TOKENS.graphite25,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    })
    title.textContent = candidate.title
    row.append(title)

    if (candidate.hint) {
      const hint = el('div', {
        font: `400 10px/1.2 ${TOKENS.mono}`,
        color: TOKENS.graphite400,
        marginTop: '2px',
      })
      hint.textContent = candidate.hint
      row.append(hint)
    }

    // `mousedown`, not `click`: the field has focus and a click would blur it
    // first, and the bar commits on blur.
    row.addEventListener('mousedown', (event) => {
      event.preventDefault()
      onChoose(candidate)
    })
    row.addEventListener('mouseenter', () => {
      index = position
      paintHighlight()
    })
    return row
  }

  return {
    element: list,
    get visible() {
      return shown
    },

    show(candidates, emptyMessage) {
      rows = []
      list.replaceChildren()

      if (candidates.length === 0) {
        const empty = el('div', {
          padding: '8px 10px',
          font: `400 11px/1.35 ${TOKENS.sans}`,
          color: TOKENS.graphite400,
        })
        // Always a sentence: an empty dropdown reads as a broken one, and the
        // useful thing to say is that the id still works.
        empty.textContent = emptyMessage
        list.append(empty)
      } else {
        for (const [position, candidate] of candidates.entries()) {
          const node = buildRow(candidate, position)
          rows.push({ node, candidate })
          list.append(node)
        }
      }

      if (busy) list.append(spinner)
      // Nothing is preselected: Enter must send what is in the field, so a
      // stray Enter can never ship to a target the user never looked at.
      index = -1
      shown = true
      list.style.display = 'block'
      paintHighlight()
    },

    setBusy(next) {
      busy = next
      if (next) {
        if (!spinner.isConnected) list.append(spinner)
      } else {
        spinner.remove()
      }
    },

    hide() {
      shown = false
      index = -1
      list.style.display = 'none'
    },

    move(direction) {
      if (!shown || rows.length === 0) return null
      // Clamped, not wrapping: arrowing past the end and reappearing at the
      // top loses the user's place in a list they are reading.
      index = Math.min(rows.length - 1, Math.max(0, index + direction))
      paintHighlight()
      return rows[index]?.candidate ?? null
    },

    active() {
      return rows[index]?.candidate ?? null
    },
  }
}
