import { z } from 'zod'
import type { StorageArea } from './token-repo'

/**
 * User settings (PRD FR-17, FR-24, FR-26).
 *
 * Stored data is validated on every read. An older extension version, a
 * hand-edited profile, or a partially-written record can put anything here,
 * and falling back to defaults beats crashing on every capture.
 */

const KEY = 'hotshot.settings'

export const settingsSchema = z.object({
  defaultMode: z.enum(['region', 'fullpage', 'element']),
  defaultDestination: z.enum(['clipboard', 'download', 'jira', 'notion', 'clickup']),
  retention: z.enum(['session', '7d', '30d']),
  filenameTemplate: z.string().min(1),
  titleTemplate: z.string().min(1),
  /** FR-17: each field individually toggleable. */
  autoContext: z.object({
    url: z.boolean(),
    title: z.boolean(),
    viewport: z.boolean(),
    devicePixelRatio: z.boolean(),
    timestamp: z.boolean(),
    userAgent: z.boolean(),
  }),
  anonymousStats: z.boolean(),
})

export type Settings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  defaultMode: 'region',
  defaultDestination: 'clipboard',
  retention: '7d',
  filenameTemplate: '{host}-{date}-{time}',
  titleTemplate: '{title} — {date}',
  autoContext: {
    url: true,
    title: true,
    viewport: true,
    devicePixelRatio: true,
    timestamp: true,
    // PII-adjacent in some organisations, so this is the one opt-in field.
    userAgent: false,
  },
  // PRD §9: default-off is the entire basis of the privacy claim. Turning
  // this on must always be a deliberate act by the user.
  anonymousStats: false,
}

export interface SettingsRepo {
  read(): Promise<Settings>
  update(patch: Partial<Settings>): Promise<void>
}

export function createSettingsRepo(area: StorageArea): SettingsRepo {
  async function read(): Promise<Settings> {
    const stored = await area.get([KEY])
    const parsed = settingsSchema.safeParse(stored[KEY])
    return parsed.success ? parsed.data : DEFAULT_SETTINGS
  }

  return {
    read,
    async update(patch) {
      const current = await read()
      await area.set({ [KEY]: { ...current, ...patch } })
    },
  }
}
