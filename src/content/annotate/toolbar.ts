import { el, TOKENS } from '../overlay/overlay-chrome'
import type { AnnotationTool } from './command-list'
import type { ExportKind } from './export-image'

/**
 * The annotation toolbar (DESIGN §3.2, PRD FR-7/FR-10/FR-11).
 *
 * Bindings follow DESIGN §7.2, the normative keymap — including the two
 * collisions the audit found: redact is `K` (not `R`, which is region mode),
 * and no bare letter is bound to a destination.
 */

export interface ToolSpec {
  readonly tool: AnnotationTool
  readonly key: string
  readonly code: string
  readonly label: string
  readonly glyph: string
}

export const TOOLS: readonly ToolSpec[] = [
  { tool: 'arrow', key: 'A', code: 'KeyA', label: 'Arrow', glyph: '↗' },
  { tool: 'line', key: 'L', code: 'KeyL', label: 'Line', glyph: '╱' },
  { tool: 'rect', key: 'R', code: 'KeyB', label: 'Rectangle', glyph: '▭' },
  { tool: 'ellipse', key: 'O', code: 'KeyO', label: 'Ellipse', glyph: '◯' },
  { tool: 'freehand', key: 'F', code: 'KeyF', label: 'Freehand', glyph: '∿' },
  { tool: 'text', key: 'T', code: 'KeyT', label: 'Text', glyph: 'T' },
  { tool: 'number', key: 'N', code: 'KeyN', label: 'Step badge', glyph: '①' },
  { tool: 'highlight', key: 'H', code: 'KeyH', label: 'Highlight', glyph: '▬' },
  // `K`, not `R`: region mode owns `R`, and a tool key must never depend on
  // which mode the user happens to be in.
  { tool: 'redact', key: 'K', code: 'KeyK', label: 'Redact', glyph: '▓' },
]

/** FR-11: six opinionated colours, keys 1–6. No picker — a picker is a mouse tax. */
export const PALETTE: readonly string[] = [
  '#FF5A00',
  '#C4321E',
  '#D9A400',
  '#3FA46A',
  '#1F6FEB',
  '#0E0E0D',
]

export const WEIGHTS: readonly number[] = [2, 4, 7]

/**
 * Export kinds offered on the bar (FR-39, "better export options").
 *
 * Three, not a menu: PNG for fidelity, JPG when a destination or a colleague
 * cares about bytes, PDF when the capture is a document — a long stitch that
 * someone is going to print or file.
 */
export const EXPORT_KINDS: ReadonlyArray<{ kind: ExportKind; label: string; title: string }> = [
  { kind: 'png', label: 'PNG', title: 'Lossless (⏎ downloads the selected kind)' },
  { kind: 'jpeg', label: 'JPG', title: 'Smaller file, slight quality loss' },
  { kind: 'pdf', label: 'PDF', title: 'Paged document — a long capture becomes several pages' },
]

export interface ToolbarState {
  tool: AnnotationTool
  color: string
  weight: number
  /** What ⏎ and the download button produce (FR-39). */
  exportKind: ExportKind
}

export interface Toolbar {
  readonly element: HTMLDivElement
  setTool(tool: AnnotationTool): void
  setColor(color: string): void
  setExportKind(kind: ExportKind): void
  position(selection: DOMRect, viewport: { width: number; height: number }): void
}

const TOOLBAR_HEIGHT = 40
const GAP = 8

export function buildToolbar(
  state: ToolbarState,
  onChange: (next: Partial<ToolbarState>) => void,
  onAction: (action: 'undo' | 'redo' | 'copy' | 'download' | 'pin') => void,
): Toolbar {
  const bar = el('div', {
    position: 'fixed',
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '4px',
    borderRadius: TOKENS.mono ? '4px' : '4px',
    background: TOKENS.graphite950,
    boxShadow: `0 0 0 1px ${TOKENS.ruleOuter}, 0 6px 16px rgba(0,0,0,.28)`,
    zIndex: '2',
  })

  const buttons = new Map<AnnotationTool, HTMLButtonElement>()

  function chip(label: string, title: string): HTMLButtonElement {
    const button = el('button', {
      width: '28px',
      height: '28px',
      display: 'grid',
      placeItems: 'center',
      border: '0',
      borderRadius: '3px',
      background: 'transparent',
      color: TOKENS.graphite25,
      font: `500 13px/1 ${TOKENS.sans}`,
      cursor: 'pointer',
    })
    button.textContent = label
    button.title = title
    button.type = 'button'
    return button
  }

  for (const spec of TOOLS) {
    const button = chip(spec.glyph, `${spec.label} (${spec.key})`)
    button.addEventListener('click', () => onChange({ tool: spec.tool }))
    buttons.set(spec.tool, button)
    bar.append(button)
  }

  const divider = () =>
    el('div', { width: '1px', height: '18px', background: TOKENS.ruleOuter, margin: '0 4px' })

  bar.append(divider())

  const swatches: HTMLButtonElement[] = []
  for (const [index, colour] of PALETTE.entries()) {
    const swatch = el('button', {
      width: '18px',
      height: '18px',
      margin: '0 1px',
      border: `1px solid ${TOKENS.ruleOuter}`,
      borderRadius: '3px',
      background: colour,
      cursor: 'pointer',
    })
    swatch.title = `${colour} (${index + 1})`
    swatch.type = 'button'
    swatch.addEventListener('click', () => onChange({ color: colour }))
    swatches.push(swatch)
    bar.append(swatch)
  }

  bar.append(divider())

  for (const [label, action, title] of [
    ['⌫', 'undo', 'Undo (⌘Z)'],
    ['⌦', 'redo', 'Redo (⇧⌘Z)'],
  ] as const) {
    const button = chip(label, title)
    button.addEventListener('click', () => onAction(action))
    bar.append(button)
  }

  bar.append(divider())

  const exportButtons = new Map<ExportKind, HTMLButtonElement>()
  for (const spec of EXPORT_KINDS) {
    const button = el('button', {
      height: '22px',
      padding: '0 6px',
      border: '0',
      borderRadius: '3px',
      background: 'transparent',
      color: TOKENS.graphite25,
      font: `500 10px/1 ${TOKENS.mono}`,
      cursor: 'pointer',
    })
    button.textContent = spec.label
    button.title = spec.title
    button.type = 'button'
    button.addEventListener('click', () => onChange({ exportKind: spec.kind }))
    exportButtons.set(spec.kind, button)
    bar.append(button)
  }

  function setExportKind(kind: ExportKind): void {
    for (const [key, button] of exportButtons) {
      const active = key === kind
      button.style.background = active ? TOKENS.flare : 'transparent'
      button.style.color = active ? '#FFFFFF' : TOKENS.graphite25
    }
  }

  bar.append(divider())

  // Destinations carry no bare letter (FR-44): the commit ladder owns them.
  for (const [label, action, title] of [
    ['⧉', 'copy', 'Copy (⇧⌘C)'],
    ['↓', 'download', 'Download (⏎)'],
    ['⊞', 'pin', 'Pin to page (⇧⌘⏎)'],
  ] as const) {
    const button = chip(label, title)
    button.addEventListener('click', () => onAction(action))
    bar.append(button)
  }

  function setTool(tool: AnnotationTool): void {
    for (const [key, button] of buttons) {
      const active = key === tool
      button.style.background = active ? TOKENS.flare : 'transparent'
      button.style.color = active ? '#FFFFFF' : TOKENS.graphite25
    }
  }

  function setColor(color: string): void {
    for (const [index, swatch] of swatches.entries()) {
      swatch.style.outline = PALETTE[index] === color ? `2px solid ${TOKENS.graphite25}` : 'none'
      swatch.style.outlineOffset = '1px'
    }
  }

  setTool(state.tool)
  setColor(state.color)
  setExportKind(state.exportKind)

  return {
    element: bar,
    setTool,
    setColor,
    setExportKind,
    /** Docks below the selection, flips above, and never covers it (DESIGN §3.2). */
    position(selection, viewport) {
      const below = selection.bottom + GAP
      const fitsBelow = below + TOOLBAR_HEIGHT <= viewport.height
      const top = fitsBelow ? below : Math.max(GAP, selection.top - TOOLBAR_HEIGHT - GAP)

      const width = bar.offsetWidth || 420
      const left = Math.min(Math.max(GAP, selection.left), viewport.width - width - GAP)

      bar.style.top = `${top}px`
      bar.style.left = `${left}px`
    },
  }
}
