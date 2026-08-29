import { runtimeConfig } from '../config/runtime'
import { createIdempotencyKey } from '../lib/idempotency'
import { supabase } from './supabase'

type ApiFailureBody = {
  success: false
  error: { code: string; message: string; retryable: boolean }
  data?: { answerSaved?: boolean }
}

type ApiSuccessBody<T> = { success: true; data: T }

export class ApiError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly status: number
  readonly answerSaved: boolean

  constructor(input: {
    message: string
    code?: string
    retryable?: boolean
    status?: number
    answerSaved?: boolean
  }) {
    super(input.message)
    this.name = 'ApiError'
    this.code = input.code ?? 'INTERNAL_ERROR'
    this.retryable = input.retryable ?? false
    this.status = input.status ?? 500
    this.answerSaved = input.answerSaved ?? false
  }
}

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  ownerAuth?: boolean
  interviewToken?: string
  idempotencyKey?: string
  signal?: AbortSignal
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  if (runtimeConfig.supabaseUrl === '' || runtimeConfig.supabasePublishableKey === '') {
    throw new ApiError({
      code: 'SERVICE_NOT_CONFIGURED',
      message: 'サービス設定を確認してください。',
      status: 503,
    })
  }

  const headers = new Headers({
    Accept: 'application/json',
    apikey: runtimeConfig.supabasePublishableKey,
  })
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (options.interviewToken !== undefined) {
    headers.set('X-Interview-Token', options.interviewToken)
  }
  if (options.method !== undefined && options.method !== 'GET') {
    headers.set('Idempotency-Key', options.idempotencyKey ?? createIdempotencyKey())
  }

  if (options.ownerAuth === true) {
    const accessToken = runtimeConfig.isE2ETestMode
      ? 'e2e-owner-access-token'
      : ((await supabase?.auth.getSession()) ?? { data: { session: null } }).data.session?.access_token
    if (accessToken === undefined) {
      throw new ApiError({ code: 'UNAUTHORIZED', message: 'ログインが必要です。', status: 401 })
    }
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  let response: Response
  try {
    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      cache: 'no-store',
      credentials: 'omit',
    }
    if (options.body !== undefined) init.body = JSON.stringify(options.body)
    if (options.signal !== undefined) init.signal = options.signal
    response = await fetch(`${runtimeConfig.supabaseUrl}/functions/v1${path}`, init)
  } catch {
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: '通信できませんでした。接続を確認して、もう一度お試しください。',
      retryable: true,
      status: 0,
    })
  }

  let payload: ApiSuccessBody<T> | ApiFailureBody
  try {
    payload = (await response.json()) as ApiSuccessBody<T> | ApiFailureBody
  } catch {
    throw new ApiError({
      code: 'INVALID_RESPONSE',
      message: 'サーバーから正しい応答を受け取れませんでした。',
      retryable: response.status >= 500,
      status: response.status,
    })
  }

  if (!response.ok || payload.success === false) {
    const failure = payload as ApiFailureBody
    throw new ApiError({
      code: failure.error?.code ?? 'INTERNAL_ERROR',
      message: failure.error?.message ?? '処理を完了できませんでした。',
      retryable: failure.error?.retryable ?? false,
      status: response.status,
      answerSaved: failure.data?.answerSaved ?? false,
    })
  }

  return payload.data
}
