import { createBrowserRouter, Navigate } from 'react-router'
import { AuthCallbackPage, ForgotPasswordPage, LoginPage, RegisterPage, UpdatePasswordPage } from '../features/auth/AuthPages'
import { ContactPage, LandingPage, NotFoundPage } from '../features/landing/PublicPages'
import { MeoFeatureRoute } from '../features/meo/MeoFeatureRoute'
import { ConnectionCenterPage } from '../features/meo/ConnectionCenterPage'
import {
  LazyGbpHealthPage,
  LazyGbpInsightsPage,
  LazyInstagramToGbpPage,
  LazyMeoRankPage,
  LazyReviewReplyPage,
} from '../features/meo/MeoLazyPages'
import {
  LazyAioWorkspacePage,
  LazyGbpProfileWorkspacePage,
  LazyMultiStoreWorkspacePage,
  LazyPerformanceWorkspacePage,
  LazyPostWorkspacePage,
  LazyReviewInboxWorkspacePage,
} from '../features/meo-workspace/MeoWorkspaceLazyPages'
import { AnalyzeHubPage, CollectHubPage, MeoHubPage, SettingsHubPage } from '../features/owner/OwnerHubPages'
import { OwnerLayout } from '../features/owner/OwnerLayout'
import { LegacyOwnerRouteRedirect } from '../features/owner/LegacyOwnerRouteRedirect'
import { StoreListPage } from '../features/owner/StoreListPage'
import { SurveySettingsPage } from '../features/owner/SurveySettingsPage'
import {
  AccountPage,
  AiConnectionPage,
  DashboardPage,
  InterviewDetailPage,
  InterviewsPage,
  QrPage,
  StorePage,
  SummaryPage,
} from '../features/owner/OwnerPages'
import { PublicInterviewPage } from '../features/public-interview/PublicInterviewPage'
import { RequireAuth } from './RequireAuth'
import { InvitationAcceptancePage } from '../features/meo-workspace/InvitationAcceptancePage'
import { isMeoWorkspaceEnabled } from '../features/meo-workspace/meo-workspace-availability'

export const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  { path: '/contact', element: <ContactPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/auth/callback', element: <AuthCallbackPage /> },
  { path: '/auth/update-password', element: <UpdatePasswordPage /> },
  { path: '/s/:publicSlug', element: <PublicInterviewPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/onboarding', element: <Navigate to="/dashboard" replace /> },
      { path: '/dashboard', element: <StoreListPage /> },
      { path: '/dashboard/invitations/accept', element: <InvitationAcceptancePage /> },
      { path: '/dashboard/collect', element: <LegacyOwnerRouteRedirect suffix="/collect" /> },
      { path: '/dashboard/analyze', element: <LegacyOwnerRouteRedirect suffix="/analyze" /> },
      { path: '/dashboard/settings', element: <LegacyOwnerRouteRedirect suffix="/settings" /> },
      { path: '/dashboard/qr', element: <LegacyOwnerRouteRedirect suffix="/qr" /> },
      { path: '/dashboard/survey', element: <LegacyOwnerRouteRedirect suffix="/survey" /> },
      { path: '/dashboard/interviews', element: <LegacyOwnerRouteRedirect suffix="/interviews" /> },
      { path: '/dashboard/interviews/:id', element: <LegacyOwnerRouteRedirect suffix="/interviews" includeLegacyId /> },
      { path: '/dashboard/summary', element: <LegacyOwnerRouteRedirect suffix="/summary" /> },
      { path: '/dashboard/store', element: <LegacyOwnerRouteRedirect suffix="/store" /> },
      { path: '/dashboard/connections', element: <LegacyOwnerRouteRedirect suffix="/connections" /> },
      { path: '/dashboard/ai', element: <LegacyOwnerRouteRedirect suffix="/ai" /> },
      {
        path: '/account',
        element: <OwnerLayout />,
        children: [{ index: true, element: <AccountPage /> }],
      },
      {
        path: '/dashboard/stores/:storeId',
        element: <OwnerLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'collect', element: <CollectHubPage /> },
          { path: 'analyze', element: <AnalyzeHubPage /> },
          { path: 'settings', element: <SettingsHubPage /> },
          { path: 'qr', element: <QrPage /> },
          { path: 'survey', element: <SurveySettingsPage /> },
          { path: 'interviews', element: <InterviewsPage /> },
          { path: 'interviews/:id', element: <InterviewDetailPage /> },
          { path: 'summary', element: <SummaryPage /> },
          { path: 'store', element: <StorePage /> },
          { path: 'connections', element: <ConnectionCenterPage /> },
          { path: 'ai', element: <AiConnectionPage /> },
          { path: 'meo', element: <MeoHubPage /> },
          { path: 'meo/workspace', element: isMeoWorkspaceEnabled ? <Navigate to="profile" replace /> : <NotFoundPage /> },
          { path: 'meo/workspace/profile', element: isMeoWorkspaceEnabled ? <LazyGbpProfileWorkspacePage /> : <NotFoundPage /> },
          { path: 'meo/workspace/reviews', element: isMeoWorkspaceEnabled ? <LazyReviewInboxWorkspacePage /> : <NotFoundPage /> },
          { path: 'meo/workspace/posts', element: isMeoWorkspaceEnabled ? <LazyPostWorkspacePage /> : <NotFoundPage /> },
          { path: 'meo/workspace/performance', element: isMeoWorkspaceEnabled ? <LazyPerformanceWorkspacePage /> : <NotFoundPage /> },
          { path: 'meo/workspace/aio', element: isMeoWorkspaceEnabled ? <LazyAioWorkspacePage /> : <NotFoundPage /> },
          { path: 'meo/workspace/multistore', element: isMeoWorkspaceEnabled ? <LazyMultiStoreWorkspacePage /> : <NotFoundPage /> },
          { path: 'meo/review-reply', element: <MeoFeatureRoute featureKey="review_reply"><LazyReviewReplyPage /></MeoFeatureRoute> },
          { path: 'meo/rank', element: <MeoFeatureRoute featureKey="meo_rank"><LazyMeoRankPage /></MeoFeatureRoute> },
          { path: 'meo/insights', element: <MeoFeatureRoute featureKey="gbp_insights"><LazyGbpInsightsPage /></MeoFeatureRoute> },
          { path: 'meo/health', element: <MeoFeatureRoute featureKey="gbp_health"><LazyGbpHealthPage /></MeoFeatureRoute> },
          { path: 'meo/instagram', element: <MeoFeatureRoute featureKey="instagram_to_gbp"><LazyInstagramToGbpPage /></MeoFeatureRoute> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])
