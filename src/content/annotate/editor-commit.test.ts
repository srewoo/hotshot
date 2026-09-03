import { describe, expect, test } from 'vitest'
import { historyRecord } from './editor-commit'

/**
 * The history payload's shape, pinned.
 *
 * This exists because of a real defect: the capture was sent as an
 * `ArrayBuffer`, and `chrome.runtime.sendMessage` serialises through JSON
 * rather than the structured clone algorithm. The buffer arrived as `{}` and
 * `new Blob([{}])` wrote the string "[object Object]" — so every capture in
 * the library was eleven bytes of text that no image decoder could open, and
 * nothing noticed until something finally read one back.
 */

const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('historyRecord', () => {
  test('carries the capture as a data URL, which survives JSON', () => {
    const record = historyRecord(PNG, { width: 1_200, height: 800 }, { url: 'u', title: 't' })
    expect(record.dataUrl).toBe(PNG)
    expect(typeof record.dataUrl).toBe('string')
  })

  test('survives a JSON round trip unchanged, which is the whole point', () => {
    const record = historyRecord(PNG, { width: 10, height: 20 }, { url: 'u', title: 't' })
    expect(JSON.parse(JSON.stringify(record))).toEqual(record)
  })

  test('records the capture dimensions and its page', () => {
    const record = historyRecord(
      PNG,
      { width: 1_200, height: 800 },
      { url: 'https://acme.com/x', title: 'Invoice' },
    )
    expect(record).toMatchObject({
      kind: 'history/record',
      widthDevicePx: 1_200,
      heightDevicePx: 800,
      sourceUrl: 'https://acme.com/x',
      title: 'Invoice',
    })
  })

  test('has no field the worker does not expect', () => {
    const record = historyRecord(PNG, { width: 1, height: 1 }, { url: '', title: '' })
    expect(Object.keys(record).sort()).toEqual([
      'dataUrl',
      'heightDevicePx',
      'kind',
      'sourceUrl',
      'title',
      'widthDevicePx',
    ])
  })
})
