import {
  BarChart3,
  HeartPulse,
  Images,
  MapPinned,
  MessageSquareReply,
  type LucideIcon,
} from 'lucide-react'
import type { Locale } from '../../shared/i18n'

export const MEO_FEATURE_KEYS = [
  'review_reply',
  'meo_rank',
  'gbp_insights',
  'gbp_health',
  'instagram_to_gbp',
] as const

export type MeoFeatureKey = (typeof MEO_FEATURE_KEYS)[number]
export type MeoFeatureStatus = 'hidden' | 'coming_soon' | 'available' | 'paused'
export type MeoExecutionMode = 'native' | 'owner_provider'

export type MeoFeatureCapability = {
  key: MeoFeatureKey
  title: string
  status: MeoFeatureStatus
  releaseAt: string | null
  executionMode: MeoExecutionMode
  reason: string | null
}

export type MeoFeatureCapabilitiesResponse = {
  serverTime: string
  features: MeoFeatureCapability[]
}

export type MeoFeatureDefinition = {
  key: MeoFeatureKey
  title: string
  shortTitle: string
  path: string
  icon: LucideIcon
}

const FEATURE_TITLES: Record<Locale, Record<MeoFeatureKey, Pick<MeoFeatureDefinition, 'title' | 'shortTitle'>>> = {
  ja: {
    review_reply: { title: '口コミ返信', shortTitle: '口コミ返信' }, meo_rank: { title: '順位チェック', shortTitle: '順位チェック' },
    gbp_insights: { title: 'Googleマップ分析', shortTitle: 'マップ分析' }, gbp_health: { title: 'プロフィール診断', shortTitle: 'プロフィール診断' },
    instagram_to_gbp: { title: 'Instagram投稿の再利用', shortTitle: 'Instagram再利用' },
  },
  en: {
    review_reply: { title: 'Review replies', shortTitle: 'Review replies' }, meo_rank: { title: 'Rank tracking', shortTitle: 'Rank tracking' },
    gbp_insights: { title: 'Google Maps analytics', shortTitle: 'Maps analytics' }, gbp_health: { title: 'Profile health check', shortTitle: 'Profile health' },
    instagram_to_gbp: { title: 'Reuse Instagram posts', shortTitle: 'Instagram reuse' },
  },
}

export const MEO_FEATURES: readonly MeoFeatureDefinition[] = [
  {
    key: 'review_reply',
    title: '口コミ返信',
    shortTitle: '口コミ返信',
    path: '/meo/review-reply',
    icon: MessageSquareReply,
  },
  {
    key: 'meo_rank',
    title: '順位チェック',
    shortTitle: '順位チェック',
    path: '/meo/rank',
    icon: MapPinned,
  },
  {
    key: 'gbp_insights',
    title: 'Googleマップ分析',
    shortTitle: 'マップ分析',
    path: '/meo/insights',
    icon: BarChart3,
  },
  {
    key: 'gbp_health',
    title: 'プロフィール診断',
    shortTitle: 'プロフィール診断',
    path: '/meo/health',
    icon: HeartPulse,
  },
  {
    key: 'instagram_to_gbp',
    title: 'Instagram投稿の再利用',
    shortTitle: 'Instagram再利用',
    path: '/meo/instagram',
    icon: Images,
  },
] as const

export function meoFeatureDefinition(key: MeoFeatureKey, locale: Locale = 'ja'): MeoFeatureDefinition {
  const feature = MEO_FEATURES.find((candidate) => candidate.key === key)
  if (!feature) throw new Error('UNKNOWN_MEO_FEATURE')
  return { ...feature, ...FEATURE_TITLES[locale][key] }
}

export function meoFeatureRoute(storeBasePath: string, key: MeoFeatureKey): string {
  return `${storeBasePath}${meoFeatureDefinition(key).path}`
}
