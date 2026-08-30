import { expect, test } from './fixtures'
import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'

const STORE_ID = '22222222-2222-4222-8222-222222222222'
const SECOND_STORE_ID = '88888888-8888-4888-8888-888888888888'
const dashboard = `/dashboard/stores/${STORE_ID}`

async function openConfiguredDashboard(page: Page) {
  await page.goto(`${dashboard}/survey`)
  await page.getByLabel('アンケートの見出し').fill('E2E確認用アンケート')
  await page.getByRole('button', { name: '保存する' }).click()
  await expect(page.getByText('アンケート設定を保存しました。公開ページにも反映されます。')).toBeVisible()

  await page.locator(`a[href="${dashboard}"]:visible`).first().click()
  await expect(page).toHaveURL(dashboard)
  await expect(page.locator('.metrics-row')).toBeVisible()
}

test.describe('owner journey contract', () => {
  test('owner can reach the eight-item dashboard navigation', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: '店舗を選択' })).toBeVisible()
    await page.getByRole('link', { name: 'この店舗を管理' }).first().click()
    await expect(page).toHaveURL(dashboard)

    const sidebar = page.getByRole('complementary', { name: '店舗管理ナビゲーション' })
    for (const name of [
      'ホーム',
      'QR・共有リンク',
      'アンケート編集',
      '回答履歴',
      '月次サマリー',
      '店舗情報',
      '外部サービス接続',
      'AI接続',
    ]) {
      await expect(sidebar.getByRole('link', { name, exact: true })).toBeVisible()
    }
  })

  test('owner navigation is grouped by purpose on desktop', async ({ page }) => {
    await page.goto(`${dashboard}/ai`)

    const sidebar = page.getByRole('complementary', { name: '店舗管理ナビゲーション' })
    for (const [group, href] of [
      ['集める', `${dashboard}/collect`],
      ['分析', `${dashboard}/analyze`],
      ['設定', `${dashboard}/settings`],
    ]) {
      await expect(sidebar.getByRole('link', { name: group, exact: true })).toHaveAttribute('href', href)
    }
    await expect(sidebar.getByRole('link', { name: 'AI接続', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(sidebar.getByRole('link', { name: '設定', exact: true })).not.toHaveAttribute('aria-current', 'page')
    await expect(sidebar.getByRole('link', { name: '設定', exact: true })).toHaveClass(/owner-nav-group__label--current/)
    await expect(sidebar.getByRole('link', { name: 'アカウント' })).toHaveAttribute('href', '/account')
    await expect(page.locator('.account-trigger')).toBeVisible()

    await sidebar.getByRole('link', { name: '設定', exact: true }).click()
    await expect(page).toHaveURL(`${dashboard}/settings`)
    const settingsMenu = page.getByRole('navigation', { name: '設定メニュー' })
    for (const item of ['店舗情報', '外部サービス接続', 'AI接続', 'アカウント']) {
      await expect(settingsMenu.getByRole('link', { name: new RegExp(`^${item}`) })).toBeVisible()
    }
  })

  test('desktop owner layout keeps shared gutters and grid panels aligned', async ({ page }) => {
    await page.setViewportSize({ width: 1159, height: 863 })
    await openConfiguredDashboard(page)

    const sidebar = page.getByRole('complementary', { name: '店舗管理ナビゲーション' })
    await expect(sidebar).toBeVisible()
    expect((await sidebar.boundingBox())?.width).toBe(200)

    const alignedSidebarItems = [
      sidebar.locator('.owner-sidebar__head'),
      sidebar.locator('.owner-store-list-link'),
      sidebar.locator('.owner-nav-group__label').first(),
      sidebar.locator('.owner-nav-link').first(),
    ]
    const alignedLeftEdges = await Promise.all(alignedSidebarItems.map(async (item) => (await item.boundingBox())?.x))
    expect(new Set(alignedLeftEdges).size).toBe(1)

    const topbarTitleBox = await page.locator('.owner-topbar__title').boundingBox()
    const ownerPageBox = await page.locator('.owner-page').boundingBox()
    expect(topbarTitleBox).not.toBeNull()
    expect(ownerPageBox).not.toBeNull()
    if (topbarTitleBox && ownerPageBox) {
      expect(Math.abs(topbarTitleBox.x - ownerPageBox.x)).toBeLessThanOrEqual(1)
    }

    const topbarControlRects = await page.locator('.owner-store-switcher select, .account-trigger').evaluateAll((items) =>
      items.map((item) => {
        const rect = item.getBoundingClientRect()
        return { top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }
      }),
    )
    expect(topbarControlRects).toEqual([
      { top: 8, width: 220, height: 40 },
      { top: 8, width: 220, height: 40 },
    ])

    const statusChildren = page.locator('.status-band > *')
    await expect(statusChildren).toHaveCount(3)
    const statusTopEdges = await statusChildren.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top))
    expect(new Set(statusTopEdges).size).toBe(1)
    expect(await page.locator('.status-band').evaluate((item) => getComputedStyle(item).borderTopWidth)).toBe('1px')
    const recentPanelBox = await page.locator('.recent-panel').boundingBox()
    const statusBandBox = await page.locator('.status-band').boundingBox()
    expect(recentPanelBox).not.toBeNull()
    expect(statusBandBox).not.toBeNull()
    if (recentPanelBox && statusBandBox) expect(statusBandBox.y).toBeGreaterThan(recentPanelBox.y + recentPanelBox.height)
    const metricWidths = await page.locator('.metrics-row > div').evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().width)))
    expect(new Set(metricWidths).size).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1159)

    await page.goto(`${dashboard}/qr`)
    await expect(page.getByText('店頭や会計後に案内する公開URLです。')).toHaveCount(0)
    const qrPanels = page.locator('.qr-page-grid > .panel')
    await expect(qrPanels).toHaveCount(2)
    const qrTopEdges = await qrPanels.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top))
    expect(new Set(qrTopEdges).size).toBe(1)

    await page.goto(`${dashboard}/interviews/e2e`)
    const detailPanels = page.locator('.detail-grid > .panel')
    await expect(detailPanels).toHaveCount(2)
    const detailTopEdges = await detailPanels.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top))
    expect(new Set(detailTopEdges).size).toBe(1)

    await page.goto(`${dashboard}/summary`)
    const summaryOverviewPanels = page.locator('.monthly-summary-panel__overview > section')
    await expect(summaryOverviewPanels).toHaveCount(2)
    const summaryOverviewTopEdges = await summaryOverviewPanels.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top))
    expect(new Set(summaryOverviewTopEdges).size).toBe(1)
    const summaryDetailPanels = page.locator('.monthly-summary-panel__details > section')
    await expect(summaryDetailPanels).toHaveCount(2)
    const summaryDetailTopEdges = await summaryDetailPanels.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top))
    expect(new Set(summaryDetailTopEdges).size).toBe(1)

    await page.goto(`${dashboard}/survey`)
    await expect(page.getByText('設問の順番と数は固定したまま、設問ごとに複数の聞き方を設定できます。')).toHaveCount(0)
    const surveyLayout = await page.locator('.survey-editor-main, .survey-editor-preview-column').evaluateAll((items) =>
      items.map((item) => {
        const rect = item.getBoundingClientRect()
        return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }
      }),
    )
    expect(surveyLayout).toHaveLength(2)
    const [surveyAssistant, surveyPreview] = surveyLayout
    expect(surveyAssistant).toBeDefined()
    expect(surveyPreview).toBeDefined()
    if (surveyAssistant && surveyPreview) {
      expect(Math.abs(surveyPreview.top - surveyAssistant.top)).toBeLessThanOrEqual(1)
      expect(surveyPreview.left).toBeGreaterThan(surveyAssistant.right)
      expect(surveyPreview.right).toBeLessThanOrEqual(1159)
    }

    await page.setViewportSize({ width: 1076, height: 863 })
    const compactSurveyLayout = await page.locator('.survey-editor-main, .survey-editor-preview-column').evaluateAll((items) =>
      items.map((item) => {
        const rect = item.getBoundingClientRect()
        return { top: rect.top, right: rect.right, left: rect.left }
      }),
    )
    const [compactSurveyAssistant, compactSurveyPreview] = compactSurveyLayout
    expect(compactSurveyAssistant).toBeDefined()
    expect(compactSurveyPreview).toBeDefined()
    if (compactSurveyAssistant && compactSurveyPreview) {
      expect(Math.abs(compactSurveyPreview.top - compactSurveyAssistant.top)).toBeLessThanOrEqual(1)
      expect(compactSurveyPreview.left).toBeGreaterThan(compactSurveyAssistant.right)
      expect(compactSurveyPreview.right).toBeLessThanOrEqual(1076)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1076)
  })

  test('mobile dashboard keeps equal metric cards inside a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 280, height: 653 })
    await openConfiguredDashboard(page)

    const metricCards = page.locator('.metrics-row > div')
    await expect(metricCards).toHaveCount(2)
    const metricWidths = await metricCards.evaluateAll((cards) =>
      cards.map((card) => Math.round(card.getBoundingClientRect().width)),
    )

    expect(new Set(metricWidths).size).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(280)
  })

  test('store list cards stay compact on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1159, height: 863 })
    await page.goto('/dashboard')
    await page.evaluate(() => document.fonts.ready)
    const storeCardWidths = await page.locator('.owner-card-grid > .panel').evaluateAll((cards) =>
      cards.map((card) => Math.round(card.getBoundingClientRect().width)),
    )
    expect(new Set(storeCardWidths).size).toBe(1)
    expect(storeCardWidths[0]).toBeGreaterThanOrEqual(280)
    expect(storeCardWidths[0]).toBeLessThanOrEqual(320)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1159)
  })

  test('owner controls fit at the desktop boundary', async ({ page }) => {
    await page.setViewportSize({ width: 801, height: 900 })
    await page.goto(dashboard)
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(801)
  })

  test('store list follows a narrow mobile viewport without a desktop-width floor', async ({ page }) => {
    await page.setViewportSize({ width: 280, height: 653 })
    await page.goto('/dashboard')
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(280)
  })

  test('desktop account page keeps the owner navigation visible', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/account')

    const sidebar = page.getByRole('complementary', { name: '店舗管理ナビゲーション' })
    await expect(sidebar).toBeVisible()
    await expect(sidebar.getByRole('link', { name: 'アカウント' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { name: 'アカウント', exact: true })).toBeVisible()
    const dangerZone = page.locator('.danger-zone')
    await expect(dangerZone.getByRole('heading', { name: 'アカウントを削除' })).toBeVisible()
    await expect(dangerZone.getByRole('button', { name: '削除手続きを始める' })).toBeVisible()
  })

  test('mobile owner navigation uses four tabs, hubs, and a single detail back path', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${dashboard}/settings`)

    const tabbar = page.getByRole('navigation', { name: '管理画面の主要メニュー' })
    for (const [tab, href] of [
      ['ホーム', dashboard],
      ['集める', `${dashboard}/collect`],
      ['分析', `${dashboard}/analyze`],
      ['設定', `${dashboard}/settings`],
    ]) {
      const link = tabbar.getByRole('link', { name: tab, exact: true })
      await expect(link).toBeVisible()
      await expect(link).toHaveAttribute('href', href)
      const box = await link.boundingBox()
      expect(box?.height).toBeGreaterThanOrEqual(44)
    }
    await expect(tabbar.getByRole('link', { name: '設定', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('.owner-segment-nav')).toHaveCount(0)
    await expect(page.locator('.account-trigger')).toBeHidden()

    const settingsMenu = page.getByRole('navigation', { name: '設定メニュー' })
    await expect(page.locator('.owner-topbar__title')).toHaveText('設定')
    for (const item of ['store', 'connections', 'ai', 'account']) {
      const row = settingsMenu.getByTestId(`owner-hub-${item}`)
      await expect(row).toBeVisible()
      const box = await row.boundingBox()
      expect(box?.height).toBeGreaterThanOrEqual(44)
    }

    const settingsCard = page.locator('.grouped-list-page .owner-hub-list')
    const settingsCardBox = await settingsCard.boundingBox()
    expect(settingsCardBox).not.toBeNull()
    if (settingsCardBox) {
      expect(settingsCardBox.x).toBe(16)
      expect(settingsCardBox.y).toBe(80)
      expect(settingsCardBox.width).toBe(358)
      expect(settingsCardBox.height).toBe(203)
    }
    await expect(settingsCard).toHaveCSS('border-radius', '24px')
    await expect(settingsCard).toHaveCSS('border-top-width', '0px')
    await expect(page.locator('.owner-main--grouped-list .owner-content')).toHaveCSS('background-color', 'rgb(242, 242, 247)')
    await expect(page.locator('.owner-main--grouped-list')).toHaveCSS('background-color', 'rgb(242, 242, 247)')
    const groupedMainHeight = (await page.locator('.owner-main--grouped-list').boundingBox())?.height
    expect(groupedMainHeight).toBeDefined()
    if (groupedMainHeight !== undefined) expect(Math.abs(groupedMainHeight - 844)).toBeLessThanOrEqual(1)
    for (const row of await settingsMenu.locator('.owner-hub-row').all()) {
      const rowBox = await row.boundingBox()
      expect(rowBox?.x).toBe(16)
      expect(rowBox?.width).toBe(358)
      expect(rowBox?.height).toBe(50)
    }
    const storeRow = settingsMenu.getByTestId('owner-hub-store')
    const storeStatusBox = await storeRow.locator('.owner-hub-row__status').boundingBox()
    const storeChevronBox = await storeRow.locator('.owner-hub-row__chevron').boundingBox()
    expect(storeStatusBox).not.toBeNull()
    expect(storeChevronBox).not.toBeNull()
    if (storeStatusBox && storeChevronBox) {
      expect(storeChevronBox.x - (storeStatusBox.x + storeStatusBox.width)).toBe(8)
      expect(Math.abs(
        (storeStatusBox.y + storeStatusBox.height / 2)
        - (storeChevronBox.y + storeChevronBox.height / 2),
      )).toBeLessThanOrEqual(1)
    }
    await expect(settingsMenu.locator('li').nth(1)).toHaveCSS('border-top-width', '1px')

    await settingsMenu.getByTestId('owner-hub-ai').click()
    await expect(page).toHaveURL(`${dashboard}/ai`)
    await expect(tabbar.getByRole('link', { name: '設定', exact: true })).toHaveAttribute('aria-current', 'page')
    const back = page.locator('.owner-topbar__back')
    await expect(back).toHaveText('設定')
    await expect(back).toHaveAttribute('href', `${dashboard}/settings`)
    await expect(back).toBeVisible()
    expect((await back.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    await back.click()
    await expect(page).toHaveURL(`${dashboard}/settings`)
    await expect(settingsMenu).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })

  test('mobile collect and analyze hubs use the measured grouped layout', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })

    for (const hub of [
      { route: `${dashboard}/collect`, tab: '集める', menu: '集めるメニュー', items: ['qr', 'survey'] },
      { route: `${dashboard}/analyze`, tab: '分析', menu: '分析メニュー', items: ['interviews', 'summary'] },
    ]) {
      await page.goto(hub.route)
      await expect(page.locator('.owner-topbar__title')).toHaveText(hub.tab)
      await expect(page.getByRole('navigation', { name: '管理画面の主要メニュー' })
        .getByRole('link', { name: hub.tab, exact: true })).toHaveAttribute('aria-current', 'page')

      const menu = page.getByRole('navigation', { name: hub.menu })
      const card = page.locator('.grouped-list-page .owner-hub-list')
      const cardBox = await card.boundingBox()
      expect(cardBox).not.toBeNull()
      if (cardBox) {
        expect(cardBox.x).toBe(16)
        expect(cardBox.y).toBe(80)
        expect(cardBox.width).toBe(358)
        expect(cardBox.height).toBe(101)
      }
      await expect(card).toHaveCSS('border-radius', '24px')
      await expect(card).toHaveCSS('border-top-width', '0px')
      for (const item of hub.items) {
        const rowBox = await menu.getByTestId(`owner-hub-${item}`).boundingBox()
        expect(rowBox?.x).toBe(16)
        expect(rowBox?.width).toBe(358)
        expect(rowBox?.height).toBe(50)
      }
      await expect(menu.locator('li').nth(1)).toHaveCSS('border-top-width', '1px')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    }
  })

  test('mobile direct links preserve their category and nested interview detail returns to history', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const cases = [
      { route: `${dashboard}/survey`, tab: '集める', back: `${dashboard}/collect` },
      { route: `${dashboard}/summary`, tab: '分析', back: `${dashboard}/analyze` },
      { route: `${dashboard}/ai`, tab: '設定', back: `${dashboard}/settings` },
    ]

    for (const item of cases) {
      await page.goto(item.route)
      const tabbar = page.getByRole('navigation', { name: '管理画面の主要メニュー' })
      await expect(tabbar.getByRole('link', { name: item.tab, exact: true })).toHaveAttribute('aria-current', 'page')
      await expect(page.locator('.owner-topbar__back')).toHaveAttribute('href', item.back)
      await expect(page.locator('.owner-segment-nav')).toHaveCount(0)
    }

    await page.goto(`${dashboard}/interviews/e2e`)
    await expect(page.locator('.owner-topbar__title')).toHaveText('回答詳細')
    await expect(page.locator('.owner-topbar__back')).toHaveText('回答履歴')
    await expect(page.locator('.owner-topbar__back')).toHaveAttribute('href', `${dashboard}/interviews`)
    await expect(page.getByRole('navigation', { name: '管理画面の主要メニュー' }).getByRole('link', { name: '分析', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('link', { name: '一覧へ戻る' })).toBeHidden()
    await expect(page.getByText('Q: 利用したメニュー・サービス')).toBeVisible()
    await expect(page.getByText('A: カット')).toBeVisible()
    await expect(page.getByText('Q: 今回、特に印象に残ったこと')).toBeVisible()
    await expect(page.getByText('A: 希望を確認しながら進めてもらえました。')).toBeVisible()
    await expect(page.getByRole('heading', { name: '会話', exact: true })).toHaveCount(0)
    await expect(page.locator('.detail-grid + .panel')).toHaveCount(0)

    await page.getByLabel('管理する店舗').selectOption(SECOND_STORE_ID)
    await expect(page).toHaveURL(`/dashboard/stores/${SECOND_STORE_ID}/interviews`)
    await expect(page.getByRole('heading', { name: /回答履歴/ })).toBeVisible()
  })

  test('owner can understand and safely update the simplified AI settings', async ({ page }) => {
    await page.goto(`${dashboard}/ai`)

    await expect(page.locator('.owner-page > .page-title')).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'AI接続の概要' })).toHaveCount(0)
    await expect(page.locator('.ai-provider-list__item')).toHaveCount(5)
    await expect(page.locator('.ai-provider-card')).toHaveCount(1)
    for (const provider of ['openai', 'gemini', 'deepseek', 'xai', 'anthropic']) {
      await expect(page.locator(`[data-provider-logo="${provider}"] svg`)).toHaveCount(1)
    }
    await expect(page.getByText('Claude (Anthropic)', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'OpenAIは使用中' })).toHaveText('使用中')
    const geminiProvider = page.getByRole('button', { name: 'Geminiの設定を開く' })
    await expect(geminiProvider).toContainText('未接続')

    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
    await geminiProvider.click()
    await expect(geminiProvider).toHaveCSS('background-color', 'rgb(17, 44, 69)')
    await expect(geminiProvider).toHaveCSS('color', 'rgb(252, 252, 252)')

    const geminiKeyInput = page.getByLabel('Gemini APIキー')
    const geminiKeyVisibility = page.getByRole('button', { name: 'GeminiのAPIキーを表示' })
    const [keyBox, visibilityBox] = await Promise.all([
      geminiKeyInput.boundingBox(),
      geminiKeyVisibility.boundingBox(),
    ])
    expect(keyBox).not.toBeNull()
    expect(visibilityBox).not.toBeNull()
    expect(keyBox?.y).toBe(visibilityBox?.y)
    expect(keyBox?.height).toBe(48)
    expect(visibilityBox?.height).toBe(48)

    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    await page.getByRole('button', { name: 'OpenAIの設定を開く' }).click()

    const openAiModel = page.getByLabel('OpenAIのモデル', { exact: true })
    await expect(openAiModel).toHaveValue('gpt-5.6-luna')
    await expect(openAiModel.locator('option')).toHaveCount(1)
    const openAiCard = page.locator('.ai-provider-card').filter({ hasText: 'OpenAI' })
    await expect(openAiCard.getByText(/通常入力|100万トークン/)).toHaveCount(0)

    const sentinel = 'sk-e2e-safe-123456'
    const keyInput = page.getByLabel('OpenAI APIキー')
    await expect(page.getByText('保存済みのキーは表示されません。')).toHaveCount(0)
    await keyInput.fill(sentinel)
    await expect(openAiCard.getByText('保存済みのキーは表示されません。')).toBeVisible()
    await expect(page.getByText(/少量のAPI利用料が発生する場合があります/)).toHaveCount(0)
    await page.getByRole('button', { name: 'OpenAIのAPIキーを表示' }).click()
    await expect(keyInput).toHaveAttribute('type', 'text')
    await openAiCard.getByRole('button', { name: 'APIキーを更新' }).click()
    await expect(keyInput).toHaveValue('')
    await expect(keyInput).toHaveAttribute('type', 'password')
    await expect(page.locator('.ai-settings-savebar')).toHaveCount(0)
    expect(await page.evaluate(() => `${localStorage.getItem('apiKey') ?? ''}${sessionStorage.getItem('apiKey') ?? ''}`)).not.toContain(sentinel)
  })

  test('mobile AI settings fit above the bottom navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${dashboard}/ai`)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await expect(page.locator('.ai-provider-list__item')).toHaveCount(5)
    await expect(page.locator('.ai-provider-card')).toHaveCount(1)

    await expect(page.locator('.ai-settings-savebar')).toHaveCount(0)
    await expect(page.locator('.ai-provider-card').first().getByRole('button', { name: 'APIキーを更新' })).toBeVisible()

    for (const target of await page.locator('.ai-provider-list__item').all()) {
      const box = await target.boundingBox()
      if (box) expect(box.height).toBeGreaterThanOrEqual(44)
    }
  })

  test('owner can edit, preview, and save the fully customizable survey', async ({ page }) => {
    await page.goto(`${dashboard}/survey`)

    await expect(page.getByRole('heading', { name: 'アンケート編集' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'プリセットから作り直す' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^1\. / })).toBeVisible()

    const title = page.getByLabel('アンケートの見出し')
    await title.fill('お客様の声をお聞かせください')
    await expect(page.getByRole('button', { name: 'プレビュー' })).toHaveCount(0)
    await expect(page.locator('#survey-preview').getByRole('heading', { name: 'お客様の声をお聞かせください' })).toBeVisible()

    await page.getByRole('button', { name: '保存する' }).click()
    await expect(page.getByText('アンケート設定を保存しました。公開ページにも反映されます。')).toBeVisible()
    await expect(page.getByText('すべて保存されています。')).toBeVisible()

    await page.getByRole('link', { name: 'ホーム' }).click()
    await page.getByRole('complementary', { name: '店舗管理ナビゲーション' })
      .getByRole('link', { name: 'アンケート編集', exact: true })
      .click()
    await expect(page.getByLabel('アンケートの見出し')).toHaveValue('お客様の声をお聞かせください')
  })

  test('owner can export history for CSV and JSON analysis, then open the monthly summary', async ({
    page,
  }) => {
    await page.goto(`${dashboard}/interviews`)
    await expect(page.getByRole('heading', { name: /回答履歴/ })).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('csv-download').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.csv$/)
    const csvPath = await download.path()
    expect(csvPath).not.toBeNull()
    if (csvPath === null) throw new Error('CSV download path is unavailable')
    const csv = await readFile(csvPath, 'utf8')
    expect(csv).toContain('利用したメニュー・サービス')
    expect(csv).toContain('今回、特に印象に残ったこと')
    expect(csv).toContain('カット')
    expect(csv).toContain('希望を確認しながら進めてもらえました。')

    await expect(page.getByTestId('analysis-download')).toHaveText('JSONをダウンロード')
    const analysisDownloadPromise = page.waitForEvent('download')
    await page.getByTestId('analysis-download').click()
    const analysisDownload = await analysisDownloadPromise
    expect(analysisDownload.suggestedFilename()).toBe('kuchitoru-zero-review-analysis.json')
    const analysisPath = await analysisDownload.path()
    expect(analysisPath).not.toBeNull()
    if (analysisPath === null) throw new Error('Analysis download path is unavailable')
    const analysis = await readFile(analysisPath, 'utf8')
    expect(analysis).toContain('"format": "kuchitoru_review_analysis_export"')
    expect(analysis).toContain('"question_answers"')
    expect(analysis).toContain('"利用したメニュー・サービス": "カット"')
    expect(analysis).not.toContain('AI分析プロンプト')

    await page.goto(`${dashboard}/summary`)
    await expect(page.getByRole('region', { name: /月次サマリー$/ })).toBeVisible()
    await expect(page.getByRole('progressbar', { name: '回答完了率' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '今月の流れ' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '評価の傾向' })).toBeVisible()
    await expect(page.getByText('前月との比較')).toBeVisible()
  })
})
