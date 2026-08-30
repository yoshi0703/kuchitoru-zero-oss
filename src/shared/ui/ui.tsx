import type { ButtonHTMLAttributes, ComponentPropsWithRef, ComponentType, ReactNode } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, CheckCircle2, LoaderCircle, MessageCircle } from 'lucide-react'
import kuchitoruLogo from '../../assets/brand/kuchitoru-zero-logo.png'
import { LiquidButton } from '../../components/animate-ui/primitives/buttons/liquid'
import { useI18n } from '../i18n'
import { cx } from '../lib/cx'

const AnimatedLiquidButton = LiquidButton as unknown as ComponentType<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    hoverScale?: number
    tapScale?: number
  }
>

type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'quiet'
  busy?: boolean
  animated?: boolean
}

type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-checked' | 'aria-label' | 'role' | 'type'> & {
  checked: boolean
  label: string
}

export function Button({
  variant = 'primary',
  busy = false,
  animated = false,
  disabled,
  className,
  children,
  style,
  ...props
}: ButtonProps) {
  const buttonClassName = cx('button', `button--${variant}`, animated && 'button--animated', className)
  const buttonContents = (
    <>
      {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : null}
      {children}
    </>
  )
  const motionStyleProps = style === undefined ? {} : { style }

  if (animated) {
    return (
      <AnimatedLiquidButton
        className={buttonClassName}
        disabled={disabled || busy}
        aria-busy={busy}
        hoverScale={1.02}
        tapScale={0.98}
        {...motionStyleProps}
        {...props}
      >
        {buttonContents}
      </AnimatedLiquidButton>
    )
  }

  return (
    <button
      className={buttonClassName}
      disabled={disabled || busy}
      aria-busy={busy}
      {...props}
    >
      {buttonContents}
    </button>
  )
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('badge', className)}>{children}</span>
}

export function Switch({ checked, label, className, ...props }: SwitchProps) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx('switch', className)}
    >
      <span className="switch__thumb" aria-hidden="true" />
    </button>
  )
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const { text } = useI18n()
  return (
    <Link className={cx('brand', compact && 'brand--compact')} to="/" aria-label={text({ ja: 'クチトルZero トップページ', en: 'Kuchitoru Zero home page' })}>
      <img className="brand__logo" src={kuchitoruLogo} alt="" aria-hidden="true" />
    </Link>
  )
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('panel', className)}>{children}</section>
}

export function GroupedSection({
  title,
  headingId,
  className,
  children,
}: {
  title: string
  headingId: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cx('grouped-section', className)} aria-labelledby={headingId}>
      <h2 className="grouped-section__title" id={headingId}>{title}</h2>
      {children}
    </section>
  )
}

export function PageTitle({
  title,
  description,
  action,
  showTitle = false,
}: {
  title: string
  description?: string
  action?: ReactNode
  showTitle?: boolean
}) {
  if (!description && !action) return <h1 className="sr-only">{title}</h1>

  return (
    <header className={cx('page-title', showTitle && 'page-title--visible')}>
      <div>
        <h1 className={showTitle ? undefined : 'sr-only'}>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </header>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <MessageCircle aria-hidden="true" />
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  )
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'success' | 'error' | 'warning'
  children: ReactNode
}) {
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'error' || tone === 'warning' ? AlertTriangle : MessageCircle
  return (
    <div className={cx('notice', `notice--${tone}`)} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}

export function LoadingState({ label }: { label?: string }) {
  const { text } = useI18n()
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" aria-hidden="true" />
      <span>{label ?? text({ ja: '読み込んでいます', en: 'Loading' })}</span>
    </div>
  )
}

export function AppFooter() {
  const { text } = useI18n()
  return (
    <footer className="app-footer">
      <Link to="/contact">{text({ ja: 'サポート', en: 'Support' })}</Link>
      <span aria-hidden="true">|</span>
      <a href="https://github.com/yoshi0703/kuchitoru-zero-oss" target="_blank" rel="noopener noreferrer">Source code</a>
      <span aria-hidden="true">|</span>
      <a href="https://github.com/yoshi0703/kuchitoru-zero-oss/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">GNU AGPL v3 or later</a>
      <span aria-hidden="true">|</span>
      <a href="https://github.com/yoshi0703/kuchitoru-zero-oss/blob/main/TRADEMARKS.md" target="_blank" rel="noopener noreferrer">{text({ ja: '商標条件', en: 'Trademark policy' })}</a>
      <span>© 2026 Ranchu Japan合同会社</span>
    </footer>
  )
}
