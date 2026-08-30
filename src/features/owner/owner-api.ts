import { apiRequest } from '../../shared/api/http'
import { runtimeConfig } from '../../shared/config/runtime'
import { supabase } from '../../shared/api/supabase'
import type { AiProviderName } from '../../shared/ai-providers'
import { parseSurveyRevisionSnapshots, type SurveyRevisionSnapshot } from './interview-answer-export'
import { getMeoWorkspaceAccessibleStores } from '../meo-workspace/meo-workspace-api'

export type StoreRecord = {
  id: string
  owner_store_slot: number
  public_slug: string
  name: string
  industry: string | null
  address: string | null
  description: string | null
  website_url: string | null
  welcome_message: string | null
  closing_message: string | null
  google_review_url: string | null
  google_place_id: string | null
  status: 'draft' | 'published' | 'paused'
  archived_at: string | null
}

export type OwnerStoreListRecord = StoreRecord & {
  is_publicly_available: boolean
  is_owned?: boolean
  access_role?: 'owner' | 'admin' | 'editor' | 'analyst'
}

export type AiConnection = {
  provider: AiProviderName
  model: string
  status: 'active' | 'invalid' | 'revoked' | 'error'
  keyLast4: string
}

export type InterviewRow = {
  id: string
  created_at: string
  status: string
  rating: number | null
  visit_frequency: string | null
  generation_status: string
  generated_review: string | null
  edited_review: string | null
  generation_provider: string | null
  google_handoff_opened_at: string | null
  completed_at: string | null
  survey_revision: number | null
  structured_answers_json: unknown
  resolved_survey_config_json?: unknown
}

type InterviewSurveySnapshotRow = {
  session_id: string
  resolved_config_json: unknown
}

async function getInterviewSurveySnapshots(storeId: string, sessionIds: string[]): Promise<Map<string, unknown>> {
  if (runtimeConfig.isE2ETestMode || sessionIds.length === 0) return new Map()
  const rows = await apiRequest<InterviewSurveySnapshotRow[]>(
    `/owner-api/v2/stores/${storeId}/interview-survey-snapshots`,
    { method: 'POST', body: { sessionIds }, ownerAuth: true },
  )
  return new Map(rows.map((row) => [row.session_id, row.resolved_config_json]))
}

export type MonthlySummary = {
  period_start: string
  period_end: string
  started: number
  completed: number
  completion_rate: number
  generation_succeeded: number
  google_handoffs: number
  average_rating: number | null
  previous_started: number
  started_change: number
  rating_distribution: Record<string, number>
}

const E2E_STORE: StoreRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  owner_store_slot: 1,
  public_slug: 'midori-cafe-e2e',
  name: 'みどりカフェ',
  industry: 'カフェ',
  address: '',
  description: 'お客様の声を、これからのお店づくりに生かします。',
  website_url: null,
  welcome_message: 'ご来店ありがとうございました。',
  closing_message: 'ご回答ありがとうございました。',
  google_review_url: 'https://search.google.com/local/writereview?placeid=e2e',
  google_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
  status: 'published',
  archived_at: null,
}

const E2E_SECOND_STORE: StoreRecord = {
  ...E2E_STORE,
  id: '88888888-8888-4888-8888-888888888888',
  owner_store_slot: 2,
  public_slug: 'aoba-cafe-e2e',
  name: 'あおばカフェ',
}

const E2E_ROWS: InterviewRow[] = [
  {
    id: '33333333-3333-4333-8333-333333333333',
    created_at: '2026-07-10T05:32:00.000Z',
    status: 'completed',
    rating: 4,
    visit_frequency: 'occasional',
    generation_status: 'succeeded',
    generated_review: '希望を丁寧に聞いてもらえたので安心できました。',
    edited_review: '希望を丁寧に聞いてもらえたので安心できました。',
    generation_provider: 'openai',
    google_handoff_opened_at: '2026-07-10T05:40:00.000Z',
    completed_at: '2026-07-10T05:38:00.000Z',
    survey_revision: 1,
    structured_answers_json: {
      schemaVersion: 3,
      answers: {
        q_000000000003: { type: 'short_text', value: 'カット' },
        q_000000000004: { type: 'long_text', value: '希望を確認しながら進めてもらえました。' },
      },
    },
  },
]

export async function getOwnerStores(): Promise<OwnerStoreListRecord[]> {
  if (runtimeConfig.isE2ETestMode) {
    return [E2E_STORE, E2E_SECOND_STORE].map((store) => ({
      ...store,
      is_publicly_available: store.status === 'published',
    }))
  }
  return getMeoWorkspaceAccessibleStores()
}

export async function getOwnerStore(storeId: string): Promise<StoreRecord | null> {
  if (runtimeConfig.isE2ETestMode) {
    return storeId === E2E_SECOND_STORE.id ? E2E_SECOND_STORE : E2E_STORE
  }
  return apiRequest<StoreRecord>(`/owner-api/v2/stores/${storeId}`, { ownerAuth: true })
}

export async function createOwnerStore(
  input: Record<string, unknown>,
  idempotencyKey: string,
): Promise<StoreRecord> {
  if (runtimeConfig.isE2ETestMode) return { ...E2E_STORE, ...(input as Partial<StoreRecord>) }
  return apiRequest<StoreRecord>('/owner-api/v2/stores', {
    method: 'POST',
    body: input,
    ownerAuth: true,
    idempotencyKey,
  })
}

export async function saveOwnerStore(storeId: string, input: Record<string, unknown>): Promise<StoreRecord> {
  if (runtimeConfig.isE2ETestMode) return { ...E2E_STORE, ...(input as Partial<StoreRecord>) }
  return apiRequest<StoreRecord>(`/owner-api/v2/stores/${storeId}`, { method: 'PATCH', body: input, ownerAuth: true })
}

export async function setStorePublished(storeId: string, published: boolean): Promise<void> {
  if (runtimeConfig.isE2ETestMode) return
  await apiRequest(`/owner-api/v2/stores/${storeId}/${published ? 'publish' : 'pause'}`, {
    method: 'POST',
    ownerAuth: true,
  })
}

export async function getAiConnection(storeId: string): Promise<AiConnection | null> {
  if (runtimeConfig.isE2ETestMode) {
    return { provider: 'openai', model: 'gpt-5-mini', status: 'active', keyLast4: '4821' }
  }
  return apiRequest<AiConnection | null>(`/owner-api/v2/stores/${storeId}/ai-connection`, { ownerAuth: true })
}

export async function getAiConnections(storeId: string): Promise<AiConnection[]> {
  if (runtimeConfig.isE2ETestMode) {
    const active = await getAiConnection(storeId)
    return active ? [active] : []
  }
  return apiRequest<AiConnection[]>(`/owner-api/v2/stores/${storeId}/ai-connections`, { ownerAuth: true })
}

export async function validateAndSaveAiConnection(storeId: string, input: {
  provider: AiProviderName
  model: string
  apiKey: string
  activate?: boolean
}): Promise<AiConnection> {
  if (runtimeConfig.isE2ETestMode) {
    return { provider: input.provider, model: input.model, status: 'active', keyLast4: '4821' }
  }
  return apiRequest<AiConnection>(`/owner-api/v2/stores/${storeId}/ai-connection/validate-and-save`, {
    method: 'POST',
    body: input,
    ownerAuth: true,
  })
}

export async function revalidateAiConnection(storeId: string, provider: AiProviderName): Promise<AiConnection> {
  if (runtimeConfig.isE2ETestMode) return { provider, model: 'gpt-5-mini', status: 'active', keyLast4: '4821' }
  return apiRequest<AiConnection>(`/owner-api/v2/stores/${storeId}/ai-connection/revalidate`, { method: 'POST', body: { provider }, ownerAuth: true })
}

export async function selectAiProvider(storeId: string, provider: AiProviderName): Promise<AiConnection> {
  if (runtimeConfig.isE2ETestMode) return { provider, model: 'gpt-5-mini', status: 'active', keyLast4: '4821' }
  return apiRequest<AiConnection>(`/owner-api/v2/stores/${storeId}/ai-connection/select-provider`, { method: 'POST', body: { provider }, ownerAuth: true })
}

export async function selectAiModel(storeId: string, provider: AiProviderName, model: string): Promise<AiConnection> {
  if (runtimeConfig.isE2ETestMode) return { provider, model, status: 'active', keyLast4: '4821' }
  return apiRequest<AiConnection>(`/owner-api/v2/stores/${storeId}/ai-connection/select-model`, { method: 'POST', body: { provider, model }, ownerAuth: true })
}

export async function deleteAiConnection(storeId: string, provider: AiProviderName): Promise<void> {
  if (runtimeConfig.isE2ETestMode) return
  await apiRequest(`/owner-api/v2/stores/${storeId}/ai-connection?provider=${provider}`, { method: 'DELETE', ownerAuth: true })
}

export async function getMonthlySummary(storeId: string, periodStart?: string): Promise<MonthlySummary | null> {
  if (runtimeConfig.isE2ETestMode) {
    return {
      period_start: '2026-07-01', period_end: '2026-08-01', started: 40, completed: 32,
      completion_rate: 80, generation_succeeded: 30, google_handoffs: 18,
      average_rating: 4.2, previous_started: 35, started_change: 5,
      rating_distribution: { '3': 4, '4': 16, '5': 12 },
    }
  }
  if (supabase === null) return null
  const { data, error } = await supabase.rpc('owner_monthly_summary_v2', {
    p_store_id: storeId,
    p_period_start: periodStart ?? null,
  })
  if (error) throw new Error('月次サマリーを取得できませんでした。')
  return data as MonthlySummary
}

export async function getInterviewHistory(storeId: string, cursor?: { createdAt: string; id: string }): Promise<{
  rows: InterviewRow[]
  nextCursor: { createdAt: string; id: string } | null
}> {
  if (runtimeConfig.isE2ETestMode) return { rows: E2E_ROWS, nextCursor: null }
  if (supabase === null) return { rows: [], nextCursor: null }
  let query = supabase
    .from('interview_sessions')
    .select('id,created_at,status,rating,visit_frequency,generation_status,generated_review,edited_review,generation_provider,google_handoff_opened_at,completed_at,survey_revision,structured_answers_json')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(21)
    .eq('store_id', storeId)
  if (cursor) {
    query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
  }
  const { data, error } = await query
  if (error) throw new Error('回答履歴を取得できませんでした。')
  const rawRows = (data ?? []) as InterviewRow[]
  const snapshotBySession = await getInterviewSurveySnapshots(storeId, rawRows.map((row) => row.id))
  const rows = rawRows.map((row) => ({
    ...row,
    ...(snapshotBySession.has(row.id)
      ? { resolved_survey_config_json: snapshotBySession.get(row.id) }
      : {}),
  }))
  const page = rows.slice(0, 20)
  const last = page.at(-1)
  return {
    rows: page,
    nextCursor: rows.length > 20 && last ? { createdAt: last.created_at, id: last.id } : null,
  }
}

export async function getInterviewDetail(storeId: string, id: string): Promise<{
  session: InterviewRow | null
  messages: Array<{ id: string; sequence: number; role: 'assistant' | 'user'; content: string; created_at: string }>
  surveyRevisions: SurveyRevisionSnapshot[]
}> {
  if (runtimeConfig.isE2ETestMode) return { session: E2E_ROWS[0] ?? null, messages: [], surveyRevisions: E2E_SURVEY_REVISIONS }
  if (supabase === null) return { session: null, messages: [], surveyRevisions: [] }
  const [sessionResult, messagesResult, snapshotBySession] = await Promise.all([
    supabase.from('interview_sessions').select('*').eq('id', id).eq('store_id', storeId).maybeSingle(),
    supabase.from('interview_messages').select('id,sequence,role,content,created_at').eq('session_id', id).eq('store_id', storeId).order('sequence'),
    getInterviewSurveySnapshots(storeId, [id]),
  ])
  if (sessionResult.error || messagesResult.error) throw new Error('回答詳細を取得できませんでした。')
  const rawSession = sessionResult.data as InterviewRow | null
  const session = rawSession === null ? null : {
    ...rawSession,
    ...(snapshotBySession.has(rawSession.id)
      ? { resolved_survey_config_json: snapshotBySession.get(rawSession.id) }
      : {}),
  }
  const surveyRevisions = session?.survey_revision === null ? [] : await getSurveyRevisions(storeId)
  return {
    session,
    messages: (messagesResult.data ?? []) as Array<{ id: string; sequence: number; role: 'assistant' | 'user'; content: string; created_at: string }>,
    surveyRevisions,
  }
}

const E2E_SURVEY_REVISIONS = parseSurveyRevisionSnapshots([{
  revision: 1,
  config: {
    version: 3,
    presetId: 'restaurant',
    title: 'テスト店舗アンケート',
    description: '保存した設問が公開画面へ反映されています。',
    revision: 1,
    questions: [
      { id: 'q_000000000001', type: 'single_choice', label: '来店頻度', required: false, role: 'visit_frequency', options: [{ value: 'first', label: '初めて' }, { value: 'regular', label: 'よく利用する' }], allowOther: false },
      { id: 'q_000000000002', type: 'rating_5', label: '今回の評価', required: false, role: 'rating', lowLabel: '物足りない', highLabel: 'とても良い' },
      { id: 'q_000000000003', type: 'short_text', label: '利用したメニュー・サービス', required: true, maxLength: 120 },
      { id: 'q_000000000004', type: 'long_text', label: '今回、特に印象に残ったこと', required: true, maxLength: 400 },
      { id: 'q_000000000005', type: 'long_text', label: '改善してほしいこと', required: false, maxLength: 400 },
    ],
  },
}])

export async function getSurveyRevisions(storeId: string): Promise<SurveyRevisionSnapshot[]> {
  if (runtimeConfig.isE2ETestMode) return E2E_SURVEY_REVISIONS
  return parseSurveyRevisionSnapshots(
    await apiRequest<unknown>(`/owner-api/v2/stores/${storeId}/survey-revisions`, { ownerAuth: true }),
  )
}

export async function getAllInterviewRows(storeId: string): Promise<InterviewRow[]> {
  if (runtimeConfig.isE2ETestMode) return E2E_ROWS
  const allRows: InterviewRow[] = []
  let cursor: { createdAt: string; id: string } | undefined
  for (;;) {
    const page = await getInterviewHistory(storeId, cursor)
    allRows.push(...page.rows)
    if (page.nextCursor === null) break
    cursor = page.nextCursor
  }
  return allRows
}
