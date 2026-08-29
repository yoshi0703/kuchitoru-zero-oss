import os from 'node:os'
import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const host = '127.0.0.1'
const port = 4174
const baseURL = `http://${host}:${port}`
const apiUrl = requiredEnvironment('KUCHITORU_INTEGRATION_API_URL')
const edgeEnvironmentFile = requiredEnvironment(
  'KUCHITORU_INTEGRATION_EDGE_ENV_FILE',
)
const nonPrivilegedProcessEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
)
delete nonPrivilegedProcessEnvironment.KUCHITORU_INTEGRATION_SECRET_KEY
delete nonPrivilegedProcessEnvironment.KUCHITORU_INTEGRATION_TURNSTILE_SECRET
delete nonPrivilegedProcessEnvironment.KUCHITORU_INTEGRATION_TURNSTILE_TOKEN
const turnstileMockEnvironment = {
  ...nonPrivilegedProcessEnvironment,
  KUCHITORU_INTEGRATION_TURNSTILE_SECRET: requiredEnvironment(
    'KUCHITORU_INTEGRATION_TURNSTILE_SECRET',
  ),
  KUCHITORU_INTEGRATION_TURNSTILE_TOKEN: requiredEnvironment(
    'KUCHITORU_INTEGRATION_TURNSTILE_TOKEN',
  ),
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required by the local integration harness`)
  return value
}

export default defineConfig({
  expect: { timeout: 10_000 },
  forbidOnly: true,
  fullyParallel: false,
  outputDir: path.join(os.tmpdir(), 'kuchitoru-playwright-integration'),
  projects: [
    {
      name: 'chromium-local-supabase',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  reporter: [['list']],
  retries: 0,
  testDir: './e2e',
  testMatch: '**/*.integration.ts',
  timeout: 45_000,
  use: {
    baseURL,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  webServer: [
    {
      command: 'node scripts/local-turnstile-siteverify-mock.mjs',
      env: turnstileMockEnvironment,
      reuseExistingServer: false,
      timeout: 30_000,
      url: 'http://127.0.0.1:4175/health',
    },
    {
      command: `corepack pnpm exec supabase functions serve --env-file ${JSON.stringify(edgeEnvironmentFile)}`,
      env: nonPrivilegedProcessEnvironment,
      reuseExistingServer: false,
      timeout: 120_000,
      // Playwright 1.61's bundled isURLAvailable accepts 200 <= status < 404;
      // the unauthenticated owner route therefore provides a credential-free 401 readiness probe.
      url: `${apiUrl}/functions/v1/owner-api/v2/stores`,
    },
    {
      command: `corepack pnpm dev --host ${host} --port ${port}`,
      env: {
        ...nonPrivilegedProcessEnvironment,
        VITE_APP_ORIGIN: baseURL,
        VITE_E2E_TEST_MODE: '',
        VITE_GOOGLE_AUTH_ENABLED: 'false',
        VITE_SUPABASE_PUBLISHABLE_KEY: requiredEnvironment(
          'KUCHITORU_INTEGRATION_PUBLISHABLE_KEY',
        ),
        VITE_SUPABASE_URL: apiUrl,
        VITE_TURNSTILE_SITE_KEY: 'integration-site-key',
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: baseURL,
    },
  ],
  workers: 1,
})
