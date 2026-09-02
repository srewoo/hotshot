import { defineConfig } from '@playwright/test'

/**
 * Browser-level tests (Architecture §7).
 *
 * The three MV3 realms make traditional unit-testing of orchestration
 * low-value, so orchestration is verified end-to-end here and the LOGIC lives
 * in pure modules tested by vitest. These two suites are complementary, not
 * overlapping.
 */
export default defineConfig({
  testDir: './e2e',
  // An extension needs a real Chromium with a persistent profile, so these
  // cannot run in parallel against one another.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
})
