import { lazy, Suspense } from 'react'
import { LoadingState } from '../../shared/ui/ui'
import { useI18n } from '../../shared/i18n'

const GbpProfileWorkspacePage = lazy(() => import('./P0WorkspacePages').then((module) => ({ default: module.GbpProfileWorkspacePage })))
const ReviewInboxWorkspacePage = lazy(() => import('./P0WorkspacePages').then((module) => ({ default: module.ReviewInboxWorkspacePage })))
const PostWorkspacePage = lazy(() => import('./P0WorkspacePages').then((module) => ({ default: module.PostWorkspacePage })))
const PerformanceWorkspacePage = lazy(() => import('./P0WorkspacePages').then((module) => ({ default: module.PerformanceWorkspacePage })))
const AioWorkspacePage = lazy(() => import('./P1WorkspacePages').then((module) => ({ default: module.AioWorkspacePage })))
const MultiStoreWorkspacePage = lazy(() => import('./P1WorkspacePages').then((module) => ({ default: module.MultiStoreWorkspacePage })))

function WorkspaceFallback() {
  const { text } = useI18n()
  return <LoadingState label={text({ ja: 'MEO管理を読み込んでいます', en: 'Loading MEO workspace' })} />
}

function lazyPage(Page: React.ComponentType) {
  return <Suspense fallback={<WorkspaceFallback />}><Page /></Suspense>
}

export function LazyGbpProfileWorkspacePage() { return lazyPage(GbpProfileWorkspacePage) }
export function LazyReviewInboxWorkspacePage() { return lazyPage(ReviewInboxWorkspacePage) }
export function LazyPostWorkspacePage() { return lazyPage(PostWorkspacePage) }
export function LazyPerformanceWorkspacePage() { return lazyPage(PerformanceWorkspacePage) }
export function LazyAioWorkspacePage() { return lazyPage(AioWorkspacePage) }
export function LazyMultiStoreWorkspacePage() { return lazyPage(MultiStoreWorkspacePage) }
