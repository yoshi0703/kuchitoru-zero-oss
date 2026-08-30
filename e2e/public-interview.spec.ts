import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'
import { installPublicInterviewMock } from './mock-api'

async function moveToNextQuestion(page: Page) {
  await page.getByTestId('question-next').click()
}

async function skipQuestion(page: Page) {
  await page.getByTestId('question-skip').click()
}

function handoffDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Googleへの投稿はあと少しです' })
}

test.describe('public interview contract', () => {
  test('visitor completes start, answer, edit, copy, and handoff with local mocks', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 393, height: 852 })
    const state = await installPublicInterviewMock(page)
    await page.addInitScript(() => {
      window.localStorage.clear()
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            Reflect.set(window, '__e2eCopiedReview', value)
          },
        },
      })
      window.open = () => {
        const popup = {
          close: () => undefined,
          location: {
            replace: (url: string) => {
              Reflect.set(window, '__e2eOpenedUrl', url)
            },
          },
          opener: null,
        }
        return popup as unknown as Window
      }
    })

    await page.goto('/s/e2e-store')
    await expect(page.getByText('テスト店舗', { exact: true })).toBeVisible()
    await page.getByTestId('interview-start').click()
    await expect(page.getByRole('heading', { name: 'テスト店舗アンケート' })).toBeVisible()
    await expect(page.getByText('保存した設問が公開画面へ反映されています。')).toBeVisible()
    await expect(page.getByText(/来店頻度/)).toBeVisible()
    await expect(page.getByText(/今回の評価/)).toHaveCount(0)
    await page.getByLabel('初めて', { exact: true }).click()
    await moveToNextQuestion(page)
    await page.getByTestId('rating-5').click()
    await moveToNextQuestion(page)
    await page.getByLabel(/利用したメニュー・サービス/).fill('季節のランチセット')
    await moveToNextQuestion(page)
    await page.getByLabel(/今回、特に印象に残ったこと/).fill('料理の説明が丁寧でした。')
    await moveToNextQuestion(page)
    await page.getByLabel(/改善してほしいこと/).fill('待ち時間の目安があると嬉しいです。')
    await page.getByTestId('profile-submit').click()

    const editor = page.getByTestId('review-editor')
    await expect(editor).toHaveValue(state.review)
    await editor.fill('料理の説明が丁寧で、落ち着いて楽しめました。')
    await page.getByTestId('review-save').click()
    await page.getByTestId('review-copy').click()

    // The handoff button now only asks for confirmation: nothing leaves for Google yet.
    const trigger = page.getByTestId('google-handoff')
    await trigger.click()
    const dialog = handoffDialog(page)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('google-handoff-copy')).toBeFocused()
    expect(state.handoffEvents).toEqual(['review_text_copied'])
    expect(await page.evaluate(() => Reflect.get(window, '__e2eOpenedUrl'))).toBeUndefined()

    // Escape cancels without losing the edited review, and focus returns to the trigger.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await expect(editor).toHaveValue('料理の説明が丁寧で、落ち着いて楽しめました。')
    expect(state.handoffEvents).toEqual(['review_text_copied'])

    await trigger.click()
    await dialog.getByTestId('google-handoff-copy').click()
    await expect(dialog.getByTestId('google-handoff-status')).toHaveText('コピーしました。')
    await dialog.getByTestId('google-handoff-confirm').click()

    expect(state.profileSaved).toBe(true)
    expect(state.answers).toEqual([])
    expect(state.survey).toMatchObject({
      kind: 'survey',
      surveyRevision: 1,
      answers: {
        q_000000000001: { type: 'single_choice', value: 'first' },
        q_000000000002: { type: 'rating_5', value: 5 },
        q_000000000003: { type: 'short_text', value: '季節のランチセット' },
        q_000000000004: { type: 'long_text', value: '料理の説明が丁寧でした。' },
      },
    })
    await expect(page.getByTestId('answer-input')).toHaveCount(0)
    expect(state.handoffEvents).toEqual([
      'review_text_copied',
      'review_text_copied',
      'google_review_opened',
    ])
    expect(
      await page.evaluate(() => Reflect.get(window, '__e2eCopiedReview')),
    ).toBe('料理の説明が丁寧で、落ち着いて楽しめました。')
    expect(
      await page.evaluate(() => Reflect.get(window, '__e2eOpenedUrl')),
    ).toMatch(/^https:\/\/search\.google\.com\/local\/writereview/)
  })

  test('ratings 1 to 5 and no rating share the same required-only completion path', async ({ page }) => {
    test.setTimeout(60_000)
    await installPublicInterviewMock(page)
    await page.addInitScript(() => window.sessionStorage.clear())
    for (const rating of [1, 2, 3, 4, 5, null]) {
      await page.goto('/s/e2e-store')
      await page.getByTestId('interview-start').click()
      await skipQuestion(page)
      if (rating === null) await skipQuestion(page)
      else {
        await page.getByTestId(`rating-${rating}`).click()
        await moveToNextQuestion(page)
      }
      await page.getByLabel(/利用したメニュー・サービス/).fill('ランチ')
      await moveToNextQuestion(page)
      await page.getByLabel(/今回、特に印象に残ったこと/).fill('料理の説明を聞いた場面です。')
      await moveToNextQuestion(page)
      const submit = page.getByTestId('profile-submit')
      await expect(submit).toBeEnabled()
      await submit.click()
      await expect(page.getByTestId('review-editor')).toHaveValue(/料理の説明/)
      await page.evaluate(() => document.fonts.ready)
    }
  })

  test('copy failure selects the review but never blocks the independent Google handoff', async ({ page }) => {
    const state = await installPublicInterviewMock(page)
    await page.addInitScript(() => {
      window.localStorage.clear()
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => { throw new Error('denied') } },
      })
      document.execCommand = () => false
      window.open = () => ({
        close: () => undefined,
        location: { replace: (url: string) => Reflect.set(window, '__e2eOpenedUrl', url) },
        opener: null,
      }) as unknown as Window
    })

    await page.goto('/s/e2e-store')
    await page.getByTestId('interview-start').click()
    await skipQuestion(page)
    await skipQuestion(page)
    await page.getByLabel(/利用したメニュー・サービス/).fill('季節のランチセット')
    await moveToNextQuestion(page)
    await page.getByLabel(/今回、特に印象に残ったこと/).fill('改善してほしい点が印象に残りました。')
    await moveToNextQuestion(page)
    await expect(page.getByTestId('profile-submit')).toBeEnabled()
    await page.getByTestId('profile-submit').click()

    const editor = page.getByTestId('review-editor')
    await page.getByTestId('review-copy').click()
    await expect(page.getByText(/文章を選択しました/)).toBeVisible()
    await expect(editor).toBeFocused()
    expect(await editor.evaluate((element) => {
      const textarea = element as HTMLTextAreaElement
      return textarea.selectionStart === 0 && textarea.selectionEnd === textarea.value.length
    })).toBe(true)

    await page.getByTestId('google-handoff').click()
    const dialog = handoffDialog(page)
    await expect(dialog).toBeVisible()
    await dialog.getByTestId('google-handoff-copy').click()
    await expect(dialog.getByTestId('google-handoff-status')).toContainText('コピーできませんでした')
    const confirm = dialog.getByTestId('google-handoff-confirm')
    await expect(confirm).toBeEnabled()
    await confirm.click()
    expect(state.handoffEvents).toEqual(['google_review_opened'])
    expect(await page.evaluate(() => Reflect.get(window, '__e2eOpenedUrl'))).toMatch(/^https:\/\/search\.google\.com\/local\/writereview/)
  })

  test('focused survey input remains visible when the mobile viewport shrinks', async ({ page }) => {
    await installPublicInterviewMock(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/s/e2e-store')
    await page.getByTestId('interview-start').click()
    await skipQuestion(page)
    await skipQuestion(page)
    await page.getByLabel(/利用したメニュー・サービス/).fill('ランチ')
    await moveToNextQuestion(page)

    const answer = page.getByLabel(/今回、特に印象に残ったこと/)
    await answer.focus()
    await page.setViewportSize({ width: 390, height: 420 })

    await expect.poll(async () => {
      const answerBox = await answer.boundingBox()
      const actionsBox = await page.locator('.survey-step__actions').boundingBox()
      if (!answerBox || !actionsBox) return false
      return answerBox.y >= 0 && answerBox.y + answerBox.height <= actionsBox.y
    }).toBe(true)
  })
})
