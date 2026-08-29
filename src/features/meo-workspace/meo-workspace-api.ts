import { ApiError, apiRequest } from '../../shared/api/http'
import { runtimeConfig } from '../../shared/config/runtime'

export const MEO_WORKSPACE_RESOURCES = [
  'profile',
  'snapshots',
  'reviews',
  'review_templates',
  'media',
  'posts',
  'rank_observations',
  'insights',
  'aio_citations',
  'aio_observations',
  'jsonld',
  'organizations',
  'groups',
  'members',
  'change_requests',
  'audit',
] as const

export type MeoWorkspaceResource = (typeof MEO_WORKSPACE_RESOURCES)[number]
export type MeoWorkspaceRole = 'owner' | 'admin' | 'editor' | 'analyst'

export type MeoWorkspaceAuthorization = {
  organizationId: string
  storeId: string
  role: MeoWorkspaceRole
  approvalRequired: boolean
}

export type MeoWorkspaceSnapshot = {
  authorization: MeoWorkspaceAuthorization
  organization: Record<string, unknown> | null
  store: Record<string, unknown> | null
  profile: Record<string, unknown> | null
  counts: Partial<Record<MeoWorkspaceResource, number>>
  generatedAt: string | null
}

export type MeoWorkspacePageResult<T> = {
  items: T[]
  nextCursor: string | null
}

type ListOptions = {
  cursor?: string | null
  limit?: number
  filters?: Record<string, string | number | undefined | null>
  signal?: AbortSignal
}

export type MeoWorkspaceMutationResult<T> = {
  data: T
  approvalRequired: boolean
  changeRequestId: string | null
}

export type MeoWorkspaceAccessibleStore = {
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
  is_publicly_available: boolean
  is_owned: boolean
  access_role: MeoWorkspaceRole
}

export type MeoWorkspaceInvitationAcceptance = {
  organizationId: string
  storeId: string
  role: Exclude<MeoWorkspaceRole, 'owner'>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const WORKSPACE_ROLES = new Set<MeoWorkspaceRole>(['owner', 'admin', 'editor', 'analyst'])

const E2E_STORE_ID = '22222222-2222-4222-8222-222222222222'
const E2E_ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'
const e2eResources = new Map<MeoWorkspaceResource, Record<string, unknown>[]>([
  ['reviews', [{ id: '55555555-5555-4555-8555-555555555555', provider: 'manual', reviewer_display_name: '田中様', rating: 4, review_text: '落ち着いて過ごせました。', language: 'ja', status: 'needs_reply', reply_history: [], reviewed_at: '2026-08-12T03:00:00.000Z', created_at: '2026-08-12T03:00:00.000Z' }]],
  ['review_templates', [{ id: '66666666-6666-4666-8666-666666666666', name: 'お礼', body: 'ご来店とご投稿をありがとうございます。', language: 'ja', status: 'active', created_at: '2026-08-11T03:00:00.000Z' }]],
  ['posts', [{ id: '77777777-7777-4777-8777-777777777777', post_type: 'update', title: '今週のお知らせ', summary: '今週も通常どおり営業しています。', status: 'ready', details: { language: 'ja' }, media_asset_ids: [], latest_revision: { revision: 1, fingerprint: 'a'.repeat(64) }, created_at: '2026-08-12T02:00:00.000Z' }]],
  ['rank_observations', [{ id: '88888888-8888-4888-8888-888888888888', keyword: 'カフェ ランチ', own_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4', own_position: 4, location_label: '駅前', input_method: 'manual', observed_at: '2026-08-12T01:00:00.000Z', created_at: '2026-08-12T01:00:00.000Z' }]],
  ['insights', [{ id: '99999999-9999-4999-8999-999999999999', period_start: '2026-07-01', period_end: '2026-07-31', source: 'manual', metrics: { searches: 120, views: 80, calls: 12, websiteClicks: 20, directionRequests: 15 }, created_at: '2026-08-12T00:00:00.000Z' }]],
  ['aio_citations', [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', source_name: 'Apple Business Connect', source_type: 'map', url: 'https://businessconnect.apple.com/', nap_snapshot: { business_name: 'みどりカフェ', address: '東京都新宿区1-1', phone: '03-1234-5678', website_url: 'https://example.test' }, consistency_status: 'consistent', last_checked_at: '2026-08-12T00:00:00.000Z', created_at: '2026-08-12T00:00:00.000Z' }]],
  ['groups', [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: '全店舗', description: '全店舗グループ', status: 'active', store_ids: [E2E_STORE_ID], created_at: '2026-08-10T00:00:00.000Z' }]],
  ['members', [{ user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', email: 'analyst@example.test', role: 'analyst', status: 'active', created_at: '2026-08-10T00:00:00.000Z' }]],
  ['change_requests', []],
  ['audit', []],
  ['snapshots', []],
  ['media', []],
  ['aio_observations', []],
  ['jsonld', []],
])

function e2eSnapshot(storeId: string): MeoWorkspaceSnapshot {
  return {
    authorization: { organizationId: E2E_ORGANIZATION_ID, storeId, role: 'owner', approvalRequired: false },
    organization: { id: E2E_ORGANIZATION_ID, name: 'クチトルZero E2E', approval_policy: 'owner_direct', status: 'active' },
    store: { id: storeId, name: storeId === E2E_STORE_ID ? 'みどりカフェ' : 'あおばカフェ', google_place_id: 'ChIJN1t_tDeuEmsRUsoyG83frY4' },
    profile: {
      businessName: storeId === E2E_STORE_ID ? 'みどりカフェ' : 'あおばカフェ',
      description: '地域のお客様に落ち着いた時間を届けるカフェです。丁寧な接客と季節のメニューを大切にしています。',
      primaryCategory: 'カフェ', additionalCategories: [], phoneNumbers: { primaryPhone: '03-1234-5678', additionalPhones: [] },
      websiteUri: 'https://example.test', languageCode: 'ja', openingDate: '2025-01-01',
      address: { postalCode: '160-0022', administrativeArea: '東京都', locality: '新宿区', addressLines: ['新宿1-1'] },
      serviceArea: {}, businessHours: { monday: '09:00-18:00' }, specialHours: [], moreHours: [], attributes: { takeout: true }, labels: [],
    },
    counts: {},
    generatedAt: new Date().toISOString(),
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && !Array.isArray(value) && typeof value === 'object'
    ? value as Record<string, unknown>
    : null
}

function invalidResponse(): never {
  throw new ApiError({
    code: 'INVALID_RESPONSE',
    message: 'MEO管理データを正しく読み込めませんでした。',
    status: 502,
    retryable: true,
  })
}

function nullableObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  const result = object(value)
  if (!result) invalidResponse()
  return result
}

function parseAuthorization(value: unknown, expectedStoreId: string): MeoWorkspaceAuthorization {
  const row = object(value)
  const organizationId = row?.organization_id ?? row?.organizationId
  const storeId = row?.store_id ?? row?.storeId
  const role = row?.role
  const approvalRequired = row?.approval_required ?? row?.approvalRequired
  if (
    typeof organizationId !== 'string'
    || !UUID_PATTERN.test(organizationId)
    || typeof storeId !== 'string'
    || storeId.toLowerCase() !== expectedStoreId.toLowerCase()
    || typeof role !== 'string'
    || !WORKSPACE_ROLES.has(role as MeoWorkspaceRole)
    || typeof approvalRequired !== 'boolean'
  ) invalidResponse()

  return {
    organizationId,
    storeId,
    role: role as MeoWorkspaceRole,
    approvalRequired,
  }
}

function parseCounts(value: unknown): Partial<Record<MeoWorkspaceResource, number>> {
  const row = object(value)
  if (!row) return {}
  const counts: Partial<Record<MeoWorkspaceResource, number>> = {}
  for (const resource of MEO_WORKSPACE_RESOURCES) {
    const count = row[resource]
    if (count === undefined) continue
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) invalidResponse()
    counts[resource] = count
  }
  return counts
}

function parseSnapshot(value: unknown, storeId: string): MeoWorkspaceSnapshot {
  const row = object(value)
  if (!row) invalidResponse()
  const generatedAt = row.generated_at ?? row.generatedAt ?? null
  if (
    generatedAt !== null
    && (typeof generatedAt !== 'string' || Number.isNaN(new Date(generatedAt).getTime()))
  ) invalidResponse()

  return {
    authorization: parseAuthorization(row.authorization ?? row.access, storeId),
    organization: nullableObject(row.organization),
    store: nullableObject(row.store),
    profile: nullableObject(row.profile),
    counts: parseCounts(row.counts),
    generatedAt,
  }
}

function encodeListQuery(options: ListOptions): string {
  const params = new URLSearchParams()
  if (options.cursor) params.set('cursor', options.cursor)
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  for (const [key, raw] of Object.entries(options.filters ?? {}).toSorted(([left], [right]) => left.localeCompare(right))) {
    if (raw === undefined || raw === null || raw === '') continue
    params.set(key, String(raw))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

function parsePage<T>(value: unknown): MeoWorkspacePageResult<T> {
  if (Array.isArray(value)) return { items: value as T[], nextCursor: null }
  const row = object(value)
  if (!row || !Array.isArray(row.items)) invalidResponse()
  const nextCursor = row.next_cursor ?? row.nextCursor ?? null
  if (nextCursor !== null && typeof nextCursor !== 'string') invalidResponse()
  return { items: row.items as T[], nextCursor }
}

function parseMutation<T>(value: unknown): MeoWorkspaceMutationResult<T> {
  const row = object(value)
  if (!row) return { data: value as T, approvalRequired: false, changeRequestId: null }
  const invitation = object(row.invitation)
  const result = row.result ?? row.data ?? row.record
  const approvalRequired = row.approval_required ?? row.approvalRequired
  const changeRequestId = row.change_request_id ?? row.changeRequestId
  if (approvalRequired === undefined && changeRequestId === undefined) {
    const resultObject = object(result)
    return {
      data: (invitation && resultObject
        ? { ...resultObject, invitation }
        : (result ?? value)) as T,
      approvalRequired: false,
      changeRequestId: null,
    }
  }
  if (typeof approvalRequired !== 'boolean') invalidResponse()
  if (
    changeRequestId !== null
    && changeRequestId !== undefined
    && typeof changeRequestId !== 'string'
  ) invalidResponse()
  return {
    data: (result ?? row) as T,
    approvalRequired,
    changeRequestId: changeRequestId ?? null,
  }
}

function basePath(storeId: string): string {
  return `/meo-workspace/v1/stores/${storeId}`
}

export async function getMeoWorkspaceAccessibleStores(
  signal?: AbortSignal,
): Promise<MeoWorkspaceAccessibleStore[]> {
  if (runtimeConfig.isE2ETestMode) {
    return [e2eSnapshot(E2E_STORE_ID), e2eSnapshot('88888888-8888-4888-8888-888888888888')].map(({ store }, index) => ({
      id: String(store?.id), owner_store_slot: index + 1, public_slug: index ? 'aoba-cafe-e2e' : 'midori-cafe-e2e',
      name: String(store?.name), industry: 'カフェ', address: null, description: null, website_url: null,
      welcome_message: null, closing_message: null, google_review_url: null,
      google_place_id: String(store?.google_place_id), status: 'published', archived_at: null, is_publicly_available: true,
      is_owned: index === 0, access_role: index === 0 ? 'owner' : 'editor',
    }))
  }
  const value = await apiRequest<unknown>('/meo-workspace/v1/stores', {
    ownerAuth: true,
    ...(signal ? { signal } : {}),
  })
  if (!Array.isArray(value)) invalidResponse()
  return value as MeoWorkspaceAccessibleStore[]
}

export async function acceptMeoWorkspaceInvitation(
  token: string,
): Promise<MeoWorkspaceInvitationAcceptance> {
  if (runtimeConfig.isE2ETestMode) {
    return { organizationId: E2E_ORGANIZATION_ID, storeId: E2E_STORE_ID, role: 'editor' }
  }
  const value = await apiRequest<unknown>('/meo-workspace/v1/invitations/accept', {
    method: 'POST',
    ownerAuth: true,
    body: { token },
  })
  const row = object(value)
  const organizationId = row?.organization_id ?? row?.organizationId
  const storeId = row?.store_id ?? row?.storeId
  const role = row?.role
  if (
    typeof organizationId !== 'string' || !UUID_PATTERN.test(organizationId)
    || typeof storeId !== 'string' || !UUID_PATTERN.test(storeId)
    || typeof role !== 'string' || !['admin', 'editor', 'analyst'].includes(role)
  ) invalidResponse()
  return { organizationId, storeId, role: role as MeoWorkspaceInvitationAcceptance['role'] }
}

export async function getMeoWorkspaceSnapshot(
  storeId: string,
  signal?: AbortSignal,
): Promise<MeoWorkspaceSnapshot> {
  if (runtimeConfig.isE2ETestMode) return e2eSnapshot(storeId)
  const value = await apiRequest<unknown>(`${basePath(storeId)}/snapshot`, {
    ownerAuth: true,
    ...(signal ? { signal } : {}),
  })
  return parseSnapshot(value, storeId)
}

export async function listMeoWorkspaceResource<T>(
  storeId: string,
  resource: MeoWorkspaceResource,
  options: ListOptions = {},
): Promise<MeoWorkspacePageResult<T>> {
  if (runtimeConfig.isE2ETestMode) {
    const values = resource === 'insights' && storeId !== E2E_STORE_ID
      ? [{ ...e2eResources.get('insights')?.[0], id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', metrics: { searches: 60, views: 40, calls: 4, websiteClicks: 10, directionRequests: 7 } }]
      : (e2eResources.get(resource) ?? [])
    return { items: structuredClone(values) as T[], nextCursor: null }
  }
  const value = await apiRequest<unknown>(
    `${basePath(storeId)}/resources/${resource}${encodeListQuery(options)}`,
    { ownerAuth: true, ...(options.signal ? { signal: options.signal } : {}) },
  )
  return parsePage<T>(value)
}

export async function mutateMeoWorkspaceResource<T>(
  storeId: string,
  resource: MeoWorkspaceResource,
  action: string,
  payload: Record<string, unknown>,
  recordId?: string | null,
): Promise<MeoWorkspaceMutationResult<T>> {
  if (runtimeConfig.isE2ETestMode) {
    const id = recordId ?? crypto.randomUUID()
    const data = { id, ...payload }
    const rows = e2eResources.get(resource)
    if (rows) {
      const index = rows.findIndex((row) => row.id === id || row.user_id === id)
      if (action === 'delete' && index >= 0) rows.splice(index, 1)
      else if (index >= 0) rows[index] = { ...rows[index], ...data }
      else if (action === 'create' || action === 'save') rows.unshift(data)
    }
    return { data: structuredClone(data) as T, approvalRequired: false, changeRequestId: null }
  }
  const value = await apiRequest<unknown>(
    `${basePath(storeId)}/resources/${resource}/${action}`,
    {
      method: 'POST',
      ownerAuth: true,
      body: { ...(recordId ? { recordId } : {}), payload },
    },
  )
  return parseMutation<T>(value)
}

export const __test = { encodeListQuery, parsePage, parseSnapshot }
