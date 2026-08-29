import { expect, test } from './fixtures'

test.beforeEach(async ({ page }) => {
  await page.route('**/runtime-config.js', async (route) => {
    await route.fulfill({
      body: 'window.__KUCHITORU_RUNTIME_CONFIG__={}',
      contentType: 'application/javascript',
      status: 200,
    })
  })
  await page.addInitScript(() => {
    window.localStorage.setItem('kuchitoru.locale', 'ja')
  })
})

test.describe('password recovery', () => {
  test('owner can request a password reset without contacting a real auth service', async ({ page }) => {
    await page.goto('/forgot-password')

    await expect(page.getByRole('heading', { name: 'パスワードを再設定' })).toBeVisible()
    await page.getByLabel('メールアドレス').fill('owner@example.test')
    await page.getByRole('button', { name: '再設定メールを送る' }).click()
    await expect(page.getByText('メールを送信しました。届いたリンクからパスワードを再設定してください。')).toBeVisible()
  })

  test('owner can update a password in the local E2E recovery flow', async ({ page }) => {
    await page.goto('/auth/update-password?e2ePasswordRecovery=1')

    await expect(page.getByRole('heading', { name: '新しいパスワード' })).toBeVisible()
    await expect(page.getByText('8文字以上で、英大文字・英小文字・数字・記号をそれぞれ1文字以上含めてください。')).toBeVisible()
    await page.getByLabel('パスワード', { exact: true }).fill('New-password-123!')
    await page.getByRole('button', { name: 'パスワードを更新' }).click()
    await expect(page.getByText('パスワードを更新しました。管理画面へ進めます。')).toBeVisible()
    await expect(page.getByText(/再設定リンクの有効期限が切れているか/)).toHaveCount(0)
  })

  test('ordinary authenticated session cannot use the recovery form', async ({ page }) => {
    await page.goto('/auth/update-password')

    await expect(page.getByText(/再設定リンクの有効期限が切れているか/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'パスワードを更新' })).toHaveCount(0)
  })
})

test('legacy onboarding URL redirects to the dashboard', async ({ page }) => {
  await page.goto('/onboarding')
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: '店舗を選択' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'みどりカフェ' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'あおばカフェ' })).toBeVisible()
})
