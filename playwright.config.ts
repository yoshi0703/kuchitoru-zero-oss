import os from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const host = '127.0.0.1'
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173)
const baseURL = `http://${host}:${port}`
const artifactRoot =
  process.env.PLAYWRIGHT_OUTPUT_DIR ??
  path.join(os.tmpdir(), 'kuchitoru-playwright')

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  outputDir: path.join(artifactRoot, 'test-results'),
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  reporter: process.env.CI
    ? [['list']]
    : [['list'], ['html', { open: 'never', outputFolder: path.join(artifactRoot, 'report') }]],
  retries: process.env.CI ? 2 : 0,
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL,
    locale: 'ja-JP',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `corepack pnpm dev --host ${host} --port ${port}`,
    env: {
      ...process.env,
      VITE_APP_ORIGIN: baseURL,
      VITE_E2E_TEST_MODE: '1',
      VITE_SUPABASE_PUBLISHABLE_KEY:
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_e2e_fixture',
      VITE_SUPABASE_URL:
        process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:56321',
      VITE_TURNSTILE_SITE_KEY:
        process.env.VITE_TURNSTILE_SITE_KEY ?? 'turnstile_e2e_fixture',
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: baseURL,
  },
  ...(process.env.CI ? { workers: 1 } : {}),
})
