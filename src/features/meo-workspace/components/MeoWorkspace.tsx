import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Inbox,
  Info,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react'
import {
  useId,
  type FormEventHandler,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { cx } from '../../../shared/lib/cx'
import { useI18n } from '../../../shared/i18n'
import '../meo-workspace.css'

export type MeoWorkspaceRole = 'owner' | 'admin' | 'editor' | 'analyst'

export type MeoWorkspaceActionProps = HTMLAttributes<HTMLDivElement> & {
  label?: string
}

export function MeoWorkspaceActions({
  label,
  className,
  children,
  ...props
}: MeoWorkspaceActionProps) {
  const { text } = useI18n()
  const resolvedLabel = label ?? text({ ja: 'ページ操作', en: 'Page actions' })
  return (
    <div
      {...props}
      className={cx('meo-workspace-actions', className)}
      role="group"
      aria-label={resolvedLabel}
      data-meo-workspace-align="start"
    >
      {children}
    </div>
  )
}

export type MeoWorkspaceHeaderProps = {
  title: string
  description?: ReactNode
  actions?: ReactNode
  className?: string
  headingId?: string
}

export function MeoWorkspaceHeader({
  title,
  description,
  actions,
  className,
  headingId,
}: MeoWorkspaceHeaderProps) {
  const { text } = useI18n()
  const generatedId = useId()
  const resolvedHeadingId = headingId ?? `meo-workspace-heading-${generatedId}`

  return (
    <header
      className={cx('meo-workspace-header', className)}
      data-meo-workspace-align="start"
    >
      <div className="meo-workspace-header__copy">
        <h1 id={resolvedHeadingId}>{title}</h1>
        {description ? <div className="meo-workspace-header__description">{description}</div> : null}
      </div>
      {actions ? (
        <MeoWorkspaceActions label={text({ ja: `${title}の操作`, en: `Actions for ${title}` })}>
          {actions}
        </MeoWorkspaceActions>
      ) : null}
    </header>
  )
}

export type MeoWorkspacePageProps = {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  busy?: boolean
  headingId?: string
}

export function MeoWorkspacePage({
  title,
  description,
  actions,
  children,
  className,
  busy = false,
  headingId,
}: MeoWorkspacePageProps) {
  return (
    <div
      className={cx('meo-workspace-page', className)}
      aria-busy={busy || undefined}
      data-meo-workspace-container="true"
    >
      <MeoWorkspaceHeader
        title={title}
        description={description}
        actions={actions}
        {...(headingId ? { headingId } : {})}
      />
      {children}
    </div>
  )
}

export type MeoWorkspaceSectionProps = {
  title?: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  headingId?: string
  surface?: 'open' | 'outlined' | 'muted'
}

export function MeoWorkspaceSection({
  title,
  description,
  actions,
  children,
  className,
  headingId,
  surface = 'open',
}: MeoWorkspaceSectionProps) {
  const { text } = useI18n()
  const generatedId = useId()
  const resolvedHeadingId = title
    ? (headingId ?? `meo-workspace-section-${generatedId}`)
    : undefined

  return (
    <section
      className={cx(
        'meo-workspace-section',
        `meo-workspace-section--${surface}`,
        className,
      )}
      aria-labelledby={resolvedHeadingId}
      data-meo-workspace-align="start"
    >
      {title || description || actions ? (
        <header className="meo-workspace-section__header">
          <div className="meo-workspace-section__copy">
            {title ? <h2 id={resolvedHeadingId}>{title}</h2> : null}
            {description ? <div className="meo-workspace-section__description">{description}</div> : null}
          </div>
          {actions ? (
            <MeoWorkspaceActions label={text({ ja: `${title ?? 'セクション'}の操作`, en: title ? `Actions for ${title}` : 'Section actions' })}>
              {actions}
            </MeoWorkspaceActions>
          ) : null}
        </header>
      ) : null}
      <div className="meo-workspace-section__body">{children}</div>
    </section>
  )
}

export type MeoWorkspaceTabItem<Value extends string = string> = {
  value: Value
  label: string
  disabled?: boolean
  count?: number
  panelId?: string
}

export type MeoWorkspaceTabsProps<Value extends string = string> = {
  items: readonly MeoWorkspaceTabItem<Value>[]
  value: Value
  onValueChange: (value: Value) => void
  label?: string
  className?: string
}

export function MeoWorkspaceTabs<Value extends string = string>({
  items,
  value,
  onValueChange,
  label,
  className,
}: MeoWorkspaceTabsProps<Value>) {
  const { text, formatNumber } = useI18n()
  const resolvedLabel = label ?? text({ ja: '表示内容', en: 'Content view' })
  return (
    <div
      className={cx('meo-workspace-tabs', className)}
      role="tablist"
      aria-label={resolvedLabel}
      data-meo-workspace-align="start"
    >
      {items.map((item) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            className="meo-workspace-tabs__tab"
            aria-selected={selected}
            aria-controls={item.panelId}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onValueChange(item.value)}
          >
            <span>{item.label}</span>
            {item.count === undefined ? null : (
              <span className="meo-workspace-tabs__count" aria-label={text({ ja: `${formatNumber(item.count)}件`, en: `${formatNumber(item.count)} items` })}>
                {formatNumber(item.count)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export type MeoWorkspaceFilterRowProps = {
  children: ReactNode
  actions?: ReactNode
  label?: string
  className?: string
  as?: 'div' | 'form'
  onSubmit?: FormEventHandler<HTMLFormElement>
}

export function MeoWorkspaceFilterRow({
  children,
  actions,
  label,
  className,
  as = 'div',
  onSubmit,
}: MeoWorkspaceFilterRowProps) {
  const { text } = useI18n()
  const resolvedLabel = label ?? text({ ja: '絞り込み', en: 'Filters' })
  const content = (
    <>
      <div className="meo-workspace-filter-row__fields">{children}</div>
      {actions ? (
        <MeoWorkspaceActions label={text({ ja: `${resolvedLabel}の操作`, en: `Actions for ${resolvedLabel}` })}>
          {actions}
        </MeoWorkspaceActions>
      ) : null}
    </>
  )

  if (as === 'form') {
    return (
      <form
        className={cx('meo-workspace-filter-row', className)}
        aria-label={resolvedLabel}
        onSubmit={onSubmit}
        data-meo-workspace-align="start"
      >
        {content}
      </form>
    )
  }

  return (
    <div
      className={cx('meo-workspace-filter-row', className)}
      role="search"
      aria-label={resolvedLabel}
      data-meo-workspace-align="start"
    >
      {content}
    </div>
  )
}

export type MeoWorkspaceColumn<Row> = {
  id: string
  header: ReactNode
  mobileLabel?: string
  cell: (row: Row, rowIndex: number) => ReactNode
  align?: 'start' | 'center' | 'end'
  className?: string
}

export type MeoWorkspaceDataTableProps<Row> = {
  label: string
  columns: readonly MeoWorkspaceColumn<Row>[]
  rows: readonly Row[]
  getRowKey: (row: Row, rowIndex: number) => string
  className?: string
  emptyState?: ReactNode
  busy?: boolean
  rowClassName?: (row: Row, rowIndex: number) => string | undefined
}

function mobileColumnLabel<Row>(column: MeoWorkspaceColumn<Row>): string {
  if (column.mobileLabel) return column.mobileLabel
  return typeof column.header === 'string' ? column.header : ''
}

export function MeoWorkspaceDataTable<Row>({
  label,
  columns,
  rows,
  getRowKey,
  className,
  emptyState,
  busy = false,
  rowClassName,
}: MeoWorkspaceDataTableProps<Row>) {
  if (rows.length === 0 && emptyState) {
    return (
      <div className={cx('meo-workspace-table-empty', className)} data-meo-workspace-align="start">
        {emptyState}
      </div>
    )
  }

  return (
    <div
      className={cx('meo-workspace-table', className)}
      aria-busy={busy || undefined}
      data-meo-workspace-align="start"
    >
      <table>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={column.className}
                data-align={column.align ?? 'start'}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={getRowKey(row, rowIndex)} className={rowClassName?.(row, rowIndex)}>
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={column.className}
                  data-label={mobileColumnLabel(column)}
                  data-align={column.align ?? 'start'}
                >
                  {column.cell(row, rowIndex)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export type MeoWorkspaceFormGridProps = HTMLAttributes<HTMLDivElement> & {
  columns?: 1 | 2 | 3 | 'auto'
}

export function MeoWorkspaceFormGrid({
  columns = 2,
  className,
  children,
  ...props
}: MeoWorkspaceFormGridProps) {
  return (
    <div
      {...props}
      className={cx('meo-workspace-form-grid', className)}
      data-columns={columns}
      data-meo-workspace-align="start"
    >
      {children}
    </div>
  )
}

export type MeoWorkspaceStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

const statusIcons = {
  neutral: Circle,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertTriangle,
} satisfies Record<MeoWorkspaceStatusTone, LucideIcon>

export type MeoWorkspaceStatusProps = {
  label: string
  detail?: ReactNode
  tone?: MeoWorkspaceStatusTone
  icon?: LucideIcon
  className?: string
}

export function MeoWorkspaceStatus({
  label,
  detail,
  tone = 'neutral',
  icon,
  className,
}: MeoWorkspaceStatusProps) {
  const Icon = icon ?? statusIcons[tone]
  return (
    <span
      className={cx('meo-workspace-status', `meo-workspace-status--${tone}`, className)}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon aria-hidden="true" />
      <span className="meo-workspace-status__copy">
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </span>
  )
}

type MeoWorkspaceStateProps = {
  title: string
  description?: ReactNode
  className?: string
}

export function MeoWorkspaceLoadingState({
  title,
  description,
  className,
}: Partial<MeoWorkspaceStateProps>) {
  const { text } = useI18n()
  const resolvedTitle = title ?? text({ ja: '読み込んでいます', en: 'Loading' })
  return (
    <div
      className={cx('meo-workspace-state', 'meo-workspace-state--loading', className)}
      role="status"
      aria-live="polite"
      data-meo-workspace-align="start"
    >
      <LoaderCircle className="meo-workspace-state__icon spin" aria-hidden="true" />
      <div>
        <h2>{resolvedTitle}</h2>
        {description ? <div className="meo-workspace-state__description">{description}</div> : null}
      </div>
    </div>
  )
}

export type MeoWorkspaceEmptyStateProps = MeoWorkspaceStateProps & {
  action?: ReactNode
  icon?: LucideIcon
}

export function MeoWorkspaceEmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  className,
}: MeoWorkspaceEmptyStateProps) {
  const { text } = useI18n()
  return (
    <div
      className={cx('meo-workspace-state', 'meo-workspace-state--empty', className)}
      data-meo-workspace-align="start"
    >
      <Icon className="meo-workspace-state__icon" aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        {description ? <div className="meo-workspace-state__description">{description}</div> : null}
        {action ? <MeoWorkspaceActions label={text({ ja: `${title}の操作`, en: `Actions for ${title}` })}>{action}</MeoWorkspaceActions> : null}
      </div>
    </div>
  )
}

export type MeoWorkspaceErrorStateProps = MeoWorkspaceStateProps & {
  onRetry?: () => void
  retryLabel?: string
}

export function MeoWorkspaceErrorState({
  title,
  description,
  onRetry,
  retryLabel,
  className,
}: MeoWorkspaceErrorStateProps) {
  const { text } = useI18n()
  const resolvedRetryLabel = retryLabel ?? text({ ja: 'もう一度試す', en: 'Try again' })
  return (
    <div
      className={cx('meo-workspace-state', 'meo-workspace-state--error', className)}
      role="alert"
      data-meo-workspace-align="start"
    >
      <AlertTriangle className="meo-workspace-state__icon" aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        {description ? <div className="meo-workspace-state__description">{description}</div> : null}
        {onRetry ? (
          <button type="button" className="meo-workspace-state__action" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            {resolvedRetryLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}

export type MeoWorkspacePermissionNoticeProps = {
  role: MeoWorkspaceRole
  title?: string
  description?: ReactNode
  className?: string
  showWhenEditable?: boolean
}

const editableRoleLabels: Record<Exclude<MeoWorkspaceRole, 'analyst'>, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
}

export function MeoWorkspacePermissionNotice({
  role,
  title,
  description,
  className,
  showWhenEditable = false,
}: MeoWorkspacePermissionNoticeProps) {
  const { text } = useI18n()
  const readOnly = role === 'analyst'
  if (!readOnly && !showWhenEditable) return null

  return (
    <aside
      className={cx(
        'meo-workspace-permission',
        readOnly ? 'meo-workspace-permission--readonly' : 'meo-workspace-permission--editable',
        className,
      )}
      aria-label={text({ ja: 'この画面の操作権限', en: 'Permissions for this page' })}
      data-meo-workspace-align="start"
    >
      {readOnly ? <LockKeyhole aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
      <div>
        <strong>{title ?? (readOnly ? text({ ja: '閲覧専用', en: 'Read only' }) : text({ ja: `${editableRoleLabels[role as Exclude<MeoWorkspaceRole, 'analyst'>]}権限`, en: `${editableRoleLabels[role as Exclude<MeoWorkspaceRole, 'analyst'>]} access` }))}</strong>
        <div>
          {description ?? (readOnly
            ? text({ ja: 'Analyst権限ではデータの閲覧と出力のみ行えます。編集・公開・復元はできません。', en: 'Analysts can only view and export data. They cannot edit, publish, or restore it.' })
            : text({ ja: 'この画面の編集操作を実行できます。', en: 'You can edit content on this page.' }))}
        </div>
      </div>
    </aside>
  )
}
