import { lazy, Suspense } from 'react'
import { LoadingState } from '../../shared/ui/ui'
import { useI18n } from '../../shared/i18n'

const ReviewReplyPage = lazy(() => import('./MeoFeaturePages').then((module) => ({ default: module.ReviewReplyPage })))
const MeoRankPage = lazy(() => import('./MeoFeaturePages').then((module) => ({ default: module.MeoRankPage })))
const GbpInsightsPage = lazy(() => import('./MeoFeaturePages').then((module) => ({ default: module.GbpInsightsPage })))
const GbpHealthPage = lazy(() => import('./MeoFeaturePages').then((module) => ({ default: module.GbpHealthPage })))
const InstagramToGbpPage = lazy(() => import('./MeoFeaturePages').then((module) => ({ default: module.InstagramToGbpPage })))

function PageFallback() {
  const { locale } = useI18n()
  return <LoadingState label={locale === 'ja' ? '機能を読み込んでいます' : 'Loading feature'} />
}

export function LazyReviewReplyPage() {
  return <Suspense fallback={<PageFallback />}><ReviewReplyPage /></Suspense>
}

export function LazyMeoRankPage() {
  return <Suspense fallback={<PageFallback />}><MeoRankPage /></Suspense>
}

export function LazyGbpInsightsPage() {
  return <Suspense fallback={<PageFallback />}><GbpInsightsPage /></Suspense>
}

export function LazyGbpHealthPage() {
  return <Suspense fallback={<PageFallback />}><GbpHealthPage /></Suspense>
}

export function LazyInstagramToGbpPage() {
  return <Suspense fallback={<PageFallback />}><InstagramToGbpPage /></Suspense>
}
