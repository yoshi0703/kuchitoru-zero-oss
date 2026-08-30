import { useReducedMotion } from 'motion/react'
import { useState, type FocusEvent, type ReactElement } from 'react'
import { LockKeyhole, type LucideIcon } from 'lucide-react'
import { ChartBar } from '../../components/animate-ui/icons/chart-bar'
import { ChevronRight } from '../../components/animate-ui/icons/chevron-right'
import { ClipboardList } from '../../components/animate-ui/icons/clipboard-list'
import { HouseWifi } from '../../components/animate-ui/icons/house-wifi'
import { AnimateIcon } from '../../components/animate-ui/icons/icon'
import { Link2 } from '../../components/animate-ui/icons/link-2'
import { MapPin } from '../../components/animate-ui/icons/map-pin'
import { MessageSquareShare } from '../../components/animate-ui/icons/message-square-share'
import { MessageSquareText } from '../../components/animate-ui/icons/message-square-text'
import { PlugZap } from '../../components/animate-ui/icons/plug-zap'
import { Settings } from '../../components/animate-ui/icons/settings'
import { UserRound } from '../../components/animate-ui/icons/user-round'

const ownerIcons = {
  account: UserRound,
  ai: PlugZap,
  analyze: ChartBar,
  'chevron-right': ChevronRight,
  collect: MessageSquareShare,
  connections: Link2,
  home: HouseWifi,
  interviews: MessageSquareText,
  meo: MapPin,
  'meo-workspace': MapPin,
  qr: MessageSquareShare,
  settings: Settings,
  store: MapPin,
  summary: ChartBar,
  survey: ClipboardList,
} as const

const ownerIconAliases: Record<string, keyof typeof ownerIcons> = {
  analytics: 'analyze',
  connection: 'connections',
  dashboard: 'home',
  'gbp-health': 'meo',
  'gbp-insights': 'analyze',
  'instagram-to-gbp': 'collect',
  interview: 'interviews',
  'meo-rank': 'analyze',
  'review-reply': 'interviews',
}

function normalizeIconName(name: string) {
  return name.trim().toLowerCase().replaceAll('_', '-')
}

type OwnerAnimatedIconProps = {
  name: string
  fallback: LucideIcon
  className?: string
  locked?: boolean
}

export function OwnerAnimatedIcon({ name, fallback: Fallback, className, locked = false }: OwnerAnimatedIconProps) {
  const requestedName = normalizeIconName(name)

  if (locked) {
    return (
      <LockKeyhole
        aria-hidden="true"
        className={className}
        data-owner-icon-name="lock-keyhole"
        data-owner-icon-source="lucide"
        data-animated-owner-icon="false"
        focusable="false"
      />
    )
  }

  const resolvedName = ownerIconAliases[requestedName]
    ?? (requestedName in ownerIcons ? requestedName as keyof typeof ownerIcons : undefined)
  const Icon = resolvedName ? ownerIcons[resolvedName] : undefined

  if (!Icon) {
    return (
      <Fallback
        aria-hidden="true"
        className={className}
        data-owner-icon-name={requestedName}
        data-owner-icon-source="lucide"
        data-animated-owner-icon="false"
        focusable="false"
      />
    )
  }

  return (
    <Icon
      aria-hidden="true"
      className={className}
      data-owner-icon-name={resolvedName}
      data-owner-icon-source="animate-ui"
      data-animated-owner-icon="true"
      focusable="false"
    />
  )
}

type OwnerIconMotionProps = {
  active?: boolean
  disabled?: boolean
  children: ReactElement
}

export function OwnerIconMotion({ active = false, disabled = false, children }: OwnerIconMotionProps) {
  const prefersReducedMotion = useReducedMotion()
  const [focusActive, setFocusActive] = useState(false)
  const canAnimate = !disabled && !prefersReducedMotion
  const childProps = children.props as {
    onBlur?: (event: FocusEvent<HTMLElement>) => void
    onFocus?: (event: FocusEvent<HTMLElement>) => void
  }

  const handleFocus = (event: FocusEvent<HTMLElement>) => {
    childProps.onFocus?.(event)
    if (canAnimate) setFocusActive(true)
  }

  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    childProps.onBlur?.(event)
    setFocusActive(false)
  }

  return (
    <AnimateIcon
      asChild
      animate={canAnimate && focusActive}
      animateOnHover={canAnimate}
      animateOnTap={canAnimate}
      data-owner-icon-active={active ? 'true' : 'false'}
      data-owner-icon-focus={focusActive ? 'true' : 'false'}
      data-owner-icon-motion={canAnimate ? 'enabled' : 'disabled'}
      initialOnAnimateEnd
      loop={false}
      onBlur={handleBlur}
      onFocus={handleFocus}
    >
      {children}
    </AnimateIcon>
  )
}
