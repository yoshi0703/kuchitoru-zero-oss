import { expect, test } from './fixtures'
test('app shell renders the Kuchitoru Zero product without a framework overlay', async ({
  localRuntime,
  page,
}) => {
  expect(localRuntime).toBe(true)
  const response = await page.goto('/')

  expect(response?.ok()).toBe(true)
  await expect(page).toHaveTitle(/クチトルZero/)
  await expect(page.locator('body')).not.toHaveText(/^\s*$/)
  await expect(page.getByText('Get started', { exact: true })).toHaveCount(0)
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
})
