import type { Page, Request, Route } from '@playwright/test'

export interface PublicInterviewMockState {
  answers: string[]
  handoffEvents: string[]
  profileSaved: boolean
  survey: Record<string, unknown> | null
  review: string
  rewriteCount: number
}

const apiPrefix = '/functions/v1/public-interview'
const sessionId = '00000000-0000-4000-8000-000000000001'
const sessionToken = 'e2e-session-token-fixture'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const surveyConfig = {
  version: 3 as const,
  presetId: 'restaurant',
  title: 'テスト店舗アンケート',
  description: '保存した設問が公開画面へ反映されています。',
  revision: 1,
  questions: [
    { id: 'q_000000000001', type: 'single_choice', label: '来店頻度', required: false, role: 'visit_frequency', options: [{ value: 'first', label: '初めて' }, { value: 'regular', label: 'よく利用する' }], allowOther: false },
    { id: 'q_000000000002', type: 'rating_5', label: '今回の評価', required: false, role: 'rating', lowLabel: '物足りない', highLabel: 'とても良い' },
    { id: 'q_000000000003', type: 'short_text', label: '利用したメニュー・サービス', placeholder: '例：ランチセット', required: true, maxLength: 120 },
    { id: 'q_000000000004', type: 'long_text', label: '今回、特に印象に残ったこと', placeholder: '料理、接客、雰囲気など', required: true, maxLength: 400 },
    { id: 'q_000000000005', type: 'long_text', label: '改善してほしいことや、ほかに伝えたいこと', placeholder: '任意でご記入ください', required: false, maxLength: 400 },
  ],
}

function commonHeaders() {
  return {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
    'X-Request-Id': crypto.randomUUID(),
  }
}

async function respond(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    body: JSON.stringify({ data, success: status < 400 }),
    headers: commonHeaders(),
    status,
  })
}

function requirePublicApiKey(request: Request) {
  if (!request.headers().apikey) {
    throw new Error(`Missing apikey header for ${request.method()} ${request.url()}`)
  }
}

function requireMutationHeaders(request: Request, tokenRequired = true) {
  requirePublicApiKey(request)
  const idempotencyKey = request.headers()['idempotency-key']
  if (!idempotencyKey || !uuidPattern.test(idempotencyKey)) {
    throw new Error(
      `Missing or invalid Idempotency-Key for ${request.method()} ${request.url()}`,
    )
  }
  if (
    tokenRequired &&
    request.headers()['x-interview-token'] !== sessionToken
  ) {
    throw new Error(
      `Missing or invalid X-Interview-Token for ${request.method()} ${request.url()}`,
    )
  }
}

export async function installPublicInterviewMock(
  page: Page,
): Promise<PublicInterviewMockState> {
  const state: PublicInterviewMockState = {
    answers: [],
    handoffEvents: [],
    profileSaved: false,
    survey: null,
    review: '料理の説明が丁寧で、安心して楽しめました。',
    rewriteCount: 0,
  }

  await page.route(`**${apiPrefix}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const relativePath = url.pathname.slice(url.pathname.indexOf(apiPrefix) + apiPrefix.length)

    if (request.method() === 'GET' && relativePath === '/stores/e2e-store') {
      requirePublicApiKey(request)
      await respond(route, {
        closingMessage: 'ご回答ありがとうございました',
        description: 'E2E専用の店舗です',
        industry: 'restaurant',
        name: 'テスト店舗',
        publicSlug: 'e2e-store',
        surveyConfig,
        surveyRevision: 1,
        welcomeMessage: '率直なご感想をお聞かせください',
      })
      return
    }

    if (request.method() === 'POST' && relativePath === '/sessions') {
      requireMutationHeaders(request, false)
      await respond(route, {
        expiresAt: new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
        sessionId,
        sessionToken,
        surveyConfig,
        surveyRevision: 1,
      })
      return
    }

    if (
      request.method() === 'POST' &&
      relativePath === `/sessions/${sessionId}/turns`
    ) {
      requireMutationHeaders(request)
      const body = request.postDataJSON() as
        | { kind: 'profile'; rating: number; visitFrequency: string }
        | { kind: 'survey'; surveyRevision: number; answers: Record<string, { type: string; value: string | string[] | number }> }
        | { content: string; kind: 'text' }

      if (body.kind === 'survey') {
        state.profileSaved = true
        state.survey = body
        await respond(route, {
          answerSaved: true,
          maxTurns: 8,
          next: { kind: 'ready_for_review' },
          turnCount: 0,
        })
        return
      }

      if (body.kind === 'profile') {
        state.profileSaved = true
        await respond(route, {
          answerSaved: true,
          maxTurns: 8,
          next: {
            kind: 'question',
            message: {
              content: '特に印象に残ったことを教えてください。',
              sequence: 1,
            },
          },
          turnCount: 0,
        })
        return
      }

      state.answers.push(body.content)
      await respond(route, {
        answerSaved: true,
        maxTurns: 8,
        next: { kind: 'ready_for_review' },
        turnCount: state.answers.length,
      })
      return
    }

    if (
      request.method() === 'POST' &&
      relativePath === `/sessions/${sessionId}/review`
    ) {
      requireMutationHeaders(request)
      await respond(route, { remainingRewrites: 2, review: state.review })
      return
    }

    if (
      request.method() === 'PATCH' &&
      relativePath === `/sessions/${sessionId}/review`
    ) {
      requireMutationHeaders(request)
      const body = request.postDataJSON() as {
        editedReview?: string
        review?: string
      }
      state.review = body.editedReview ?? body.review ?? state.review
      await respond(route, {
        remainingRewrites: 2 - state.rewriteCount,
        review: state.review,
      })
      return
    }

    if (
      request.method() === 'POST' &&
      relativePath === `/sessions/${sessionId}/rewrite`
    ) {
      requireMutationHeaders(request)
      state.rewriteCount += 1
      state.review = `書き直し${state.rewriteCount}: ${state.review}`
      await respond(route, {
        remainingRewrites: 2 - state.rewriteCount,
        review: state.review,
      })
      return
    }

    if (
      request.method() === 'POST' &&
      relativePath === `/sessions/${sessionId}/handoff`
    ) {
      requireMutationHeaders(request)
      const body = request.postDataJSON() as {
        editedReview: string
        eventType: string
      }
      state.review = body.editedReview
      state.handoffEvents.push(body.eventType)
      await respond(
        route,
        body.eventType === 'google_review_opened'
          ? {
              googleReviewUrl:
                'https://search.google.com/local/writereview?placeid=ChIJ-e2e',
              recorded: true,
            }
          : { recorded: true },
      )
      return
    }

    await respond(route, null, 404)
  })

  return state
}
