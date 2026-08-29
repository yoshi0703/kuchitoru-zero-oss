import { expect, test } from './fixtures'

const STORE_ID = '22222222-2222-4222-8222-222222222222'
const dashboard = `/dashboard/stores/${STORE_ID}`
const workspace = `${dashboard}/meo/workspace`

const capabilities = {
  serverTime: '2026-08-11T00:00:00.000Z',
  features: [
    { key: 'review_reply', title: '口コミ返信', status: 'available', releaseAt: null, executionMode: 'owner_provider', reason: null },
    { key: 'meo_rank', title: '順位チェック', status: 'available', releaseAt: null, executionMode: 'owner_provider', reason: null },
    { key: 'gbp_insights', title: 'Googleマップ分析', status: 'available', releaseAt: null, executionMode: 'native', reason: null },
    { key: 'gbp_health', title: 'プロフィール診断', status: 'available', releaseAt: null, executionMode: 'native', reason: null },
    { key: 'instagram_to_gbp', title: 'Instagram投稿の再利用', status: 'available', releaseAt: null, executionMode: 'native', reason: null },
  ],
}

test.beforeEach(async ({ page }) => {
  let externalWritesEnabled = true
  await page.addInitScript(() => {
    window.localStorage.setItem('kuchitoru.locale', 'ja')
  })
  await page.route('**/runtime-config.js', async (route) => {
    await route.fulfill({
      body: 'window.__KUCHITORU_RUNTIME_CONFIG__ = {}',
      contentType: 'application/javascript',
      status: 200,
    })
  })
  await page.route(`**/functions/v1/owner-api/v2/stores/${STORE_ID}/feature-capabilities`, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { success: true, data: capabilities },
      status: 200,
    })
  })
  await page.route(`**/functions/v1/meo-api/v1/stores/${STORE_ID}/review-replies/draft`, async (route) => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().headers().authorization).toBe('Bearer e2e-owner-access-token')
    await route.fulfill({
      contentType: 'application/json',
      json: {
        success: true,
        data: {
          reply: '率直なご意見をありがとうございます。差し支えなければ、店舗へ詳しい状況をお知らせください。',
          source: 'template',
          requiresReview: true,
        },
      },
      status: 200,
    })
  })
  await page.route(`**/functions/v1/meo-api/v1/stores/${STORE_ID}/external-writes`, async (route) => {
    const request = route.request()
    if (request.method() === 'PATCH') {
      expect(request.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/u)
      const body = request.postDataJSON() as { enabled: boolean }
      expect(body).toEqual({ enabled: false })
      externalWritesEnabled = body.enabled
    } else {
      expect(request.method()).toBe('GET')
    }
    await route.fulfill({
      contentType: 'application/json',
      json: {
        success: true,
        data: { enabled: externalWritesEnabled, canManage: true, canExecute: true },
      },
      status: 200,
    })
  })
  await page.route(`**/functions/v1/meo-api/v1/stores/${STORE_ID}/connections`, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: { success: true, data: [] },
      status: 200,
    })
  })
  await page.route(`**/functions/v1/meo-api/v1/stores/${STORE_ID}/rank`, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        success: true,
        data: [{
          id: 'rank-e2e',
          keyword: '新宿 焼肉',
          target_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
          position: 8,
          competitor_positions: [{ place_id: 'ChIJcompetitor123', position: 3 }],
          source: 'owner_provider',
          observed_at: '2026-08-11T02:00:00.000Z',
          result_count: 100,
        }],
      },
      status: 200,
    })
  })
  await page.route(`**/functions/v1/meo-api/v1/stores/${STORE_ID}/insights`, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        success: true,
        data: [{
          id: 'insight-e2e',
          period_start: '2026-07-11',
          period_end: '2026-08-10',
          source: 'google_business',
          metrics: { searches: 120, views: 80, calls: 12, websiteClicks: 20, directionRequests: 15 },
          updated_at: '2026-08-11T02:00:00.000Z',
        }],
      },
      status: 200,
    })
  })
})

test('weekly MEO features are understandable and usable on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1159, height: 863 })
  await page.goto(`${dashboard}/meo/review-reply`)

  for (const name of ['口コミ返信', '順位チェック', 'Googleマップ分析', 'プロフィール診断', 'Instagram投稿の再利用']) {
    await expect(page.getByRole('link').filter({ hasText: name })).toBeVisible()
  }

  await page.getByLabel('お客様の口コミ').fill('待ち時間が長く、困りました。')
  await page.getByLabel('星の数').selectOption('2')
  await page.getByRole('button', { name: '返信案を作る' }).click()

  await expect(page.getByRole('heading', { name: '返信案ができました' })).toBeVisible()
  await expect(page.getByLabel('投稿前に、必ず内容を確認してください')).toHaveValue(/率直なご意見/)
  await expect(page.getByRole('button', { name: 'Googleへの返信準備をする' })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1159)
})

test('disabled external writes do not block copying a review reply draft', async ({ page }) => {
  const settingRoute = `**/functions/v1/meo-api/v1/stores/${STORE_ID}/external-writes`
  await page.unroute(settingRoute)
  await page.route(settingRoute, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        success: true,
        data: { enabled: false, canManage: true, canExecute: true },
      },
      status: 200,
    })
  })
  await page.goto(`${dashboard}/meo/review-reply`)

  await page.getByLabel('お客様の口コミ').fill('待ち時間が長く、困りました。')
  await page.getByRole('button', { name: '返信案を作る' }).click()

  await expect(page.getByRole('button', { name: '返信案をコピー' })).toBeEnabled()
  await expect(page.getByText('外部書き込みは無効です。')).toBeVisible()
  await expect(page.getByLabel('この内容をGoogleに投稿してよいことを確認しました')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Googleへの返信準備をする' })).toBeDisabled()
})

test('store administrators can change the external write setting', async ({ page }) => {
  await page.goto(`${dashboard}/connections`)

  const externalWrites = page.getByRole('switch', { name: 'Googleへの返信と投稿を許可' })
  await expect(externalWrites).toBeChecked()
  await expect(externalWrites).toBeEnabled()
  await externalWrites.click()

  await expect(externalWrites).not.toBeChecked()
  await expect(page.getByText('外部サービスへの書き込みを無効にしました。')).toBeVisible()
})

test('Zero MEO workspace keeps every page-level start line aligned on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1159, height: 863 })
  const pages = [
    { path: 'profile', heading: 'GBP店舗情報' },
    { path: 'reviews', heading: '口コミ受信箱' },
    { path: 'posts', heading: 'GBP投稿' },
    { path: 'performance', heading: '順位・インサイト' },
    { path: 'aio', heading: 'AIO・サイテーション' },
    { path: 'multistore', heading: '多店舗・権限' },
  ] as const

  for (const item of pages) {
    await page.goto(`${workspace}/${item.path}`)
    await expect(page.getByRole('heading', { name: item.heading, exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'MEO管理' })).toBeVisible()

    const startLines = await page.locator('.meo-workspace-page > [data-meo-workspace-align="start"]').evaluateAll((elements) => (
      elements.map((element) => Math.round(element.getBoundingClientRect().left))
    ))
    expect(startLines.length).toBeGreaterThanOrEqual(2)
    expect(new Set(startLines).size).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1159)
  }
})

test('Zero MEO profile saves locally and the mobile workspace does not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1159, height: 863 })
  await page.goto(`${workspace}/profile`)
  const businessName = page.getByLabel('店舗名（必須）')
  await expect(businessName).toHaveValue('みどりカフェ')
  await businessName.fill('みどりカフェ Zero')
  await page.getByRole('button', { name: '変更を保存' }).click()
  await expect(page.getByText('Zeroの店舗情報と新しいスナップショットを保存しました。')).toBeVisible()

  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto(`${workspace}/reviews`)
  await expect(page.getByRole('heading', { name: '口コミ受信箱', exact: true })).toBeVisible()
  await expect(page.getByText('落ち着いて過ごせました。')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)

  const startLines = await page.locator('.meo-workspace-page > [data-meo-workspace-align="start"]').evaluateAll((elements) => (
    elements.map((element) => Math.round(element.getBoundingClientRect().left))
  ))
  expect(startLines.length).toBeGreaterThanOrEqual(2)
  expect(new Set(startLines).size).toBe(1)
})

test('review reply flow fits a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto(`${dashboard}/meo/review-reply`)
  await expect(page.getByRole('heading', { name: '口コミ返信', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})

test('rank and Google insights histories stay readable on desktop and mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1159, height: 863 })
  await page.goto(`${dashboard}/meo/rank`)
  await expect(page.getByRole('heading', { name: '過去30日の順位' })).toBeVisible()
  await expect(page.getByText('8位')).toBeVisible()
  await expect(page.getByText('3位')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1159)

  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto(`${dashboard}/meo/insights`)
  await expect(page.getByRole('heading', { name: '保存した数字' })).toBeVisible()
  await expect(page.getByText('120回')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})
