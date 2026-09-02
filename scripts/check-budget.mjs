import { statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Enforces the size budgets in PRD §6. These are product commitments, not
 * guidelines: the content script is injected into every captured page, and
 * pulling a validation library into it once cost 54 KB of a 120 KB budget.
 */
const BUDGETS = [
  { label: 'content script', path: 'dist/content.js', limitKb: 120 },
  { label: 'total unpacked', path: 'dist', limitKb: 450 },
]

const sizeKb = (p) => {
  const s = statSync(p)
  if (!s.isDirectory()) return s.size / 1024
  let total = 0
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else total += statSync(full).size
    }
  }
  walk(p)
  return total / 1024
}

let failed = false
for (const { label, path, limitKb } of BUDGETS) {
  const actual = sizeKb(path)
  const pct = Math.round((actual / limitKb) * 100)
  const ok = actual <= limitKb
  if (!ok) failed = true
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(16)} ${actual.toFixed(1).padStart(7)} KB / ${limitKb} KB  (${pct}%)`,
  )
}

if (failed) {
  console.error('\nBudget exceeded. See PRD §6 — raise the budget deliberately or shrink the bundle.')
  process.exit(1)
}
