/**
 * Annotation history as a list of commands (PRD FR-10, review finding B4).
 *
 * Undo stores DESCRIPTIONS of marks, never canvas snapshots. Twenty raster
 * snapshots of a large capture is roughly 640 MB, which is how the original
 * memory budget became arithmetically impossible. A command is a few dozen
 * bytes, so the 20-level requirement costs nothing.
 *
 * History is modelled as an append-only log plus a cursor: every state the
 * user can reach is `log.slice(0, cursor)` replayed in order.
 */

export type AnnotationTool =
  | 'arrow'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'freehand'
  | 'text'
  | 'number'
  | 'highlight'
  | 'redact'

export interface AnnotationPoint {
  readonly x: number
  readonly y: number
}

export interface AnnotationCommand {
  readonly id: string
  readonly tool: AnnotationTool
  readonly color: string
  readonly weight: number
  readonly points: readonly AnnotationPoint[]
  readonly text?: string
}

/**
 * Deletions and edits are entries in the log too, so every change is undoable.
 *
 * `replace` is what makes a mark editable after it is drawn: moving, resizing
 * or recolouring rewrites one command in place rather than removing and
 * re-adding it, which would move the mark to the end of the list and renumber
 * every step badge after it (FR-8).
 */
type Entry =
  | { readonly op: 'add'; readonly command: AnnotationCommand }
  | { readonly op: 'replace'; readonly command: AnnotationCommand }
  | { readonly op: 'remove'; readonly id: string }

export interface CommandList {
  commands(): readonly AnnotationCommand[]
  push(command: AnnotationCommand): void
  /** Rewrites a mark in place, keeping its position in the draw order. */
  replace(command: AnnotationCommand): void
  remove(id: string): void
  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean
  /** FR-8: badge id → its 1-based number, recomputed from current state. */
  badgeNumbers(): Record<string, number>
}

export function createCommandList(): CommandList {
  const log: Entry[] = []
  let cursor = 0

  function materialise(): AnnotationCommand[] {
    const out: AnnotationCommand[] = []
    for (const entry of log.slice(0, cursor)) {
      if (entry.op === 'add') {
        out.push(entry.command)
      } else if (entry.op === 'replace') {
        const index = out.findIndex((c) => c.id === entry.command.id)
        // An edit to a mark that is no longer there is dropped, not appended:
        // undoing past a delete and redoing the edit must not resurrect it.
        if (index !== -1) out[index] = entry.command
      } else {
        const index = out.findIndex((c) => c.id === entry.id)
        if (index !== -1) out.splice(index, 1)
      }
    }
    return out
  }

  function record(entry: Entry): void {
    // A new action after undo discards the redo branch — branching history
    // surprises people, and every editor they already use behaves this way.
    log.length = cursor
    log.push(entry)
    cursor = log.length
  }

  return {
    commands: materialise,

    push(command) {
      record({ op: 'add', command })
    },

    replace(command) {
      record({ op: 'replace', command })
    },

    remove(id) {
      record({ op: 'remove', id })
    },

    undo() {
      if (cursor > 0) cursor--
    },

    redo() {
      if (cursor < log.length) cursor++
    },

    canUndo: () => cursor > 0,
    canRedo: () => cursor < log.length,

    /**
     * Numbers are derived, never stored. Storing them would mean updating
     * every later badge on each delete — the bug FR-8 exists to prevent, since
     * a gap in the sequence makes the screenshot wrong rather than untidy.
     */
    badgeNumbers() {
      const numbers: Record<string, number> = {}
      let next = 1
      for (const command of materialise()) {
        if (command.tool === 'number') numbers[command.id] = next++
      }
      return numbers
    },
  }
}
