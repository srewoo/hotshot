import type { Settings } from '../storage/settings-repo'

/**
 * Auto-captured context (PRD FR-17, Wedge 3) and ticket titles (FR-18).
 *
 * This is the cheapest of the three wedges and the one that saves a real
 * round-trip: a bug report that arrives with the repro URL already attached
 * does not need a follow-up asking where it happened.
 */

export interface CaptureFacts {
  readonly url: string
  readonly title: string
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly devicePixelRatio: number
  readonly userAgent: string
  readonly capturedAt: Date
}

export type AutoContextToggles = Settings['autoContext']

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** ISO 8601 to the second: it sorts lexically and parses everywhere. */
function isoSeconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '')
}

export function buildAutoContext(
  facts: CaptureFacts,
  toggles: AutoContextToggles,
): string[] {
  const lines: string[] = []
  if (toggles.url) lines.push(`URL: ${facts.url}`)
  if (toggles.title) lines.push(`Page: ${facts.title}`)
  if (toggles.viewport) {
    lines.push(`Viewport: ${facts.viewportWidth}×${facts.viewportHeight}`)
  }
  if (toggles.devicePixelRatio) lines.push(`Device pixel ratio: ${facts.devicePixelRatio}`)
  if (toggles.timestamp) lines.push(`Captured: ${isoSeconds(facts.capturedAt)}`)
  // Last, and off by default: PII-adjacent in some organisations (FR-17).
  if (toggles.userAgent) lines.push(`User agent: ${facts.userAgent}`)
  return lines
}

export function renderTitle(template: string, facts: CaptureFacts): string {
  const iso = isoSeconds(facts.capturedAt)
  const [date = '', timePart = ''] = iso.split('T')

  const tokens: Record<string, string> = {
    // An untitled page would otherwise yield a ticket called " — 2026-09-02".
    title: facts.title.trim() || hostOf(facts.url),
    url: facts.url,
    host: hostOf(facts.url),
    date,
    time: timePart,
  }

  const rendered = template
    .replace(/\{(\w+)\}/g, (match, name: string) => tokens[name] ?? match)
    // An empty substitution otherwise leaves a double space or a dangling dash.
    .replace(/\s{2,}/g, ' ')
    .trim()

  return rendered.length > 0 ? rendered : tokens['host'] ?? 'Hotshot capture'
}
