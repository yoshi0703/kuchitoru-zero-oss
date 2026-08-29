import { expect, test as base } from '@playwright/test'

interface GuardFixtures {
  externalRequestAttempts: string[]
  localRuntime: boolean
  runtimeErrors: string[]
}

interface GuardOptions {
  stubLocalRuntime: boolean
}

const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost'])

function sanitizedRequestTarget(rawUrl: string) {
  const url = new URL(rawUrl)
  return `${url.origin}${url.pathname}`
}

export const test = base.extend<GuardFixtures & GuardOptions>({
  stubLocalRuntime: [true, { option: true }],
  externalRequestAttempts: [
    async ({ context }, use) => {
      const attempts = [] as string[]

      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url())
        if (
          (url.protocol === 'http:' || url.protocol === 'https:') &&
          !loopbackHosts.has(url.hostname)
        ) {
          attempts.push(sanitizedRequestTarget(url.href))
          await route.fulfill({
            body: 'External network access is disabled by the E2E harness',
            contentType: 'text/plain',
            status: 418,
          })
          return
        }

        await route.continue()
      })

      await use(attempts)
      expect(attempts, 'E2E tests must not contact real external services').toEqual(
        [],
      )
    },
    { auto: true },
  ],
  localRuntime: [
    async ({ page, stubLocalRuntime }, use) => {
      if (stubLocalRuntime) {
        await page.route('**/runtime-config.js', async (route) => {
          await route.fulfill({
            body: 'window.__KUCHITORU_RUNTIME_CONFIG__ = {}',
            contentType: 'application/javascript',
            status: 200,
          })
        })
        await page.route('**/functions/v1/owner-api/v2/stores/*/feature-capabilities', async (route) => {
          await route.fulfill({
            contentType: 'application/json',
            json: {
              success: true,
              data: {
                serverTime: '2026-08-11T00:00:00.000Z',
                features: [],
              },
            },
            status: 200,
          })
        })
      }

      await use(stubLocalRuntime)
    },
    { auto: true },
  ],
  runtimeErrors: [
    async ({ page }, use) => {
      const errors = [] as string[]
      page.on('console', (message) => {
        if (message.type() === 'error') {
          errors.push(message.text())
        }
      })
      page.on('pageerror', (error) => errors.push(error.message))

      await use(errors)
      expect(errors, 'The browser must not emit runtime errors').toEqual([])
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'
