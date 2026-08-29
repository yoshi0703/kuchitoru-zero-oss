import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, test } from './fixtures'

type ApiEnvelope<T> =
  | { success: true; data: T }
  | {
      success: false
      data?: { answerSaved?: boolean }
      error?: {
        code?: string
        message?: string
        retryable?: boolean
      }
    }

type BrowserApiResult<T> = {
  status: number
  payload: ApiEnvelope<T> | T | null
}

const apiUrl = requiredEnvironment('KUCHITORU_INTEGRATION_API_URL')
const publishableKey = requiredEnvironment(
  'KUCHITORU_INTEGRATION_PUBLISHABLE_KEY',
)
const secretKey = requiredEnvironment('KUCHITORU_INTEGRATION_SECRET_KEY')
const turnstileToken = requiredEnvironment(
  'KUCHITORU_INTEGRATION_TURNSTILE_TOKEN',
)

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required by the local integration test`)
  return value
}

function successData<T>(result: BrowserApiResult<T>): T {
  expect(result.status).toBeGreaterThanOrEqual(200)
  expect(result.status).toBeLessThan(300)
  expect(result.payload).not.toBeNull()
  expect((result.payload as ApiEnvelope<T>).success).toBe(true)
  return (result.payload as { success: true; data: T }).data
}

test.describe('real local Supabase integration', () => {
  let admin: SupabaseClient
  let userId = ''
  let email = ''
  let password = ''
  let secondUserId = ''
  let secondEmail = ''
  let secondPassword = ''

  test.beforeAll(async () => {
    admin = createClient(apiUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    email = `integration-${crypto.randomUUID()}@example.test`
    password = `Local-${crypto.randomUUID()}-Aa1!`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password,
    })
    if (error || !data.user) {
      throw new Error('Could not create the isolated local Auth user')
    }
    userId = data.user.id

    secondEmail = `integration-${crypto.randomUUID()}@example.test`
    secondPassword = `Local-${crypto.randomUUID()}-Aa1!`
    const { data: secondData, error: secondError } = await admin.auth.admin.createUser({
      email: secondEmail,
      email_confirm: true,
      password: secondPassword,
    })
    if (secondError || !secondData.user) {
      throw new Error('Could not create the second isolated local Auth user')
    }
    secondUserId = secondData.user.id
  })

  test.afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId)
    if (secondUserId) await admin.auth.admin.deleteUser(secondUserId)
  })

  test('store isolation and saved answers work without BYOK credentials', async ({
    page,
    runtimeErrors,
  }) => {
    await page.route('**/runtime-config.js', async (route) => {
      await route.fulfill({
        body: 'window.__KUCHITORU_RUNTIME_CONFIG__={}',
        contentType: 'application/javascript',
        status: 200,
      })
    })
    await page.route(
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
      async (route) => {
        await route.fulfill({
          body: `window.turnstile={render:(_container,options)=>{queueMicrotask(()=>options.callback(${JSON.stringify(turnstileToken)}));return'integration-turnstile'},remove:()=>{}}`,
          contentType: 'application/javascript',
          status: 200,
        })
      },
    )
    await page.goto('/login')
    await page.getByLabel('メールアドレス').fill(email)
    await page.getByLabel('パスワード', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'ログイン' }).click()
    await expect(page).toHaveURL(/\/dashboard(?:\/|$)/)

    const ownerAccessToken = await page.evaluate(() => {
      const authStorageKey = Object.keys(localStorage).find(
        (key) => key.startsWith('sb-') && key.endsWith('-auth-token'),
      )
      if (!authStorageKey) throw new Error('Authenticated browser session was not persisted')
      const storedSession = JSON.parse(localStorage.getItem(authStorageKey) ?? 'null') as {
        access_token?: string
      } | null
      if (!storedSession?.access_token) {
        throw new Error('Authenticated browser session has no access token')
      }
      return storedSession.access_token
    })

    const ownerRequestWithToken = async <T>(
      accessToken: string,
      path: string,
      method: 'GET' | 'POST' | 'PATCH',
      body?: unknown,
    ): Promise<BrowserApiResult<T>> => {
      const headers = new Headers({
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        apikey: publishableKey,
      })
      if (method !== 'GET') {
        headers.set('Content-Type', 'application/json')
        headers.set('Idempotency-Key', crypto.randomUUID())
      }
      const response = await fetch(`${apiUrl}/functions/v1${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return {
        status: response.status,
        payload: await response.json().catch(() => null),
      } as BrowserApiResult<T>
    }

    const ownerRequest = <T>(
      path: string,
      method: 'GET' | 'POST' | 'PATCH',
      body?: unknown,
    ) => ownerRequestWithToken<T>(ownerAccessToken, path, method, body)

    const restRequestWithToken = async <T>(
      accessToken: string,
      path: string,
      method: 'GET' | 'PATCH' = 'GET',
      body?: unknown,
    ): Promise<{ status: number; payload: T | null }> => {
      const headers = new Headers({
        Accept: 'application/json',
        'Accept-Profile': 'api',
        Authorization: `Bearer ${accessToken}`,
        apikey: publishableKey,
      })
      if (method === 'PATCH') {
        headers.set('Content-Type', 'application/json')
        headers.set('Content-Profile', 'api')
        headers.set('Prefer', 'return=representation')
      }
      const response = await fetch(`${apiUrl}/rest/v1/${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      return {
        status: response.status,
        payload: await response.json().catch(() => null) as T | null,
      }
    }

    const storeName = `結合テスト店舗 ${crypto.randomUUID().slice(0, 8)}`
    const store = successData<{ id: string; public_slug: string; name: string }>(
      await ownerRequest('/owner-api/v2/stores', 'POST', {
        googlePlaceId: 'ChIJLocalIntegration0001',
        googleReviewUrl:
          'https://search.google.com/local/writereview?placeid=ChIJLocalIntegration0001',
        name: storeName,
      }),
    )
    expect(store.name).toBe(storeName)
    expect(store.public_slug.length).toBeGreaterThanOrEqual(16)

    successData(
      await ownerRequest(`/owner-api/v2/stores/${store.id}/publish`, 'POST'),
    )

    const secondClient = createClient(apiUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: secondAuth, error: secondAuthError } =
      await secondClient.auth.signInWithPassword({
        email: secondEmail,
        password: secondPassword,
      })
    if (secondAuthError || !secondAuth.session?.access_token) {
      throw new Error('Could not authenticate the second isolated local Auth user')
    }
    const secondAccessToken = secondAuth.session.access_token
    const secondStoreName = `結合テスト別店舗 ${crypto.randomUUID().slice(0, 8)}`
    const secondStore = successData<{ id: string; public_slug: string; name: string }>(
      await ownerRequestWithToken(secondAccessToken, '/owner-api/v2/stores', 'POST', {
        googlePlaceId: 'ChIJLocalIntegration0002',
        googleReviewUrl:
          'https://search.google.com/local/writereview?placeid=ChIJLocalIntegration0002',
        name: secondStoreName,
      }),
    )
    successData(
      await ownerRequestWithToken(
        secondAccessToken,
        `/owner-api/v2/stores/${secondStore.id}/publish`,
        'POST',
      ),
    )

    const foreignStoreRead = await ownerRequestWithToken(
      ownerAccessToken,
      `/owner-api/v2/stores/${secondStore.id}`,
      'GET',
    )
    expect([403, 404]).toContain(foreignStoreRead.status)
    const foreignStoreUpdate = await ownerRequestWithToken(
      ownerAccessToken,
      `/owner-api/v2/stores/${secondStore.id}`,
      'PATCH',
      { name: '他店舗へ保存してはならない名前' },
    )
    expect([403, 404]).toContain(foreignStoreUpdate.status)

    const foreignConnections = await ownerRequestWithToken<unknown[]>(
      ownerAccessToken,
      `/owner-api/v2/stores/${secondStore.id}/ai-connections`,
      'GET',
    )
    if (foreignConnections.status === 200) {
      expect(successData(foreignConnections)).toEqual([])
    } else {
      expect([403, 404]).toContain(foreignConnections.status)
    }
    const foreignConnectionUpdate = await ownerRequestWithToken(
      ownerAccessToken,
      `/owner-api/v2/stores/${secondStore.id}/ai-connection/select-provider`,
      'POST',
      { provider: 'openai' },
    )
    expect([403, 404]).toContain(foreignConnectionUpdate.status)

    const reverseStoreRead = await ownerRequestWithToken(
      secondAccessToken,
      `/owner-api/v2/stores/${store.id}`,
      'GET',
    )
    expect([403, 404]).toContain(reverseStoreRead.status)

    const secondStoreAfterDeniedUpdate = successData<{ name: string }>(
      await ownerRequestWithToken(
        secondAccessToken,
        `/owner-api/v2/stores/${secondStore.id}`,
        'GET',
      ),
    )
    expect(secondStoreAfterDeniedUpdate.name).toBe(secondStoreName)

    const aiConnectionsResult = await ownerRequest<unknown[]>(
      `/owner-api/v2/stores/${store.id}/ai-connections`,
      'GET',
    )
    expect(successData(aiConnectionsResult)).toEqual([])
    expect(JSON.stringify(aiConnectionsResult.payload)).not.toMatch(
      /apiKey|credential_ciphertext|credential_iv|secret/i,
    )

    const persisted = await page.evaluate(
      async ({ requestApiUrl, requestKey, slug }) => {
        const authStorageKey = Object.keys(localStorage).find(
          (key) => key.startsWith('sb-') && key.endsWith('-auth-token'),
        )
        const session = JSON.parse(localStorage.getItem(authStorageKey ?? '') ?? 'null') as {
          access_token?: string
        } | null
        if (!session?.access_token) throw new Error('Missing browser session')
        const response = await fetch(
          `${requestApiUrl}/rest/v1/stores?select=name,public_slug,status&public_slug=eq.${encodeURIComponent(slug)}`,
          {
            headers: {
              Accept: 'application/json',
              'Accept-Profile': 'api',
              Authorization: `Bearer ${session.access_token}`,
              apikey: requestKey,
            },
          },
        )
        return { rows: await response.json(), status: response.status }
      },
      { requestApiUrl: apiUrl, requestKey: publishableKey, slug: store.public_slug },
    )
    expect(persisted.status).toBe(200)
    expect(persisted.rows).toEqual([
      { name: storeName, public_slug: store.public_slug, status: 'published' },
    ])

    const publicResult = await page.evaluate(
      async ({ requestApiUrl, requestKey, slug }) => {
        const response = await fetch(
          `${requestApiUrl}/functions/v1/public-interview/stores/${encodeURIComponent(slug)}`,
          { headers: { Accept: 'application/json', apikey: requestKey } },
        )
        return {
          status: response.status,
          payload: await response.json().catch(() => null),
        }
      },
      { requestApiUrl: apiUrl, requestKey: publishableKey, slug: store.public_slug },
    ) as BrowserApiResult<{ name: string; publicSlug: string }>
    const publicStore = successData(publicResult)
    expect(publicStore).toMatchObject({
      name: storeName,
      publicSlug: store.public_slug,
    })

    const publicRequest = async <T>(
      path: string,
      method: 'GET' | 'POST' | 'PATCH',
      input?: { body?: unknown; interviewToken?: string },
    ) =>
      await page.evaluate(
        async ({ requestApiUrl, requestBody, requestInterviewToken, requestKey, requestMethod, requestPath }) => {
          const headers = new Headers({ Accept: 'application/json', apikey: requestKey })
          if (requestMethod !== 'GET') {
            headers.set('Content-Type', 'application/json')
            headers.set('Idempotency-Key', crypto.randomUUID())
          }
          if (requestInterviewToken) {
            headers.set('X-Interview-Token', requestInterviewToken)
          }
          const requestInit: RequestInit = { headers, method: requestMethod }
          if (requestBody !== undefined) requestInit.body = JSON.stringify(requestBody)
          const response = await fetch(
            `${requestApiUrl}/functions/v1${requestPath}`,
            requestInit,
          )
          return {
            status: response.status,
            payload: await response.json().catch(() => null),
          }
        },
        {
          requestApiUrl: apiUrl,
          requestBody: input?.body,
          requestInterviewToken: input?.interviewToken,
          requestKey: publishableKey,
          requestMethod: method,
          requestPath: path,
        },
      ) as BrowserApiResult<T>

    const session = successData<{
      sessionId: string
      sessionToken: string
      surveyRevision: number
      surveyConfig: {
        questions: Array<{
          id: string
          type: string
          required: boolean
        }>
      }
    }>(await publicRequest('/public-interview/sessions', 'POST', {
      body: {
        locale: 'ja',
        publicSlug: store.public_slug,
        turnstileToken,
      },
    }))
    const serviceQuestion = session.surveyConfig.questions.find(
      (question) => question.required && question.type === 'short_text',
    )
    const memorableQuestion = session.surveyConfig.questions.find(
      (question) => question.required && question.type === 'long_text',
    )
    if (!serviceQuestion || !memorableQuestion) {
      throw new Error('The default survey must contain required service and memorable questions')
    }
    const surveyAnswers = {
      [serviceQuestion.id]: { type: 'short_text', value: 'ランチセット' },
      [memorableQuestion.id]: {
        type: 'long_text',
        value: '静かな店内で落ち着いて過ごせました。',
      },
    }
    const sessionPath = `/public-interview/sessions/${session.sessionId}`
    successData(await publicRequest(`${sessionPath}/turns`, 'POST', {
      body: {
        kind: 'survey',
        surveyRevision: session.surveyRevision,
        answers: surveyAnswers,
      },
      interviewToken: session.sessionToken,
    }))

    const secondSessionId = crypto.randomUUID()
    const secondSurveyAnswers = {
      integration_service: { type: 'short_text', value: 'ディナーコース' },
      integration_memorable: {
        type: 'long_text',
        value: '説明が丁寧で、安心して過ごせました。',
      },
    }
    const { error: secondSessionError } = await admin
      .schema('api')
      .from('interview_sessions')
      .insert({
        id: secondSessionId,
        locale: 'ja',
        store_id: secondStore.id,
        structured_answers_json: {
          schemaVersion: 3,
          answers: secondSurveyAnswers,
        },
      })
    if (secondSessionError) {
      throw new Error('Could not create the second isolated answer fixture')
    }

    const foreignAnswerRead = await restRequestWithToken<unknown[]>(
      ownerAccessToken,
      `interview_sessions?select=id&id=eq.${encodeURIComponent(secondSessionId)}`,
    )
    if (foreignAnswerRead.status === 200) {
      expect(foreignAnswerRead.payload).toEqual([])
    } else {
      expect([403, 404]).toContain(foreignAnswerRead.status)
    }

    const foreignAnswerUpdate = await restRequestWithToken<unknown[]>(
      ownerAccessToken,
      `interview_sessions?id=eq.${encodeURIComponent(secondSessionId)}`,
      'PATCH',
      { edited_review: '他店舗へ保存してはならない文面' },
    )
    if (foreignAnswerUpdate.status >= 200 && foreignAnswerUpdate.status < 300) {
      expect(foreignAnswerUpdate.payload).toEqual([])
    } else {
      expect([403, 404]).toContain(foreignAnswerUpdate.status)
    }

    const secondOwnerAnswerRead = await restRequestWithToken<Array<{
      edited_review: string | null
      id: string
      structured_answers_json: unknown
    }>>(
      secondAccessToken,
      `interview_sessions?select=id,edited_review,structured_answers_json&id=eq.${encodeURIComponent(secondSessionId)}`,
    )
    expect(secondOwnerAnswerRead.status).toBe(200)
    expect(secondOwnerAnswerRead.payload).toEqual([{
      edited_review: null,
      id: secondSessionId,
      structured_answers_json: {
        schemaVersion: 3,
        answers: secondSurveyAnswers,
      },
    }])

    const failedGeneration = await publicRequest(`${sessionPath}/review`, 'POST', {
      interviewToken: session.sessionToken,
    })
    expect(failedGeneration.status).toBe(503)
    expect(failedGeneration.payload).toEqual({
      success: false,
      data: { answerSaved: true },
      error: {
        code: 'AI_GENERATION_FAILED',
        message: 'エラーが発生しました。',
        retryable: true,
      },
    })
    const expectedUnavailableConsoleError =
      'Failed to load resource: the server responded with a status of 503 (Service Unavailable)'
    expect(runtimeErrors).toEqual([expectedUnavailableConsoleError])
    runtimeErrors.splice(0, runtimeErrors.length)

    const persistedPublicFlow = await page.evaluate(
      async ({ requestApiUrl, requestKey, requestedSessionId }) => {
        const authStorageKey = Object.keys(localStorage).find(
          (key) => key.startsWith('sb-') && key.endsWith('-auth-token'),
        )
        const sessionValue = JSON.parse(
          localStorage.getItem(authStorageKey ?? '') ?? 'null',
        ) as { access_token?: string } | null
        if (!sessionValue?.access_token) throw new Error('Missing browser session')
        const headers = {
          Accept: 'application/json',
          'Accept-Profile': 'api',
          Authorization: `Bearer ${sessionValue.access_token}`,
          apikey: requestKey,
        }
        const sessionResponse = await fetch(
          `${requestApiUrl}/rest/v1/interview_sessions?select=id,structured_answers_json,generation_status&id=eq.${requestedSessionId}`,
          { headers },
        )
        return {
          rows: await sessionResponse.json(),
          sessionStatus: sessionResponse.status,
        }
      },
      {
        requestApiUrl: apiUrl,
        requestKey: publishableKey,
        requestedSessionId: session.sessionId,
      },
    )
    expect(persistedPublicFlow.sessionStatus).toBe(200)
    expect(persistedPublicFlow.rows).toEqual([{
      generation_status: 'failed',
      id: session.sessionId,
      structured_answers_json: {
        schemaVersion: 3,
        answers: surveyAnswers,
      },
    }])
  })
})
