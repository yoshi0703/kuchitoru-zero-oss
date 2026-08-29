import { useQuery } from '@tanstack/react-query'
import { CalendarClock, PauseCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, Navigate } from 'react-router'
import { useI18n } from '../../shared/i18n'
import { localeTag } from '../../shared/i18n/locale'
import { LoadingState, Notice, PageTitle, Panel } from '../../shared/ui/ui'
import { ownerStorePath, useActiveStoreId } from '../owner/store-scope'
import { meoFeatureDefinition, type MeoFeatureKey } from './feature-registry'
import { meoFeatureCapabilitiesQueryOptions } from './meo-api'

export function MeoFeatureRoute({ featureKey, children }: { featureKey: MeoFeatureKey; children: ReactNode }) {
  const { locale } = useI18n()
  const storeId = useActiveStoreId()
  const query = useQuery(meoFeatureCapabilitiesQueryOptions(storeId))
  const definition = meoFeatureDefinition(featureKey, locale)
  const en = locale === 'en'

  if (query.isLoading) return <LoadingState label={en ? 'Checking availability' : '公開状態を確認しています'} />
  if (query.isError) {
    return (
      <div className="owner-page meo-feature-page">
        <PageTitle title={definition.title} showTitle />
        <Notice tone="error">
          <strong>{en ? 'This feature could not be opened.' : 'この機能を開けませんでした。'}</strong>
          <p>{en ? 'Availability could not be checked. Wait a moment and try again.' : '公開状態を確認できません。少し待ってから、もう一度お試しください。'}</p>
        </Notice>
        <Link className="button button--secondary" to={ownerStorePath(storeId)}>{en ? 'Back to home' : 'ホームへ戻る'}</Link>
      </div>
    )
  }

  const capability = query.data?.features.find((feature) => feature.key === featureKey)
  if (!capability || capability.status === 'hidden') {
    return <Navigate to={ownerStorePath(storeId)} replace />
  }

  if (capability.status !== 'available') {
    const isPaused = capability.status === 'paused'
    const releaseLabel = capability.releaseAt
      ? new Intl.DateTimeFormat(localeTag(locale), { dateStyle: 'long', timeZone: 'Asia/Tokyo' }).format(new Date(capability.releaseAt))
      : null
    return (
      <div className="owner-page meo-feature-page">
        <PageTitle title={definition.title} showTitle />
        <Panel className="meo-unavailable">
          <div className="meo-unavailable__icon">
            {isPaused ? <PauseCircle aria-hidden="true" /> : <CalendarClock aria-hidden="true" />}
          </div>
          <div className="meo-unavailable__copy">
            <h2>{isPaused ? (en ? 'Temporarily paused' : 'ただいま一時停止しています') : (en ? 'Coming soon' : '現在準備中です')}</h2>
            <p>
              {capability.reason && !en
                ? capability.reason
                : releaseLabel
                  ? (en ? `Scheduled for ${releaseLabel}.` : `${releaseLabel}に公開予定です。`)
                  : (en ? 'This feature will be available here when it is ready.' : '準備が整いしだい、ここから使えるようになります。')}
            </p>
          </div>
          <Link className="meo-unavailable__back" to={ownerStorePath(storeId)}>{en ? 'Back to home' : 'ホームへ戻る'}</Link>
        </Panel>
      </div>
    )
  }

  return children
}
