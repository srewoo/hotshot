import { describe, expect, test } from 'vitest'
import { buildAutoContext, renderTitle, type CaptureFacts } from './capture-context'
import { DEFAULT_SETTINGS } from '../storage/settings-repo'

/** PRD FR-17 (auto-context) and FR-18 (title templates). */

const facts: CaptureFacts = {
  url: 'https://example.com/orders/412?tab=items',
  title: 'Order 412 — Acme',
  viewportWidth: 1280,
  viewportHeight: 800,
  devicePixelRatio: 2,
  userAgent: 'Mozilla/5.0 (Macintosh) Chrome/140',
  capturedAt: new Date(Date.UTC(2026, 8, 2, 14, 30, 5)),
}

describe('buildAutoContext', () => {
  test('includes the enabled fields', () => {
    const lines = buildAutoContext(facts, DEFAULT_SETTINGS.autoContext)
    const joined = lines.join('\n')

    expect(joined).toContain('https://example.com/orders/412?tab=items')
    expect(joined).toContain('Order 412 — Acme')
    expect(joined).toContain('1280×800')
    expect(joined).toContain('2')
  })

  test('omits the user agent by default', () => {
    // FR-17: PII-adjacent, so it is opt-in.
    const joined = buildAutoContext(facts, DEFAULT_SETTINGS.autoContext).join('\n')
    expect(joined).not.toContain('Mozilla')
  })

  test('includes the user agent when the user opts in', () => {
    const joined = buildAutoContext(facts, {
      ...DEFAULT_SETTINGS.autoContext,
      userAgent: true,
    }).join('\n')
    expect(joined).toContain('Mozilla/5.0 (Macintosh) Chrome/140')
  })

  test('emits nothing when every field is disabled', () => {
    const off = {
      url: false,
      title: false,
      viewport: false,
      devicePixelRatio: false,
      timestamp: false,
      userAgent: false,
    }
    expect(buildAutoContext(facts, off)).toEqual([])
  })

  test('respects each toggle independently', () => {
    const lines = buildAutoContext(facts, {
      ...DEFAULT_SETTINGS.autoContext,
      title: false,
      viewport: false,
    })
    const joined = lines.join('\n')
    expect(joined).toContain('https://example.com')
    expect(joined).not.toContain('Order 412')
    expect(joined).not.toContain('1280')
  })

  test('formats the timestamp as ISO 8601, which sorts and parses anywhere', () => {
    const joined = buildAutoContext(facts, DEFAULT_SETTINGS.autoContext).join('\n')
    expect(joined).toContain('2026-09-02T14:30:05')
  })
})

describe('renderTitle', () => {
  test('applies the default template', () => {
    expect(renderTitle(DEFAULT_SETTINGS.titleTemplate, facts)).toBe('Order 412 — Acme — 2026-09-02')
  })

  test('substitutes every supported token', () => {
    expect(renderTitle('{title} | {host} | {date} {time}', facts)).toBe(
      'Order 412 — Acme | example.com | 2026-09-02 14:30:05',
    )
  })

  test('supports the full url token', () => {
    expect(renderTitle('{url}', facts)).toBe('https://example.com/orders/412?tab=items')
  })

  test('leaves an unknown token visible rather than emitting a gap', () => {
    expect(renderTitle('x {nope} y', facts)).toBe('x {nope} y')
  })

  test('falls back when the page has no title', () => {
    // An untitled page would otherwise produce a ticket called " — 2026-09-02".
    const untitled = { ...facts, title: '' }
    expect(renderTitle('{title} — {date}', untitled)).toBe('example.com — 2026-09-02')
  })

  test('collapses whitespace left by an empty substitution', () => {
    expect(renderTitle('{title}   {date}', facts)).toBe('Order 412 — Acme 2026-09-02')
  })

  test('trims the result', () => {
    expect(renderTitle('  {date}  ', facts)).toBe('2026-09-02')
  })

  test('never returns an empty title', () => {
    expect(renderTitle('{nothing}', { ...facts, title: '' }).length).toBeGreaterThan(0)
  })
})
