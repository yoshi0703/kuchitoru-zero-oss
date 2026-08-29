import { queryOptions } from '@tanstack/react-query'
import { ApiError, apiRequest } from '../../shared/api/http'
import type { Locale } from '../../shared/i18n'
import {
  MEO_FEATURE_KEYS,
  type MeoExecutionMode,
  type MeoFeatureCapabilitiesResponse,
  type MeoFeatureCapability,
  type MeoFeatureKey,
  type MeoFeatureStatus,
} from './feature-registry'

const statuses = new Set<MeoFeatureStatus>(['hidden', 'coming_soon', 'available', 'paused'])
const executionModes = new Set<MeoExecutionMode>(['native', 'owner_provider'])
const featureKeys = new Set<string>(MEO_FEATURE_KEYS)

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime())
}

function isFeatureCapability(value: unknown): value is MeoFeatureCapability {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.key === 'string'
    && featureKeys.has(candidate.key)
    && typeof candidate.title === 'string'
    && candidate.title.trim() !== ''
    && statuses.has(candidate.status as MeoFeatureStatus)
    && isNullableString(candidate.releaseAt)
    && (candidate.releaseAt === null || isTimestamp(candidate.releaseAt))
    && executionModes.has(candidate.executionMode as MeoExecutionMode)
    && isNullableString(candidate.reason)
  )
}

function parseCapabilities(value: unknown, locale: Locale): MeoFeatureCapabilitiesResponse {
  if (!value || typeof value !== 'object') throwInvalidResponse(locale)
  const candidate = value as Record<string, unknown>
  if (
    !isTimestamp(candidate.serverTime)
    || !Array.isArray(candidate.features)
    || !candidate.features.every(isFeatureCapability)
  ) {
    throwInvalidResponse(locale)
  }

  const byKey = new Map<MeoFeatureKey, MeoFeatureCapability>()
  for (const feature of candidate.features as MeoFeatureCapability[]) {
    if (byKey.has(feature.key)) throwInvalidResponse(locale)
    byKey.set(feature.key, feature)
  }
  for (const featureKey of MEO_FEATURE_KEYS) {
    if (!byKey.has(featureKey)) throwInvalidResponse(locale)
  }
  if (byKey.size !== MEO_FEATURE_KEYS.length) throwInvalidResponse(locale)

  return {
    serverTime: candidate.serverTime,
    features: MEO_FEATURE_KEYS.map((featureKey) => {
      const feature = byKey.get(featureKey)
      if (!feature) throwInvalidResponse(locale)
      return feature
    }),
  }
}

function throwInvalidResponse(locale: Locale = 'ja'): never {
  throw new ApiError({
    code: 'INVALID_RESPONSE',
    message: locale === 'ja' ? '新機能の公開状態を確認できませんでした。' : 'Feature availability could not be verified.',
    status: 502,
    retryable: true,
  })
}

export async function getMeoFeatureCapabilities(storeId?: string, locale: Locale = 'ja'): Promise<MeoFeatureCapabilitiesResponse> {
  const path = storeId
    ? `/owner-api/v2/stores/${encodeURIComponent(storeId)}/feature-capabilities`
    : '/owner-api/v2/feature-capabilities'
  const data = await apiRequest<unknown>(path, { ownerAuth: true })
  return parseCapabilities(data, locale)
}

export function meoFeatureCapabilitiesQueryOptions(storeId?: string) {
  return queryOptions({
    queryKey: ['meo-feature-capabilities', storeId],
    queryFn: () => getMeoFeatureCapabilities(storeId),
    staleTime: 60_000,
  })
}
