import { apiRequest } from '../../shared/api/http'

export type MeoExternalProvider = 'google_business' | 'instagram' | 'dataforseo'
export type MeoOauthProvider = Exclude<MeoExternalProvider, 'dataforseo'>

export type MeoConnection = {
  provider: MeoExternalProvider
  status: 'active' | 'invalid' | 'revoked' | 'error'
  displayName: string | null
  locationName: string | null
  expiresAt: string | null
  connectedAt: string | null
  safeErrorCode: string | null
}

export type MeoExternalWriteSettings = {
  enabled: boolean
  canManage: boolean
  canExecute: boolean
}

export type GoogleBusinessLocation = {
  name: string
  title: string
  accountName: string
  storefrontAddress: string | null
  latlng: {
    latitude: number
    longitude: number
  } | null
}

export type ReviewReplyDraft = {
  reply: string
  source: 'template' | 'owner_provider'
  requiresReview: true
}

export type GoogleReview = {
  name: string
  reviewerName: string | null
  rating: number | null
  comment: string | null
  createTime: string | null
  updateTime: string | null
  replyComment: string | null
  replyUpdateTime: string | null
}

export type InstagramMedia = {
  id: string
  caption: string | null
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'UNKNOWN'
  mediaUrl: string | null
  permalink: string | null
  timestamp: string | null
}

export type GbpPostDraft = {
  summary: string
  removedHashtags: string[]
  requiresReview: true
}

export type RankCompetitorPosition = {
  place_id: string
  position: number | null
}

export type RankHistoryItem = {
  id: string
  keyword: string
  target_place_id: string
  position: number | null
  competitor_positions: RankCompetitorPosition[]
  source: 'manual' | 'owner_provider'
  observed_at: string
  result_count: number | null
}

export type InsightMetrics = {
  searches?: number
  views?: number
  websiteClicks?: number
  calls?: number
  directionRequests?: number
  bookings?: number
  orders?: number
  messages?: number
}

export type InsightSnapshot = {
  id: string
  period_start: string
  period_end: string
  source: 'manual' | 'google_business'
  metrics: InsightMetrics
  updated_at: string
}

export type GbpHealthResult = {
  score: number
  checks: unknown[]
}

export type GbpHealthLatestResult = {
  source: 'manual' | 'google_business'
  diagnosedAt: string
  result: GbpHealthResult
}

function storePath(storeId: string, suffix: string): string {
  return `/meo-api/v1/stores/${storeId}${suffix}`
}

export function getMeoConnections(storeId: string): Promise<MeoConnection[]> {
  return apiRequest(storePath(storeId, '/connections'), { ownerAuth: true })
}

export function getMeoExternalWriteSettings(storeId: string): Promise<MeoExternalWriteSettings> {
  return apiRequest(storePath(storeId, '/external-writes'), { ownerAuth: true })
}

export function updateMeoExternalWriteSettings(
  storeId: string,
  enabled: boolean,
  idempotencyKey: string,
): Promise<MeoExternalWriteSettings> {
  return apiRequest(storePath(storeId, '/external-writes'), {
    method: 'PATCH',
    body: { enabled },
    ownerAuth: true,
    idempotencyKey,
  })
}

export function startMeoOauthConnection(
  storeId: string,
  provider: MeoOauthProvider,
  input: { challenge: string },
): Promise<{ authorizationUrl: string }> {
  return apiRequest(storePath(storeId, `/connections/${provider}/start`), {
    method: 'POST',
    body: input,
    ownerAuth: true,
  })
}

export function completeMeoOauthConnection(
  storeId: string,
  provider: MeoOauthProvider,
  input: { state: string; code: string; verifier: string },
  idempotencyKey: string,
): Promise<{ connected: true; selectLocation: boolean }> {
  return apiRequest(storePath(storeId, `/connections/${provider}/complete`), {
    method: 'POST',
    body: input,
    ownerAuth: true,
    idempotencyKey,
  })
}

export function saveDataForSeoConnection(
  storeId: string,
  input: { login: string; password: string },
): Promise<MeoConnection> {
  return apiRequest(storePath(storeId, '/connections/dataforseo'), {
    method: 'POST',
    body: input,
    ownerAuth: true,
  })
}

export function getGoogleBusinessLocations(storeId: string): Promise<GoogleBusinessLocation[]> {
  return apiRequest(storePath(storeId, '/connections/google_business/locations'), { ownerAuth: true })
}

export function selectGoogleBusinessLocation(storeId: string, locationName: string): Promise<MeoConnection> {
  return apiRequest(storePath(storeId, '/connections/google_business/location'), {
    method: 'PATCH',
    body: { locationName },
    ownerAuth: true,
  })
}

export function disconnectMeoProvider(storeId: string, provider: MeoExternalProvider): Promise<{ disconnected: true }> {
  return apiRequest(storePath(storeId, `/connections/${provider}`), {
    method: 'DELETE',
    ownerAuth: true,
  })
}

export function createReviewReplyDraft(
  storeId: string,
  input: {
    rating: number
    reviewComment: string
    reviewerName?: string
    storeName?: string
    tone: 'polite' | 'warm' | 'short'
    locale: 'ja' | 'en'
    generationMode?: 'template' | 'owner_provider'
  },
): Promise<ReviewReplyDraft> {
  return apiRequest(storePath(storeId, '/review-replies/draft'), {
    method: 'POST',
    body: input,
    ownerAuth: true,
  })
}

export function getGoogleReviews(storeId: string): Promise<GoogleReview[]> {
  return apiRequest(storePath(storeId, '/reviews'), { ownerAuth: true })
}

export function publishGoogleReviewReply(
  storeId: string,
  input: { reviewName: string; comment: string; confirmed: true },
): Promise<{ sent: true; sentAt: string }> {
  return apiRequest(storePath(storeId, '/reviews/reply'), {
    method: 'POST',
    body: input,
    ownerAuth: true,
  })
}

export function getRankHistory(storeId: string): Promise<RankHistoryItem[]> {
  return apiRequest(storePath(storeId, '/rank'), { ownerAuth: true })
}

export function saveManualRank(
  storeId: string,
  input: { keyword: string; targetPlaceId: string; position: number | null; observedAt?: string },
): Promise<Record<string, unknown>> {
  return apiRequest(storePath(storeId, '/rank/manual'), {
    method: 'POST',
    body: input,
    ownerAuth: true,
  })
}

export function requestRankMeasurement(
  storeId: string,
  input: {
    keyword: string
    targetPlaceId: string
    competitorPlaceIds: string[]
    latitude: number
    longitude: number
    zoom?: number
    credentialSource: 'owner_provider'
  },
): Promise<Record<string, unknown>> {
  return apiRequest(storePath(storeId, '/rank/measure'), {
    method: 'POST',
    body: input,
    ownerAuth: true,
  })
}

export function saveManualInsights(
  storeId: string,
  input: {
    periodStart: string
    periodEnd: string
    current: Record<string, number>
    previous: Record<string, number>
  },
): Promise<Record<string, unknown>> {
  return apiRequest(storePath(storeId, '/insights/manual'), {
    method: 'POST',
    body: input,
    ownerAuth: true,
  })
}

export function getInsightHistory(storeId: string): Promise<InsightSnapshot[]> {
  return apiRequest(storePath(storeId, '/insights'), { ownerAuth: true })
}

export function syncGoogleInsights(
  storeId: string,
  input: { periodStart: string; periodEnd: string },
): Promise<InsightSnapshot> {
  return apiRequest(storePath(storeId, '/insights/sync'), {
    method: 'POST',
    body: input,
    ownerAuth: true,
  })
}

export function checkGbpHealth(
  storeId: string,
  input: Record<string, unknown>,
  idempotencyKey: string,
): Promise<GbpHealthLatestResult> {
  return apiRequest(storePath(storeId, '/health/check'), {
    method: 'POST',
    body: input,
    ownerAuth: true,
    idempotencyKey,
  })
}

export function getLatestGbpHealthResult(storeId: string): Promise<GbpHealthLatestResult | null> {
  return apiRequest(storePath(storeId, '/health/latest'), { ownerAuth: true })
}

export function createInstagramGbpDraft(
  storeId: string,
  input: { caption: string; excludedHashtags?: string[] },
): Promise<GbpPostDraft> {
  return apiRequest(storePath(storeId, '/instagram/draft'), {
    method: 'POST',
    body: input,
    ownerAuth: true,
  })
}

export function getInstagramMedia(storeId: string): Promise<InstagramMedia[]> {
  return apiRequest(storePath(storeId, '/instagram/media'), { ownerAuth: true })
}

export function publishInstagramDraftToGoogle(
  storeId: string,
  input: { summary: string; imageUrl?: string; confirmed: true },
): Promise<{ published: true; publishedAt: string }> {
  return apiRequest(storePath(storeId, '/instagram/publish'), {
    method: 'POST',
    body: input,
    ownerAuth: true,
  })
}
