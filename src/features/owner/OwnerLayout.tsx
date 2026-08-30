import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  FileText,
  Home,
  Link2,
  LogOut,
  MapPinned,
  Menu,
  PlugZap,
  QrCode,
  Settings,
  Store,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { Highlight, HighlightItem } from '../../components/animate-ui/primitives/effects/highlight'
import { useAuth } from '../auth/auth-context'
import { cx } from '../../shared/lib/cx'
import { useI18n, type Locale } from '../../shared/i18n'
import { BrandMark } from '../../shared/ui/ui'
import { MEO_FEATURES, type MeoFeatureCapability, type MeoFeatureKey, type MeoFeatureStatus } from '../meo/feature-registry'
import { meoFeatureCapabilitiesQueryOptions } from '../meo/meo-api'
import { isMeoWorkspaceEnabled } from '../meo-workspace/meo-workspace-availability'
import { OwnerAnimatedIcon, OwnerIconMotion } from './OwnerAnimatedIcon'
import { getOwnerStores } from './owner-api'
import { isScopedRouteActive, ownerStorePath, ownerStoreSwitchPath, useActiveStoreId } from './store-scope'

type OwnerNavItem = {
  to: string
  label: string
  id: string
  icon: LucideIcon
  end?: boolean
  featureStatus?: MeoFeatureStatus
  capability?: MeoFeatureCapability
}

type OwnerNavGroup = {
  id: string
  label: string
  mobileLabel?: string
  to: string
  icon: LucideIcon
  items: readonly OwnerNavItem[]
  disabled?: boolean
}

const navItems = [
  { to: '/dashboard', label: '', id: 'home', icon: Home, end: true },
  { to: '/dashboard/qr', label: '', id: 'qr', icon: QrCode },
  { to: '/dashboard/survey', label: '', id: 'survey', icon: ClipboardList },
  { to: '/dashboard/interviews', label: '', id: 'interviews', icon: FileText },
  { to: '/dashboard/summary', label: '', id: 'summary', icon: BarChart3 },
  { to: '/dashboard/store', label: '', id: 'store', icon: Store },
  { to: '/dashboard/connections', label: '', id: 'connections', icon: Link2 },
  { to: '/dashboard/ai', label: '', id: 'ai', icon: PlugZap },
  { to: '/account', label: '', id: 'account', icon: UserRound },
] as const satisfies readonly OwnerNavItem[]

const navGroups = [
  { id: 'home', label: '', to: '/dashboard', icon: Home, items: [navItems[0]] },
  { id: 'collect', label: '', to: '/dashboard/collect', icon: QrCode, items: [navItems[1], navItems[2]] },
  { id: 'analyze', label: '', to: '/dashboard/analyze', icon: BarChart3, items: [navItems[3], navItems[4]] },
  { id: 'settings', label: '', to: '/dashboard/settings', icon: Settings, items: [navItems[5], navItems[6], navItems[7], navItems[8]] },
] as const satisfies readonly OwnerNavGroup[]

function isItemActive(item: { to: string; end?: boolean }, pathname: string) {
  return isScopedRouteActive(item.to, pathname, item.end)
}

function isGroupRootActive(group: { id: string; to: string }, pathname: string) {
  return isScopedRouteActive(group.to, pathname, group.id === 'home')
}

function featureStatusLabel(status: MeoFeatureStatus | undefined, paused: string): string | null {
  if (status === 'paused') return paused
  return null
}

const englishMeoTitles: Readonly<Record<MeoFeatureKey, string>> = {
  review_reply: 'Review replies',
  meo_rank: 'Rank tracking',
  gbp_insights: 'Google Maps analytics',
  gbp_health: 'Profile health check',
  instagram_to_gbp: 'Reuse Instagram posts',
}

function ownerMeoTitle(locale: Locale, capability: MeoFeatureCapability, fallback: string): string {
  return locale === 'en' ? englishMeoTitles[capability.key] : (capability.title || fallback)
}

function releaseTime(value: string | null | undefined): number {
  const time = value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time
}

export function OwnerLayout() {
  const { locale, text } = useI18n()
  const c = {
    home: text({ ja: 'ホーム', en: 'Home' }), collect: text({ ja: '集める', en: 'Collect' }), analyze: text({ ja: '分析', en: 'Analyze' }), settings: text({ ja: '設定', en: 'Settings' }), growth: text({ ja: 'Google集客', en: 'Google growth' }), growthMobile: text({ ja: '集客', en: 'Growth' }),
    qr: text({ ja: 'QR・共有リンク', en: 'QR & share link' }), survey: text({ ja: 'アンケート編集', en: 'Edit survey' }), interviews: text({ ja: '回答履歴', en: 'Response history' }), summary: text({ ja: '月次サマリー', en: 'Monthly summary' }), store: text({ ja: '店舗情報', en: 'Store information' }), connections: text({ ja: '外部サービス接続', en: 'External services' }), ai: text({ ja: 'AI接続', en: 'AI connection' }), account: text({ ja: 'アカウント', en: 'Account' }), meo: text({ ja: 'MEO管理', en: 'MEO management' }),
    paused: text({ ja: '一時停止中', en: 'Paused' }), comingSoon: text({ ja: '準備中', en: 'Coming soon' }),
    responseDetail: text({ ja: '回答詳細', en: 'Response details' }), skip: text({ ja: '本文へ移動', en: 'Skip to content' }), nav: text({ ja: '店舗管理ナビゲーション', en: 'Store management navigation' }), close: text({ ja: 'メニューを閉じる', en: 'Close menu' }), open: text({ ja: 'メニューを開く', en: 'Open menu' }), stores: text({ ja: '店舗一覧', en: 'Store list' }), storeLabel: text({ ja: '店舗', en: 'Store' }), manageStore: text({ ja: '管理する店舗', en: 'Store to manage' }), logout: text({ ja: 'ログアウト', en: 'Log out' }), primaryNav: text({ ja: '管理画面の主要メニュー', en: 'Primary management menu' }),
  }
  const [open, setOpen] = useState(false)
  const routeStoreId = useActiveStoreId({ optional: true })
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const storesQuery = useQuery({ queryKey: ['owner-stores'], queryFn: getOwnerStores })
  const primaryStore = storesQuery.data?.find((store) => store.owner_store_slot === 1)
    ?? storesQuery.data?.toSorted((left, right) => left.owner_store_slot - right.owner_store_slot)[0]
  const activeStoreId = routeStoreId ?? primaryStore?.id
  const featureCapabilitiesQuery = useQuery({
    ...meoFeatureCapabilitiesQueryOptions(activeStoreId),
    enabled: Boolean(activeStoreId),
  })
  const storeBasePath = activeStoreId ? ownerStorePath(activeStoreId) : '/dashboard'
  useEffect(() => {
    if (!routeStoreId || storesQuery.isLoading || storesQuery.isError || !storesQuery.data) return
    if (storesQuery.data.some((store) => store.id === routeStoreId)) return

    const nextStore = primaryStore
    if (!nextStore) {
      navigate('/dashboard', { replace: true })
      return
    }

    const staleBasePath = ownerStorePath(routeStoreId)
    const nextPath = location.pathname.startsWith(staleBasePath)
      ? location.pathname.replace(staleBasePath, ownerStorePath(nextStore.id))
      : ownerStorePath(nextStore.id)
    navigate(`${nextPath}${location.search}${location.hash}`, { replace: true })
  }, [
    location.hash,
    location.pathname,
    location.search,
    navigate,
    primaryStore,
    routeStoreId,
    storesQuery.data,
    storesQuery.isError,
    storesQuery.isLoading,
  ])
  const labels: Record<(typeof navItems)[number]['id'], string> = { home: c.home, qr: c.qr, survey: c.survey, interviews: c.interviews, summary: c.summary, store: c.store, connections: c.connections, ai: c.ai, account: c.account }
  const groupLabels: Record<(typeof navGroups)[number]['id'], string> = { home: c.home, collect: c.collect, analyze: c.analyze, settings: c.settings }
  const scopedCoreNavItems: OwnerNavItem[] = navItems.map((item) => ({
    ...item,
    label: labels[item.id],
    to: item.to.replace('/dashboard', storeBasePath),
  }))
  const visibleMeoNavItems: OwnerNavItem[] = MEO_FEATURES.flatMap((definition) => {
    const capability = featureCapabilitiesQuery.data?.features.find((feature) => feature.key === definition.key)
    if (!capability || capability.status === 'hidden') return []
    return [{
      id: definition.key,
      to: `${storeBasePath}${definition.path}`,
      label: ownerMeoTitle(locale, capability, definition.shortTitle),
      icon: definition.icon,
      featureStatus: capability.status,
      capability,
    }]
  })
    .toSorted((left, right) => releaseTime(left.capability.releaseAt) - releaseTime(right.capability.releaseAt))
  const meoWorkspaceNavItem: OwnerNavItem = {
    id: 'meo_workspace',
    to: `${storeBasePath}/meo/workspace/profile`,
    label: c.meo,
    icon: MapPinned,
  }
  const meoNavItems = isMeoWorkspaceEnabled
    ? [meoWorkspaceNavItem, ...visibleMeoNavItems]
    : visibleMeoNavItems
  const meoNavGroup: OwnerNavGroup = {
    id: 'meo',
    label: c.growth,
    mobileLabel: c.growthMobile,
    to: `${storeBasePath}/meo`,
    icon: MapPinned,
    items: meoNavItems,
  }
  const scopedNavItems = [...scopedCoreNavItems, ...meoNavItems]
  const scopedNavGroups: OwnerNavGroup[] = navGroups.map((group) => ({
    ...group,
    label: groupLabels[group.id],
    to: group.to.replace('/dashboard', storeBasePath),
    items: group.items.map((item) => scopedCoreNavItems.find((candidate) => candidate.id === item.id) ?? item),
  }))
  scopedNavGroups.push(meoNavGroup)
  const mobileNavGroups = scopedNavGroups
  const currentItem = scopedNavItems.find((item) => isItemActive(item, location.pathname))
  const fallbackGroup = scopedNavGroups[0]
  if (!fallbackGroup) throw new Error('OWNER_NAVIGATION_EMPTY')
  const currentGroup = scopedNavGroups.find((group) => (
    isGroupRootActive(group, location.pathname)
    || group.items.some((item) => isItemActive(item, location.pathname))
  )) ?? fallbackGroup
  const isDetailPage = Boolean(currentItem && currentItem.to !== currentGroup.to)
  const isGroupedListHub = currentGroup.id !== 'home' && !isDetailPage
  const isInterviewDetail = location.pathname.startsWith(`${storeBasePath}/interviews/`)
  const detailBackTarget = isInterviewDetail
    ? { to: `${storeBasePath}/interviews`, label: c.interviews }
    : { to: currentGroup.to, label: currentGroup.label }
  const topbarTitle = isInterviewDetail ? c.responseDetail : (currentItem?.label ?? currentGroup.label)

  return (
    <div className="owner-shell">
      <a className="skip-link" href="#owner-content">{c.skip}</a>
      <aside className={cx('owner-sidebar', open && 'owner-sidebar--open')} aria-label={c.nav}>
        <div className="owner-sidebar__head">
          <BrandMark compact />
          <button className="icon-button owner-sidebar__close" onClick={() => setOpen(false)} aria-label={c.close}><X /></button>
        </div>
        <Link className="owner-store-list-link" to="/dashboard" onClick={() => setOpen(false)}>
          {c.stores}
        </Link>
        <Highlight
          as="nav"
          mode="parent"
          controlledItems
          value={currentItem?.id ?? currentGroup.id}
          click={false}
          className="owner-nav-highlight"
          containerClassName="owner-sidebar__nav owner-nav-highlight"
          style={{ backgroundColor: 'var(--surface-muted)', borderRadius: 10 }}
        >
          {scopedNavGroups.map((group) => (
            <div className="owner-nav-group" key={group.id}>
              {group.id === 'home' ? null : (
                <HighlightItem asChild value={group.id}>
                  <NavLink
                    to={group.to}
                    end
                    onClick={() => setOpen(false)}
                    className={cx(
                      'owner-nav-group__label',
                      group.id === currentGroup.id && 'owner-nav-group__label--current',
                    )}
                    style={({ isActive }) => ({
                      position: 'relative',
                      zIndex: 1,
                      ...(isActive ? { backgroundColor: 'transparent' } : {}),
                    })}
                  >
                    {group.label}
                  </NavLink>
                </HighlightItem>
              )}
              {group.items.map((item) => {
                const Icon = item.icon
                const statusLabel = featureStatusLabel(item.featureStatus, c.paused)
                const unavailableLabel = statusLabel ?? c.comingSoon
                const releaseDetail = item.capability?.releaseAt
                  ? new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { dateStyle: 'medium', timeZone: 'Asia/Tokyo' }).format(new Date(item.capability.releaseAt))
                  : null
                if (item.featureStatus !== undefined && item.featureStatus !== 'available') {
                  return (
                    <OwnerIconMotion key={item.to} disabled>
                      <span
                        className={cx(
                          'owner-nav-link owner-nav-link--disabled',
                        )}
                        data-testid={`owner-nav-${item.id}`}
                        aria-disabled="true"
                      >
                        <OwnerAnimatedIcon name={item.id} fallback={Icon} />
                        <span className="owner-nav-roadmap-copy">
                          <small>{unavailableLabel}</small>
                          <span>{item.label}</span>
                          {releaseDetail ? <small>{releaseDetail}</small> : null}
                        </span>
                      </span>
                    </OwnerIconMotion>
                  )
                }
                return (
                  <HighlightItem key={item.to} asChild value={item.id}>
                    <OwnerIconMotion active={isItemActive(item, location.pathname)}>
                      <NavLink
                        to={item.to}
                        end={'end' in item ? item.end : false}
                        data-testid={`owner-nav-${item.id}`}
                        onClick={() => setOpen(false)}
                        className={({ isActive }) => cx(
                          'owner-nav-link',
                          isActive && 'owner-nav-link--active',
                        )}
                        style={({ isActive }) => ({
                          position: 'relative',
                          zIndex: 1,
                          ...(isActive ? { backgroundColor: 'transparent' } : {}),
                        })}
                      >
                        <OwnerAnimatedIcon name={item.id} fallback={Icon} />
                        {item.label}
                      </NavLink>
                    </OwnerIconMotion>
                  </HighlightItem>
                )
              })}
            </div>
          ))}
        </Highlight>
      </aside>
      {open ? <button className="owner-backdrop" aria-label={c.close} onClick={() => setOpen(false)} /> : null}
      <div className={cx('owner-main', isGroupedListHub && 'owner-main--grouped-list')}>
        <header className={cx('owner-topbar', isDetailPage && 'owner-topbar--detail')}>
          <button className="icon-button owner-menu-button" onClick={() => setOpen(true)} aria-label={c.open}><Menu /></button>
          {isDetailPage ? (
            <Link className="owner-topbar__back" to={detailBackTarget.to}>
              <ChevronLeft aria-hidden="true" />
              <span>{detailBackTarget.label}</span>
            </Link>
          ) : null}
          <strong className="owner-topbar__title">{topbarTitle}</strong>
          <div className="owner-topbar__actions">
            {activeStoreId && location.pathname !== '/account' ? (
              <label className="owner-store-switcher">
                <span className="owner-store-switcher__label">{c.storeLabel}</span>
                <span className="owner-store-switcher__control">
                  <select
                    aria-label={c.manageStore}
                    value={activeStoreId}
                    onChange={(event) => {
                      navigate(ownerStoreSwitchPath(location.pathname, activeStoreId, event.target.value))
                    }}
                  >
                    {(storesQuery.data ?? []).map((store) => (
                      <option key={store.id} value={store.id}>{store.name}</option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" />
                </span>
              </label>
            ) : null}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="account-trigger">
                <span className="account-trigger__avatar"><UserRound aria-hidden="true" /></span>
                <span className="account-trigger__label">{user?.email ?? c.account}</span>
                <ChevronDown aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="dropdown-content" align="end" sideOffset={8}>
                  <DropdownMenu.Item asChild><Link to="/account">{c.account}</Link></DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="dropdown-item"
                    onSelect={() => void signOut().then(() => navigate('/login')).catch(() => navigate('/account'))}
                  ><LogOut aria-hidden="true" />{c.logout}</DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </header>
        <AnimatePresence initial={false} mode="wait">
          <motion.main
            key={location.pathname}
            id="owner-content"
            className="owner-content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <Outlet />
          </motion.main>
        </AnimatePresence>
        <nav
          className={cx('owner-tabbar', mobileNavGroups.length === 5 && 'owner-tabbar--five')}
          aria-label={c.primaryNav}
        >
          {mobileNavGroups.map((group) => {
            const Icon = group.icon
            const active = group.id === currentGroup.id
            if (group.disabled) {
              return (
                <OwnerIconMotion key={group.id} disabled>
                  <span className="owner-tabbar__link owner-tabbar__link--disabled" aria-disabled="true">
                    <OwnerAnimatedIcon name={group.id} fallback={Icon} />
                    <span>{group.mobileLabel ?? group.label}</span>
                  </span>
                </OwnerIconMotion>
              )
            }
            return (
              <OwnerIconMotion key={group.id} active={active}>
                <Link
                  to={group.to}
                  aria-current={active ? 'page' : undefined}
                  className={cx('owner-tabbar__link', active && 'owner-tabbar__link--active')}
                >
                  <OwnerAnimatedIcon name={group.id} fallback={Icon} />
                  <span>{group.mobileLabel ?? group.label}</span>
                </Link>
              </OwnerIconMotion>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
