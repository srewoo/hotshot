import { describe, expect, test, vi } from 'vitest'
import {
  compressionLadder,
  describeStep,
  extensionFor,
  fitWithinBytes,
  mimeFor,
  type EncodeStep,
} from './export-plan'

describe('the compression ladder', () => {
  const ladder = compressionLadder()

  test('starts lossless and full size, so nothing is given up unnecessarily', () => {
    expect(ladder[0]).toEqual({ format: 'png', scale: 1 })
  })

  test('trades colour fidelity before resolution', () => {
    const firstScaled = ladder.findIndex((step) => step.scale < 1)
    const firstLossy = ladder.findIndex((step) => step.format === 'jpeg')
    // A screenshot of a stack trace survives JPEG at 0.92; it does not survive
    // being halved.
    expect(firstLossy).toBeLessThan(firstScaled)
  })

  test('never increases the size along the way', () => {
    // A monotone ladder is what makes "first step that fits" correct: with a
    // step that grew, the search could stop at a larger file than a later one.
    const cost = (step: EncodeStep) => step.scale * (step.quality ?? 1)
    for (let i = 1; i < ladder.length; i++) {
      expect(cost(ladder[i] as EncodeStep)).toBeLessThanOrEqual(cost(ladder[i - 1] as EncodeStep))
    }
  })

  test('every lossy step carries a quality, and no lossless step does', () => {
    for (const step of ladder) {
      if (step.format === 'jpeg') {
        expect(step.quality).toBeGreaterThan(0)
        expect(step.quality).toBeLessThanOrEqual(1)
      } else {
        expect(step.quality).toBeUndefined()
      }
    }
  })

  test('stays legible: never scales below a third', () => {
    for (const step of ladder) expect(step.scale).toBeGreaterThanOrEqual(0.35)
  })
})

describe('mimeFor and extensionFor', () => {
  test('map both formats', () => {
    expect(mimeFor('png')).toBe('image/png')
    expect(mimeFor('jpeg')).toBe('image/jpeg')
    expect(extensionFor('png')).toBe('.png')
    // `.jpg`, not `.jpeg`: it is what every other tool writes.
    expect(extensionFor('jpeg')).toBe('.jpg')
  })
})

describe('describeStep', () => {
  test('says nothing when nothing was given up', () => {
    expect(describeStep({ format: 'png', scale: 1 })).toBeNull()
  })

  test('names a format change', () => {
    expect(describeStep({ format: 'jpeg', quality: 0.92, scale: 1 })).toBe('converted to JPG')
  })

  test('names a scale change', () => {
    expect(describeStep({ format: 'png', scale: 0.5 })).toBe('scaled to 50%')
  })

  test('names both when both happened', () => {
    expect(describeStep({ format: 'jpeg', quality: 0.7, scale: 0.75 })).toBe(
      'converted to JPG and scaled to 75%',
    )
  })
})

describe('fitWithinBytes', () => {
  /** A measurer where size falls with quality and with area. */
  const sizes = (base: number) => async (step: EncodeStep) =>
    Math.round(base * step.scale * step.scale * (step.format === 'png' ? 1 : (step.quality ?? 1) * 0.4))

  test('keeps PNG when the capture already fits', async () => {
    const outcome = await fitWithinBytes(10_000_000, sizes(2_000_000))
    expect(outcome?.step).toEqual({ format: 'png', scale: 1 })
    expect(outcome?.note, 'a lossless fit must not warn about anything').toBeNull()
  })

  test('converts to JPG when PNG is too large, and says so', async () => {
    // 30 MB PNG, ~11 MB at q0.92, ~9.6 MB at q0.8 — against a 10 MB limit.
    const outcome = await fitWithinBytes(10_000_000, sizes(30_000_000))
    expect(outcome?.step.format).toBe('jpeg')
    expect(outcome?.note).toContain('JPG')
  })

  test('scales down only when quality alone cannot get there', async () => {
    const outcome = await fitWithinBytes(2_000_000, sizes(60_000_000))
    expect(outcome?.step.scale).toBeLessThan(1)
    expect(outcome?.note).toContain('scaled')
  })

  test('stops at the FIRST step that fits, rather than the smallest', async () => {
    const measure = vi.fn(sizes(30_000_000))
    const outcome = await fitWithinBytes(10_000_000, measure)
    const ladder = compressionLadder()
    const index = ladder.findIndex(
      (step) => step.format === outcome?.step.format && step.quality === outcome?.step.quality,
    )
    // One call per step up to and including the one chosen, and no more.
    expect(measure).toHaveBeenCalledTimes(index + 1)
  })

  test('returns null when even the last step is too big', async () => {
    // A capture nothing on the ladder can rescue: the caller must say so
    // rather than ship a file the service will reject anyway.
    expect(await fitWithinBytes(1_000, sizes(500_000_000))).toBeNull()
  })

  test('a limit exactly equal to the encoded size counts as fitting', async () => {
    const outcome = await fitWithinBytes(1_000, async () => 1_000)
    expect(outcome?.step.format).toBe('png')
  })

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses a nonsense limit (%s) rather than looping',
    async (limit) => {
      await expect(fitWithinBytes(limit, async () => 1)).rejects.toThrow(RangeError)
    },
  )

  test('accepts a caller-supplied ladder, which is how a test pins behaviour', async () => {
    const outcome = await fitWithinBytes(
      100,
      async (step) => (step.scale === 1 ? 500 : 50),
      [
        { format: 'png', scale: 1 },
        { format: 'png', scale: 0.5 },
      ],
    )
    expect(outcome?.step.scale).toBe(0.5)
  })
})
