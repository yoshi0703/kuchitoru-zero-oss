import { useQuery } from '@tanstack/react-query'
import {
  BarChart3,
  ChevronRight,
  ClipboardList,
  FileText,
  Link2,
  MapPinned,
  PlugZap,
  QrCode,
  Store,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router'
import { Fades } from '../../components/animate-ui/primitives/effects/fade'
import { aiProviderLabel } from '../../shared/ai-providers'
import { useI18n, type Locale } from '../../shared/i18n'
import { LoadingState, Notice, PageTitle, Panel } from '../../shared/ui/ui'
import { useAuth } from '../auth/auth-context'
import { MEO_FEATURES, type MeoFeatureCapability, type MeoFeatureKey } from '../meo/feature-registry'
import { meoFeatureCapabilitiesQueryOptions } from '../meo/meo-api'
import { isMeoWorkspaceEnabled } from '../meo-workspace/meo-workspace-availability'
import { OwnerAnimatedIcon, OwnerIconMotion } from './OwnerAnimatedIcon'
import { getAiConnection, getMonthlySummary, getOwnerStore } from './owner-api'
import { getSurveyConfig } from './survey-config-api'
import { ownerStorePath, useActiveStoreId } from './store-scope'

type HubItem = {
  id: string
  to: string
  external?: boolean
  disabled?: boolean
  icon: LucideIcon
  title: string
  status: string
}

const englishMeoTitles: Readonly<Record<MeoFeatureKey, string>> = {
  review_reply: 'Review replies', meo_rank: 'Rank tracking', gbp_insights: 'Google Maps analytics',
  gbp_health: 'Profile health check', instagram_to_gbp: 'Reuse Instagram posts',
}

function ownerMeoTitle(locale: Locale, capability: MeoFeatureCapability, fallback: string): string {
  return locale === 'en' ? englishMeoTitles[capability.key] : (capability.title || fallback)
}

function queryStatus(
  query: { isLoading: boolean; isError: boolean },
  readyStatus: string,
  checking: string,
  unavailable: string,
) {
  if (query.isLoading) return checking
  if (query.isError) return unavailable
  return readyStatus
}

function OwnerHubList({ items, label }: { items: HubItem[]; label: string }) {
  return (
    <Panel className="owner-hub-list">
      <nav className="owner-hub-list__nav" aria-label={label}>
        <ul>
          <Fades asChild holdDelay={55} initialOpacity={0}>
            {items.map((item) => {
              const Icon = item.icon
              return (
                <li key={item.id}>
                  {item.disabled ? (
                    <span
                      className="owner-hub-row owner-hub-row--disabled"
                      data-testid={`owner-hub-${item.id}`}
                      aria-disabled="true"
                    >
                      <span className={`owner-hub-row__icon owner-hub-row__icon--${item.id}`} aria-hidden="true">
                        <OwnerAnimatedIcon name={item.id} fallback={Icon} />
                      </span>
                      <span className="owner-hub-row__content">
                        <strong>{item.title}</strong>
                      </span>
                      <span className="owner-hub-row__status" title={item.status}>{item.status}</span>
                    </span>
                  ) : item.external ? (
                    <OwnerIconMotion>
                      <a
                        className="owner-hub-row"
                        data-testid={`owner-hub-${item.id}`}
                        href={item.to}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span className={`owner-hub-row__icon owner-hub-row__icon--${item.id}`} aria-hidden="true">
                          <OwnerAnimatedIcon name={item.id} fallback={Icon} />
                        </span>
                        <span className="owner-hub-row__content">
                          <strong>{item.title}</strong>
                        </span>
                        <span className="owner-hub-row__status" title={item.status}>{item.status}</span>
                        <OwnerAnimatedIcon
                          name="chevron-right"
                          fallback={ChevronRight}
                          className="owner-hub-row__chevron"
                        />
                      </a>
                    </OwnerIconMotion>
                  ) : (
                    <OwnerIconMotion>
                      <Link
                        className="owner-hub-row"
                        data-testid={`owner-hub-${item.id}`}
                        to={item.to}
                      >
                        <span className={`owner-hub-row__icon owner-hub-row__icon--${item.id}`} aria-hidden="true">
                          <OwnerAnimatedIcon name={item.id} fallback={Icon} />
                        </span>
                        <span className="owner-hub-row__content">
                          <strong>{item.title}</strong>
                        </span>
                        <span className="owner-hub-row__status" title={item.status}>{item.status}</span>
                        <OwnerAnimatedIcon
                          name="chevron-right"
                          fallback={ChevronRight}
                          className="owner-hub-row__chevron"
                        />
                      </Link>
                    </OwnerIconMotion>
                  )}
                </li>
              )
            })}
          </Fades>
        </ul>
      </nav>
    </Panel>
  )
}

function GroupedHubPage({
  title,
  items,
  label,
}: {
  title: string
  items: HubItem[]
  label: string
}) {
  return (
    <div className="owner-page owner-hub-page grouped-list-page">
      <PageTitle title={title} />
      <OwnerHubList items={items} label={label} />
    </div>
  )
}

function formatLegacyDate(value: string | null, localeTag: 'ja-JP' | 'en-US', unscheduled: string): string {
  if (!value) return unscheduled
  return new Intl.DateTimeFormat(localeTag, {
    month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo',
  }).format(new Date(value))
}

export function MeoHubPage() {
  const { locale, text, localeTag } = useI18n()
  const title = text({ ja: 'Google集客', en: 'Google growth' })
  const storeId = useActiveStoreId()
  const capabilitiesQuery = useQuery(meoFeatureCapabilitiesQueryOptions(storeId))
  if (capabilitiesQuery.isLoading) {
    return <div className="owner-page owner-hub-page"><PageTitle title={title} /><LoadingState label={text({ ja: 'Google集客を読み込んでいます', en: 'Loading Google growth tools' })} /></div>
  }
  if (capabilitiesQuery.isError) {
    return <div className="owner-page owner-hub-page"><PageTitle title={title} /><Notice tone="error">{text({ ja: 'Google集客を読み込めませんでした。', en: 'We couldn’t load Google growth tools.' })}</Notice></div>
  }
  const capabilityItems = MEO_FEATURES.flatMap((definition) => {
    const capability = capabilitiesQuery.data?.features.find((feature) => feature.key === definition.key)
    if (!capability || capability.status === 'hidden') return []
    return [{
      id: definition.key,
      to: ownerStorePath(storeId, definition.path),
      icon: definition.icon,
      title: ownerMeoTitle(locale, capability, definition.shortTitle),
      status: capability.status === 'paused'
        ? text({ ja: '一時停止中', en: 'Paused' })
        : capability.status === 'available'
          ? text({ ja: '利用可能', en: 'Available' })
          : formatLegacyDate(capability.releaseAt, localeTag, text({ ja: '公開日未定', en: 'Release date TBD' })),
      disabled: capability.status !== 'available',
      capability,
    }]
  })
    .toSorted((left, right) => {
      const leftTime = left.capability.releaseAt ? new Date(left.capability.releaseAt).getTime() : Number.MAX_SAFE_INTEGER
      const rightTime = right.capability.releaseAt ? new Date(right.capability.releaseAt).getTime() : Number.MAX_SAFE_INTEGER
      return leftTime - rightTime
    })
  const workspaceItems: HubItem[] = isMeoWorkspaceEnabled ? [{
    id: 'meo_workspace',
    to: ownerStorePath(storeId, '/meo/workspace/profile'),
    icon: MapPinned,
    title: text({ ja: 'MEO管理', en: 'MEO management' }),
    status: text({ ja: '利用可能', en: 'Available' }),
  }] : []
  const items: HubItem[] = [...workspaceItems, ...capabilityItems.map((item) => ({
    id: item.id,
    to: item.to,
    icon: item.icon,
    title: item.title,
    status: item.status,
    disabled: item.disabled,
  }))]

  return <GroupedHubPage title={title} items={items} label={text({ ja: 'Google集客メニュー', en: 'Google growth menu' })} />
}

export function CollectHubPage() {
  const { text } = useI18n()
  const checking = text({ ja: '確認中', en: 'Checking' }); const unavailable = text({ ja: '確認できません', en: 'Unavailable' })
  const storeId = useActiveStoreId()
  const storeQuery = useQuery({ queryKey: ['owner-store', storeId], queryFn: () => getOwnerStore(storeId) })
  const surveyQuery = useQuery({ queryKey: ['survey-config', storeId], queryFn: () => getSurveyConfig(storeId) })
  const storeStatus = storeQuery.data?.status === 'published'
    ? text({ ja: '公開中', en: 'Published' })
    : storeQuery.data?.status === 'paused'
      ? text({ ja: '停止中', en: 'Paused' })
      : storeQuery.data
        ? text({ ja: '下書き', en: 'Draft' })
        : text({ ja: '要設定', en: 'Setup required' })

  const items: HubItem[] = [
    {
      id: 'qr',
      to: ownerStorePath(storeId, '/qr'),
      icon: QrCode,
      title: text({ ja: 'QR・共有リンク', en: 'QR & share link' }),
      status: queryStatus(storeQuery, storeStatus, checking, unavailable),
    },
    {
      id: 'survey',
      to: ownerStorePath(storeId, '/survey'),
      icon: ClipboardList,
      title: text({ ja: 'アンケート編集', en: 'Edit survey' }),
      status: queryStatus(surveyQuery, surveyQuery.data ? text({ ja: '6項目', en: '6 items' }) : text({ ja: '要設定', en: 'Setup required' }), checking, unavailable),
    },
  ]

  return <GroupedHubPage title={text({ ja: '集める', en: 'Collect' })} items={items} label={text({ ja: '集めるメニュー', en: 'Collect menu' })} />
}

export function AnalyzeHubPage() {
  const { text, formatNumber } = useI18n()
  const checking = text({ ja: '確認中', en: 'Checking' }); const unavailable = text({ ja: '確認できません', en: 'Unavailable' })
  const storeId = useActiveStoreId()
  const summaryQuery = useQuery({ queryKey: ['monthly-summary', storeId], queryFn: () => getMonthlySummary(storeId) })
  const summary = summaryQuery.data
  const noData = text({ ja: 'データなし', en: 'No data' })
  const interviewStatus = summary ? text({ ja: `今月 ${formatNumber(summary.started)}件`, en: `${formatNumber(summary.started)} this month` }) : noData
  const summaryStatus = summary && summary.started > 0 ? text({ ja: `完了率 ${formatNumber(summary.completion_rate)}%`, en: `${formatNumber(summary.completion_rate)}% completion` }) : noData

  const items: HubItem[] = [
    {
      id: 'interviews',
      to: ownerStorePath(storeId, '/interviews'),
      icon: FileText,
      title: text({ ja: '回答履歴', en: 'Response history' }),
      status: queryStatus(summaryQuery, interviewStatus, checking, unavailable),
    },
    {
      id: 'summary',
      to: ownerStorePath(storeId, '/summary'),
      icon: BarChart3,
      title: text({ ja: '月次サマリー', en: 'Monthly summary' }),
      status: queryStatus(summaryQuery, summaryStatus, checking, unavailable),
    },
  ]

  return <GroupedHubPage title={text({ ja: '分析', en: 'Analyze' })} items={items} label={text({ ja: '分析メニュー', en: 'Analyze menu' })} />
}

export function SettingsHubPage() {
  const { text } = useI18n()
  const checking = text({ ja: '確認中', en: 'Checking' }); const unavailable = text({ ja: '確認できません', en: 'Unavailable' })
  const storeId = useActiveStoreId()
  const { user } = useAuth()
  const storeQuery = useQuery({ queryKey: ['owner-store', storeId], queryFn: () => getOwnerStore(storeId) })
  const aiQuery = useQuery({ queryKey: ['ai-connection', storeId], queryFn: () => getAiConnection(storeId) })
  const activeConnection = aiQuery.data
  const aiStatus = activeConnection?.status === 'active'
    ? `${aiProviderLabel(activeConnection.provider)} ${text({ ja: '接続済み', en: 'connected' })}`
    : activeConnection
      ? text({ ja: '要再確認', en: 'Needs review' })
      : text({ ja: '未接続', en: 'Not connected' })

  const items: HubItem[] = [
    {
      id: 'store',
      to: ownerStorePath(storeId, '/store'),
      icon: Store,
      title: text({ ja: '店舗情報', en: 'Store information' }),
      status: queryStatus(storeQuery, storeQuery.data ? text({ ja: '入力済み', en: 'Complete' }) : text({ ja: '未入力', en: 'Not entered' }), checking, unavailable),
    },
    {
      id: 'connections',
      to: ownerStorePath(storeId, '/connections'),
      icon: Link2,
      title: text({ ja: '外部サービス接続', en: 'External services' }),
      status: text({ ja: '必要な時だけ', en: 'Only when needed' }),
    },
    {
      id: 'ai',
      to: ownerStorePath(storeId, '/ai'),
      icon: PlugZap,
      title: text({ ja: 'AI接続', en: 'AI connection' }),
      status: queryStatus(aiQuery, aiStatus, checking, unavailable),
    },
    {
      id: 'account',
      to: '/account',
      icon: UserRound,
      title: text({ ja: 'アカウント', en: 'Account' }),
      status: user?.email ?? text({ ja: 'ログイン中', en: 'Signed in' }),
    },
  ]

  return <GroupedHubPage title={text({ ja: '設定', en: 'Settings' })} items={items} label={text({ ja: '設定メニュー', en: 'Settings menu' })} />
}
