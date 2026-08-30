import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, FileJson, Upload } from 'lucide-react'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { createCsv } from '../../shared/lib/csv'
import { useI18n, type Locale } from '../../shared/i18n'
import { Button, Notice } from '../../shared/ui/ui'
import { useActiveStoreId } from '../owner/store-scope'
import { MeoWorkspaceNavigation } from './MeoWorkspaceNavigation'
import {
  getMeoWorkspaceSnapshot,
  listMeoWorkspaceResource,
  mutateMeoWorkspaceResource,
  type MeoWorkspaceMutationResult,
  type MeoWorkspaceRole,
  type MeoWorkspaceSnapshot,
} from './meo-workspace-api'
import {
  MeoWorkspaceActions,
  MeoWorkspaceDataTable,
  MeoWorkspaceEmptyState,
  MeoWorkspaceErrorState,
  MeoWorkspaceFilterRow,
  MeoWorkspaceFormGrid,
  MeoWorkspaceLoadingState,
  MeoWorkspacePage,
  MeoWorkspacePermissionNotice,
  MeoWorkspaceSection,
  MeoWorkspaceStatus,
  MeoWorkspaceTabs,
} from './components/MeoWorkspace'

type JsonObject = Record<string, unknown>

const nowIso = () => new Date().toISOString()
const today = () => new Date().toISOString().slice(0, 10)
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback
const number = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const object = (value: unknown): JsonObject => value !== null && !Array.isArray(value) && typeof value === 'object' ? value as JsonObject : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const idOf = (row: JsonObject) => text(row.id ?? row.snapshot_id ?? row.review_id ?? row.post_id)
const dateTimeOf = (row: JsonObject) => text(row.updated_at ?? row.created_at ?? row.observed_at ?? row.reviewed_at ?? row.period_start)
const payloadOf = (row: JsonObject) => object(row.payload ?? row.profile ?? row.data ?? row)
const readOnly = (role: MeoWorkspaceRole) => role === 'analyst'
const copy = (locale: Locale, ja: string, en: string) => locale === 'ja' ? ja : en
const statusLabel = (value: string, locale: Locale) => ({ unread: copy(locale, '未読', 'Unread'), needs_reply: copy(locale, '要返信', 'Needs reply'), replied: copy(locale, '返信済み', 'Replied'), archived: copy(locale, 'アーカイブ', 'Archived'), draft: copy(locale, '下書き', 'Draft'), ready: copy(locale, '手動公開の準備完了', 'Ready for manual publishing'), ready_for_manual_publish: copy(locale, '手動公開の準備完了', 'Ready for manual publishing') }[value] ?? value)
const formatDateTime = (value: string, locale: Locale) => value
  ? new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(value))
  : '—'
const formatDate = (value: string, locale: Locale) => value ? new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : '—'
const formatNumber = (value: number, locale: Locale, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US', options).format(value)

function errorMessage(error: unknown, locale: Locale) {
  if (locale === 'ja' && error instanceof Error) return error.message
  return copy(locale, '操作を完了できませんでした。', 'The operation could not be completed.')
}

function splitLines(value: string) {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)
}

function pretty(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2)
}

function parseObjectJson(value: string, label: string, locale: Locale): JsonObject {
  const parsed: unknown = JSON.parse(value || '{}')
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(copy(locale, `${label}はJSONオブジェクトで入力してください。`, `${label} must be a JSON object.`))
  return parsed as JsonObject
}

function parseArrayJson(value: string, label: string, locale: Locale): JsonObject[] {
  const parsed: unknown = JSON.parse(value || '[]')
  if (!Array.isArray(parsed) || parsed.some((item) => item === null || Array.isArray(item) || typeof item !== 'object')) {
    throw new Error(copy(locale, `${label}はJSONオブジェクトの配列で入力してください。`, `${label} must be an array of JSON objects.`))
  }
  return parsed as JsonObject[]
}

function downloadText(content: string, filename: string, mime = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function mutationNotice(result: MeoWorkspaceMutationResult<unknown> | undefined, directMessage: string, locale: Locale) {
  if (!result) return null
  return result.approvalRequired
    ? <Notice tone="success">{copy(locale, '変更申請を保存しました。承認後に反映されます。', 'The change request was saved and will be applied after approval.')}</Notice>
    : <Notice tone="success">{directMessage}</Notice>
}

function useWorkspace() {
  const storeId = useActiveStoreId()
  const query = useQuery({
    queryKey: ['meo-workspace', storeId, 'snapshot'],
    queryFn: ({ signal }) => getMeoWorkspaceSnapshot(storeId, signal),
    retry: false,
  })
  return { storeId, query, snapshot: query.data, role: query.data?.authorization.role }
}

function WorkspaceGate({
  title,
  description,
  workspace,
  children,
}: {
  title: string
  description: string
  workspace: ReturnType<typeof useWorkspace>
  children: (snapshot: MeoWorkspaceSnapshot) => React.ReactNode
}) {
  const { locale } = useI18n()
  if (workspace.query.isPending) {
    return <MeoWorkspacePage title={title} description={description} busy><MeoWorkspaceLoadingState /></MeoWorkspacePage>
  }
  if (workspace.query.isError || !workspace.snapshot) {
    return (
      <MeoWorkspacePage title={title} description={description}>
        <MeoWorkspaceErrorState
          title={copy(locale, '店舗データを読み込めませんでした', 'Store data could not be loaded')}
          description={errorMessage(workspace.query.error, locale)}
          onRetry={() => void workspace.query.refetch()}
        />
      </MeoWorkspacePage>
    )
  }
  return <>{children(workspace.snapshot)}</>
}

type ProfileDraft = {
  businessName: string
  description: string
  primaryCategory: string
  additionalCategories: string
  primaryPhone: string
  additionalPhones: string
  websiteUri: string
  languageCode: string
  openingDate: string
  postalCode: string
  prefecture: string
  locality: string
  addressLines: string
  serviceArea: string
  businessHours: string
  specialHours: string
  moreHours: string
  attributes: string
  labels: string
}

function profileDraft(value: JsonObject | null): ProfileDraft {
  const row = payloadOf(value ?? {})
  const phones = object(row.phoneNumbers ?? row.phone_numbers)
  const address = object(row.address)
  return {
    businessName: text(row.businessName ?? row.business_name),
    description: text(row.description),
    primaryCategory: text(row.primaryCategory ?? row.primary_category),
    additionalCategories: array(row.additionalCategories ?? row.additional_categories).map(String).join(', '),
    primaryPhone: text(phones.primaryPhone ?? phones.primary_phone),
    additionalPhones: array(phones.additionalPhones ?? phones.additional_phones).map(String).join(', '),
    websiteUri: text(row.websiteUri ?? row.website_uri),
    languageCode: text(row.languageCode ?? row.language_code, 'ja'),
    openingDate: text(row.openingDate ?? row.opening_date),
    postalCode: text(address.postalCode ?? address.postal_code),
    prefecture: text(address.administrativeArea ?? address.administrative_area ?? address.prefecture),
    locality: text(address.locality),
    addressLines: array(address.addressLines ?? address.address_lines).map(String).join('\n'),
    serviceArea: pretty(row.serviceArea ?? row.service_area ?? {}),
    businessHours: pretty(row.businessHours ?? row.business_hours ?? {}),
    specialHours: pretty(row.specialHours ?? row.special_hours ?? []),
    moreHours: pretty(row.moreHours ?? row.more_hours ?? []),
    attributes: pretty(row.attributes ?? {}),
    labels: array(row.labels).map(String).join(', '),
  }
}

function profilePayload(draft: ProfileDraft, locale: Locale): JsonObject {
  return {
    businessName: draft.businessName.trim(),
    description: draft.description.trim() || null,
    primaryCategory: draft.primaryCategory.trim(),
    additionalCategories: splitLines(draft.additionalCategories),
    phoneNumbers: { primaryPhone: draft.primaryPhone.trim() || null, additionalPhones: splitLines(draft.additionalPhones) },
    websiteUri: draft.websiteUri.trim() || null,
    businessHours: parseObjectJson(draft.businessHours, copy(locale, '通常営業時間', 'Regular hours'), locale),
    specialHours: parseArrayJson(draft.specialHours, copy(locale, '特別営業時間', 'Special hours'), locale),
    moreHours: parseArrayJson(draft.moreHours, copy(locale, '追加営業時間', 'Additional hours'), locale),
    address: {
      postalCode: draft.postalCode.trim(),
      administrativeArea: draft.prefecture.trim(),
      locality: draft.locality.trim(),
      addressLines: draft.addressLines.split('\n').map((line) => line.trim()).filter(Boolean),
    },
    serviceArea: parseObjectJson(draft.serviceArea, copy(locale, 'サービスエリア', 'Service area'), locale),
    attributes: parseObjectJson(draft.attributes, copy(locale, '属性', 'Attributes'), locale),
    openingDate: draft.openingDate || null,
    labels: splitLines(draft.labels),
    languageCode: draft.languageCode.trim() || 'ja',
  }
}

function updateDraft<T extends Record<string, string>>(setter: React.Dispatch<React.SetStateAction<T>>, key: keyof T, value: string) {
  setter((current) => ({ ...current, [key]: value }))
}

function ProfileFields({ draft, setDraft, disabled, locale }: { draft: ProfileDraft; setDraft: React.Dispatch<React.SetStateAction<ProfileDraft>>; disabled: boolean; locale: Locale }) {
  const field = (key: keyof ProfileDraft) => ({ value: draft[key], onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateDraft(setDraft, key, event.target.value), disabled })
  return (
    <>
      <MeoWorkspaceFormGrid columns={2}>
        <label>{copy(locale, '店舗名（必須）', 'Business name (required)')}<input required {...field('businessName')} /></label>
        <label>{copy(locale, '主要カテゴリ（必須）', 'Primary category (required)')}<input required {...field('primaryCategory')} /></label>
        <label>{copy(locale, '追加カテゴリ（カンマ区切り）', 'Additional categories (comma-separated)')}<input {...field('additionalCategories')} /></label>
        <label>{copy(locale, '表示言語', 'Display language')}<input {...field('languageCode')} /></label>
        <label>{copy(locale, 'メイン電話番号', 'Primary phone')}<input inputMode="tel" {...field('primaryPhone')} /></label>
        <label>{copy(locale, '追加電話番号（最大2件）', 'Additional phone numbers (up to 2)')}<input {...field('additionalPhones')} /></label>
        <label>{copy(locale, 'Webサイト', 'Website')}<input type="url" {...field('websiteUri')} /></label>
        <label>{copy(locale, '開業日', 'Opening date')}<input type="date" {...field('openingDate')} /></label>
        <label>{copy(locale, '郵便番号', 'Postal code')}<input {...field('postalCode')} /></label>
        <label>{copy(locale, '都道府県', 'Prefecture / state')}<input {...field('prefecture')} /></label>
        <label>{copy(locale, '市区町村', 'City')}<input {...field('locality')} /></label>
        <label>{copy(locale, '住所行', 'Address lines')}<textarea rows={3} {...field('addressLines')} /></label>
      </MeoWorkspaceFormGrid>
      <MeoWorkspaceFormGrid columns={1}>
        <label>{copy(locale, '店舗説明（750文字まで）', 'Business description (up to 750 characters)')}<textarea rows={5} maxLength={750} {...field('description')} /></label>
        <label>{copy(locale, 'サービスエリア（JSON）', 'Service area (JSON)')}<textarea rows={4} spellCheck={false} {...field('serviceArea')} /></label>
        <label>{copy(locale, '通常営業時間（JSON）', 'Regular hours (JSON)')}<textarea rows={6} spellCheck={false} {...field('businessHours')} /></label>
        <label>{copy(locale, '特別営業時間（JSON配列）', 'Special hours (JSON array)')}<textarea rows={6} spellCheck={false} {...field('specialHours')} /></label>
        <label>{copy(locale, '追加営業時間（JSON配列）', 'Additional hours (JSON array)')}<textarea rows={5} spellCheck={false} {...field('moreHours')} /></label>
        <label>{copy(locale, '属性（JSON）', 'Attributes (JSON)')}<textarea rows={5} spellCheck={false} {...field('attributes')} /></label>
        <label>{copy(locale, 'ラベル（カンマ区切り）', 'Labels (comma-separated)')}<input {...field('labels')} /></label>
      </MeoWorkspaceFormGrid>
    </>
  )
}

function flatten(value: unknown, locale: Locale, prefix = ''): Array<[string, string]> {
  if (value === null || typeof value !== 'object') return [[prefix || copy(locale, '値', 'Value'), String(value ?? '—')]]
  return Object.entries(value as JsonObject).flatMap(([key, nested]) => flatten(nested, locale, prefix ? `${prefix}.${key}` : key))
}

function ProfileWorkspace({ snapshot, storeId }: { snapshot: MeoWorkspaceSnapshot; storeId: string }) {
  const { locale } = useI18n()
  const queryClient = useQueryClient()
  const role = snapshot.authorization.role
  const disabled = readOnly(role)
  const [tab, setTab] = useState<'profile' | 'snapshots' | 'diagnosis'>('profile')
  const [draft, setDraft] = useState(() => profileDraft(snapshot.profile))
  const [formError, setFormError] = useState('')
  const [selectedSnapshot, setSelectedSnapshot] = useState<JsonObject | null>(null)
  const [restoreConfirmed, setRestoreConfirmed] = useState(false)
  const snapshots = useQuery({
    queryKey: ['meo-workspace', storeId, 'snapshots'],
    queryFn: ({ signal }) => listMeoWorkspaceResource<JsonObject>(storeId, 'snapshots', { limit: 100, signal }),
    retry: false,
  })
  const save = useMutation({
    mutationFn: (payload: JsonObject) => mutateMeoWorkspaceResource(storeId, 'profile', 'save', payload),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['meo-workspace', storeId] }) },
  })
  const restore = useMutation({
    mutationFn: (snapshotId: string) => mutateMeoWorkspaceResource(storeId, 'snapshots', 'restore', {}, snapshotId),
    onSuccess: async () => { setRestoreConfirmed(false); await queryClient.invalidateQueries({ queryKey: ['meo-workspace', storeId] }) },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFormError('')
    try { save.mutate(profilePayload(draft, locale)) } catch (error) { setFormError(errorMessage(error, locale)) }
  }
  const currentPayload = payloadOf(snapshot.profile ?? {})
  const selectedPayload = payloadOf(selectedSnapshot ?? {})
  const currentFlat = new Map(flatten(currentPayload, locale))
  const selectedFlat = new Map(flatten(selectedPayload, locale))
  const diffRows = [...new Set([...currentFlat.keys(), ...selectedFlat.keys()])]
    .filter((key) => currentFlat.get(key) !== selectedFlat.get(key))
    .map((key) => ({ key, current: currentFlat.get(key) ?? '—', snapshot: selectedFlat.get(key) ?? '—' }))
  const checks = [
    [copy(locale, '店舗名', 'Business name'), draft.businessName.trim().length > 0], [copy(locale, '主要カテゴリ', 'Primary category'), draft.primaryCategory.trim().length > 0],
    [copy(locale, '電話番号', 'Phone number'), draft.primaryPhone.trim().length > 0], [copy(locale, 'Webサイト', 'Website'), draft.websiteUri.trim().length > 0],
    [copy(locale, '住所またはサービスエリア', 'Address or service area'), draft.addressLines.trim().length > 0 || draft.serviceArea.trim() !== '{}'],
    [copy(locale, '通常営業時間', 'Regular hours'), draft.businessHours.trim() !== '{}'], [copy(locale, '店舗説明（80文字以上）', 'Business description (at least 80 characters)'), draft.description.trim().length >= 80],
    [copy(locale, '属性', 'Attributes'), draft.attributes.trim() !== '{}'], [copy(locale, '開業日', 'Opening date'), draft.openingDate.length > 0],
  ] as const
  return (
    <MeoWorkspacePage title={copy(locale, 'GBP店舗情報', 'GBP profile')} description={copy(locale, 'Google ビジネス プロフィールの正本をZeroに保存し、差分と履歴を管理します。Googleへの反映は明示確認後の手動操作です。', 'Save the canonical Google Business Profile in Zero and manage changes and history. Applying changes to Google is a separate manual action.')} busy={save.isPending || restore.isPending}>
      <MeoWorkspaceNavigation />
      <MeoWorkspacePermissionNotice role={role} />
      <MeoWorkspaceTabs value={tab} onValueChange={setTab} items={[
        { value: 'profile', label: copy(locale, '店舗情報', 'Profile') }, { value: 'snapshots', label: copy(locale, '履歴・復元', 'History & restore'), ...(snapshots.data ? { count: snapshots.data.items.length } : {}) }, { value: 'diagnosis', label: copy(locale, '診断', 'Diagnostics') },
      ]} />
      {tab === 'profile' ? (
        <form onSubmit={submit}>
          <MeoWorkspaceSection title={copy(locale, 'プロフィール項目', 'Profile fields')} description={copy(locale, 'カテゴリ、所在地、営業時間、連絡先、説明、属性を一か所で編集します。', 'Edit categories, location, hours, contact details, description, and attributes in one place.')} surface="outlined">
            <ProfileFields draft={draft} setDraft={setDraft} disabled={disabled} locale={locale} />
            <MeoWorkspaceActions><Button type="submit" busy={save.isPending} disabled={disabled}>{copy(locale, '変更を保存', 'Save changes')}</Button></MeoWorkspaceActions>
          </MeoWorkspaceSection>
          {formError || save.isError ? <Notice tone="error">{formError || errorMessage(save.error, locale)}</Notice> : null}
          {mutationNotice(save.data, copy(locale, 'Zeroの店舗情報と新しいスナップショットを保存しました。', 'The Zero profile and a new snapshot were saved.'), locale)}
        </form>
      ) : null}
      {tab === 'snapshots' ? (
        <>
          {snapshots.isPending ? <MeoWorkspaceLoadingState title={copy(locale, '履歴を読み込んでいます', 'Loading history')} /> : null}
          {snapshots.isError ? <MeoWorkspaceErrorState title={copy(locale, '履歴を読み込めませんでした', 'History could not be loaded')} description={errorMessage(snapshots.error, locale)} onRetry={() => void snapshots.refetch()} /> : null}
          {snapshots.data ? <MeoWorkspaceDataTable label={copy(locale, 'プロフィール履歴', 'Profile history')} rows={snapshots.data.items} getRowKey={(row, index) => idOf(row) || String(index)} columns={[
            { id: 'date', header: copy(locale, '保存日時', 'Saved at'), cell: (row) => formatDateTime(dateTimeOf(row), locale) },
            { id: 'source', header: copy(locale, '保存元', 'Source'), cell: (row) => text(row.source, 'Zero') },
            { id: 'action', header: copy(locale, '操作', 'Actions'), cell: (row) => <Button type="button" variant="secondary" onClick={() => { setSelectedSnapshot(row); setRestoreConfirmed(false) }}>{copy(locale, '差分を見る', 'View changes')}</Button> },
          ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, '履歴はまだありません', 'No history yet')} description={copy(locale, 'プロフィールを保存すると復元可能な履歴が作成されます。', 'Saving the profile creates a restorable version.')} />} /> : null}
          {selectedSnapshot ? (
            <MeoWorkspaceSection title={copy(locale, '現在との差分', 'Changes from current')} description={copy(locale, '復元すると現在の値が選択した時点の値に置き換わります。', 'Restoring replaces current values with the selected version.')} surface="outlined">
              <MeoWorkspaceDataTable label={copy(locale, 'プロフィール差分', 'Profile changes')} rows={diffRows} getRowKey={(row) => row.key} columns={[
                { id: 'key', header: copy(locale, '項目', 'Field'), cell: (row) => row.key }, { id: 'current', header: copy(locale, '現在', 'Current'), cell: (row) => row.current }, { id: 'snapshot', header: copy(locale, '選択した履歴', 'Selected version'), cell: (row) => row.snapshot },
              ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, '差分はありません', 'No changes')} />} />
              <label><input type="checkbox" checked={restoreConfirmed} onChange={(event) => setRestoreConfirmed(event.target.checked)} disabled={disabled} /> {copy(locale, '現在の情報を置き換えることを確認しました', 'I confirm that the current profile will be replaced')}</label>
              <MeoWorkspaceActions><Button type="button" variant="danger" busy={restore.isPending} disabled={disabled || !restoreConfirmed || !idOf(selectedSnapshot)} onClick={() => restore.mutate(idOf(selectedSnapshot))}>{copy(locale, 'この時点へ手動復元', 'Restore this version manually')}</Button></MeoWorkspaceActions>
              {restore.isError ? <Notice tone="error">{errorMessage(restore.error, locale)}</Notice> : null}
              {mutationNotice(restore.data, copy(locale, '選択したスナップショットへ復元しました。', 'The selected snapshot was restored.'), locale)}
            </MeoWorkspaceSection>
          ) : null}
        </>
      ) : null}
      {tab === 'diagnosis' ? (
        <MeoWorkspaceSection title={copy(locale, 'プロフィール診断', 'Profile diagnostics')} description={copy(locale, '追加費用なしの決定論的チェックです。AIや外部サービスへ送信しません。', 'These deterministic checks cost nothing and send no data to AI or external services.')} surface="outlined">
          <MeoWorkspaceStatus label={copy(locale, `${checks.filter(([, ok]) => ok).length}/${checks.length}項目を確認`, `${checks.filter(([, ok]) => ok).length}/${checks.length} checks passed`)} tone={checks.every(([, ok]) => ok) ? 'success' : 'warning'} />
          <MeoWorkspaceDataTable label={copy(locale, '改善チェックリスト', 'Improvement checklist')} rows={checks} getRowKey={(row) => row[0]} columns={[
            { id: 'check', header: copy(locale, '確認項目', 'Check'), cell: (row) => row[0] }, { id: 'status', header: copy(locale, '状態', 'Status'), cell: (row) => <MeoWorkspaceStatus label={row[1] ? copy(locale, '設定済み', 'Complete') : copy(locale, '要改善', 'Needs improvement')} tone={row[1] ? 'success' : 'warning'} /> },
          ]} />
        </MeoWorkspaceSection>
      ) : null}
    </MeoWorkspacePage>
  )
}

export function GbpProfileWorkspacePage() {
  const { locale } = useI18n()
  const workspace = useWorkspace()
  return <WorkspaceGate title={copy(locale, 'GBP店舗情報', 'GBP profile')} description={copy(locale, '店舗情報の正本・履歴・診断を管理します。', 'Manage the source profile, history, and diagnostics.')} workspace={workspace}>{(snapshot) => <ProfileWorkspace snapshot={snapshot} storeId={workspace.storeId} />}</WorkspaceGate>
}

type ReviewFilters = { search: string; rating: string; language: string; status: string }

function ReviewWorkspace({ snapshot, storeId }: { snapshot: MeoWorkspaceSnapshot; storeId: string }) {
  const { locale } = useI18n()
  const queryClient = useQueryClient()
  const role = snapshot.authorization.role
  const disabled = readOnly(role)
  const [filters, setFilters] = useState<ReviewFilters>({ search: '', rating: '', language: '', status: '' })
  const [selected, setSelected] = useState<JsonObject | null>(null)
  const [reply, setReply] = useState('')
  const [replyLanguage, setReplyLanguage] = useState('ja')
  const [manual, setManual] = useState({ authorName: '', rating: '5', comment: '', languageCode: 'ja', reviewedAt: nowIso().slice(0, 16) })
  const [template, setTemplate] = useState({ id: '', name: '', body: '', languageCode: 'ja', minRating: '', maxRating: '' })
  const [importMessage, setImportMessage] = useState('')
  const [importError, setImportError] = useState('')

  const reviews = useQuery({
    queryKey: ['meo-workspace', storeId, 'reviews', filters],
    queryFn: ({ signal }) => listMeoWorkspaceResource<JsonObject>(storeId, 'reviews', {
      limit: 100,
      signal,
      filters: { search: filters.search, rating: filters.rating ? Number(filters.rating) : undefined, language_code: filters.language, status: filters.status },
    }),
    retry: false,
  })
  const templates = useQuery({
    queryKey: ['meo-workspace', storeId, 'review_templates'],
    queryFn: ({ signal }) => listMeoWorkspaceResource<JsonObject>(storeId, 'review_templates', { limit: 100, signal }),
    retry: false,
  })
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['meo-workspace', storeId, 'reviews'] }),
      queryClient.invalidateQueries({ queryKey: ['meo-workspace', storeId, 'review_templates'] }),
      queryClient.invalidateQueries({ queryKey: ['meo-workspace', storeId, 'snapshot'] }),
    ])
  }
  const saveReply = useMutation({
    mutationFn: () => mutateMeoWorkspaceResource(storeId, 'reviews', 'update', {
      replyText: reply.trim() || null,
      replyLanguageCode: reply.trim() ? replyLanguage : null,
      status: reply.trim() ? 'replied' : 'needs_reply',
    }, selected ? idOf(selected) : null),
    onSuccess: invalidate,
  })
  const createReview = useMutation({
    mutationFn: () => mutateMeoWorkspaceResource(storeId, 'reviews', 'create', {
      provider: 'manual', authorName: manual.authorName.trim() || null, rating: Number(manual.rating),
      comment: manual.comment.trim() || null, languageCode: manual.languageCode, reviewedAt: new Date(manual.reviewedAt).toISOString(), status: 'unread',
    }),
    onSuccess: async () => { setManual((current) => ({ ...current, authorName: '', comment: '' })); await invalidate() },
  })
  const saveTemplate = useMutation({
    mutationFn: () => mutateMeoWorkspaceResource(storeId, 'review_templates', template.id ? 'update' : 'create', {
      name: template.name.trim(), body: template.body.trim(), languageCode: template.languageCode,
      minRating: template.minRating ? Number(template.minRating) : null,
      maxRating: template.maxRating ? Number(template.maxRating) : null,
    }, template.id || null),
    onSuccess: async () => { setTemplate({ id: '', name: '', body: '', languageCode: 'ja', minRating: '', maxRating: '' }); await invalidate() },
  })
  const deleteTemplate = useMutation({
    mutationFn: (templateId: string) => mutateMeoWorkspaceResource(storeId, 'review_templates', 'delete', {}, templateId),
    onSuccess: invalidate,
  })
  const importReplies = useMutation({
    mutationFn: async (rows: JsonObject[]) => Promise.all(rows.map((row) => {
      const reviewId = text(row.reviewId ?? row.review_id)
      const replyText = text(row.replyText ?? row.reply_text)
      if (!reviewId || !replyText) throw new Error(copy(locale, 'reviewId と replyText が必要です。', 'reviewId and replyText are required.'))
      return mutateMeoWorkspaceResource(storeId, 'reviews', 'update', {
        replyText, replyLanguageCode: text(row.replyLanguageCode ?? row.reply_language_code, 'ja'), status: 'needs_reply',
        ...(Array.isArray(row.tags) ? { tags: row.tags } : {}),
      }, reviewId)
    })),
    onSuccess: async (rows) => { setImportMessage(copy(locale, `${rows.length}件の返信案を「要返信」として取り込みました。公開はしていません。`, `${rows.length} reply drafts were imported as needs reply. Nothing was published.`)); await invalidate() },
  })
  const rows = reviews.data?.items ?? []
  const ratings = rows.map((row) => number(row.rating)).filter((rating) => rating >= 1 && rating <= 5)
  const replied = rows.filter((row) => text(row.reply_text ?? row.replyText) || text(row.status) === 'replied').length
  const average = ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : 0
  const exportForGpt = () => downloadText(pretty({
    schemaVersion: 1,
    instruction: copy(locale, 'replyText と replyLanguageCode を各reviewIdに追加してください。事実を創作せず、公開前に必ず人が確認します。', 'Add replyText and replyLanguageCode to each reviewId. Do not invent facts, and require human review before publishing.'),
    reviews: rows.map((row) => ({
      reviewId: idOf(row),
      rating: number(row.rating),
      languageCode: text(row.language ?? row.language_code ?? row.languageCode, 'ja'),
      authorName: text(row.reviewer_display_name ?? row.author_name ?? row.authorName),
      comment: text(row.review_text ?? row.comment),
    })),
  }), `kuchitoru-zero-reviews-${today()}.json`)
  const loadImport = async (event: ChangeEvent<HTMLInputElement>) => {
    setImportError(''); setImportMessage('')
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      const records = Array.isArray(parsed) ? parsed : array(object(parsed).replies)
      if (!records.length || records.some((row) => row === null || Array.isArray(row) || typeof row !== 'object')) throw new Error(copy(locale, '返信案の配列を確認してください。', 'Check the reply draft array.'))
      importReplies.mutate(records as JsonObject[])
    } catch (error) { setImportError(errorMessage(error, locale)) }
    event.target.value = ''
  }
  return (
    <MeoWorkspacePage title={copy(locale, '口コミ受信箱', 'Review inbox')} description={copy(locale, '口コミの取り込み、絞り込み、返信案と履歴をZero内で管理します。外部GPTは任意で、月額費用なしのJSON連携です。', 'Import and filter reviews and manage reply drafts and history in Zero. External GPT use is optional through free JSON exchange.')} busy={saveReply.isPending || createReview.isPending || importReplies.isPending} actions={<>
      <Button type="button" variant="secondary" onClick={exportForGpt}><FileJson aria-hidden="true" />{copy(locale, 'GPT用JSON', 'JSON for GPT')}</Button>
      <label className="button button--secondary" aria-disabled={disabled}><Upload aria-hidden="true" />{copy(locale, '返信案JSONを取込', 'Import reply JSON')}<input className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void loadImport(event)} disabled={disabled} /></label>
    </>}>
      <MeoWorkspaceNavigation />
      <MeoWorkspacePermissionNotice role={role} />
      <MeoWorkspaceSection title={copy(locale, 'ネイティブ集計', 'Local summary')} description={copy(locale, '表示中の口コミだけをブラウザ内で集計し、外部AIへは送信しません。', 'Summarizes only the displayed reviews in your browser without sending them to an external AI service.')} surface="muted">
        <MeoWorkspaceFormGrid columns={3}>
          <MeoWorkspaceStatus label={copy(locale, `${rows.length}件`, `${rows.length} reviews`)} detail={copy(locale, '表示件数', 'Displayed')} />
          <MeoWorkspaceStatus label={ratings.length ? `${formatNumber(average, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / 5` : '—'} detail={copy(locale, '平均評価', 'Average rating')} tone={average >= 4 ? 'success' : average ? 'warning' : 'neutral'} />
          <MeoWorkspaceStatus label={rows.length ? `${Math.round(replied / rows.length * 100)}%` : '—'} detail={copy(locale, `返信済み ${replied} / 未返信 ${rows.length - replied}`, `Replied ${replied} / awaiting reply ${rows.length - replied}`)} />
        </MeoWorkspaceFormGrid>
        <p>{copy(locale, '評価分布', 'Rating distribution')}: {[5, 4, 3, 2, 1].map((rating) => copy(locale, `★${rating} ${ratings.filter((value) => value === rating).length}件`, `★${rating}: ${ratings.filter((value) => value === rating).length}`)).join(copy(locale, ' ／ ', ' / '))}</p>
      </MeoWorkspaceSection>
      <MeoWorkspaceFilterRow label={copy(locale, '口コミの絞り込み', 'Review filters')}>
        <label>{copy(locale, '検索', 'Search')}<input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /></label>
        <label>{copy(locale, '評価', 'Rating')}<select value={filters.rating} onChange={(event) => setFilters((current) => ({ ...current, rating: event.target.value }))}><option value="">{copy(locale, 'すべて', 'All')}</option>{[5,4,3,2,1].map((value) => <option key={value} value={value}>★{value}</option>)}</select></label>
        <label>{copy(locale, '言語', 'Language')}<input value={filters.language} onChange={(event) => setFilters((current) => ({ ...current, language: event.target.value }))} placeholder="ja" /></label>
        <label>{copy(locale, '状態', 'Status')}<select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">{copy(locale, 'すべて', 'All')}</option><option value="unread">{copy(locale, '未読', 'Unread')}</option><option value="needs_reply">{copy(locale, '要返信', 'Needs reply')}</option><option value="replied">{copy(locale, '返信済み', 'Replied')}</option><option value="archived">{copy(locale, 'アーカイブ', 'Archived')}</option></select></label>
      </MeoWorkspaceFilterRow>
      {reviews.isPending ? <MeoWorkspaceLoadingState title={copy(locale, '口コミを読み込んでいます', 'Loading reviews')} /> : null}
      {reviews.isError ? <MeoWorkspaceErrorState title={copy(locale, '口コミを読み込めませんでした', 'Reviews could not be loaded')} description={errorMessage(reviews.error, locale)} onRetry={() => void reviews.refetch()} /> : null}
      {reviews.data ? <MeoWorkspaceDataTable label={copy(locale, '口コミ受信箱', 'Review inbox')} rows={rows} getRowKey={(row, index) => idOf(row) || String(index)} columns={[
        { id: 'rating', header: copy(locale, '評価', 'Rating'), cell: (row) => `★${number(row.rating)}` },
        { id: 'review', header: copy(locale, '口コミ', 'Review'), cell: (row) => <><strong>{text(row.reviewer_display_name ?? row.author_name ?? row.authorName, copy(locale, '匿名', 'Anonymous'))}</strong><br />{text(row.review_text ?? row.comment, copy(locale, '本文なし', 'No text'))}</> },
        { id: 'language', header: copy(locale, '言語', 'Language'), cell: (row) => text(row.language ?? row.language_code ?? row.languageCode, '—') },
        { id: 'status', header: copy(locale, '状態', 'Status'), cell: (row) => <MeoWorkspaceStatus label={text(row.status) ? statusLabel(text(row.status), locale) : copy(locale, '未確認', 'Unknown')} tone={text(row.status) === 'replied' ? 'success' : 'neutral'} /> },
        { id: 'action', header: copy(locale, '返信', 'Reply'), cell: (row) => <Button type="button" variant="secondary" onClick={() => { setSelected(row); setReply(text(row.reply_text ?? row.replyText)); setReplyLanguage(text(row.reply_language ?? row.reply_language_code ?? row.replyLanguageCode, 'ja')) }}>{copy(locale, '開く', 'Open')}</Button> },
      ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, '該当する口コミはありません', 'No matching reviews')} />} /> : null}
      {selected ? <MeoWorkspaceSection title={copy(locale, '返信を編集', 'Edit reply')} description={copy(locale, 'ここでの保存はZero内の返信管理です。Googleへ自動送信しません。', 'Saving here only manages the reply in Zero; it is not sent to Google automatically.')} surface="outlined">
        <p><strong>{copy(locale, '口コミ:', 'Review:')}</strong> {text(selected.review_text ?? selected.comment, copy(locale, '本文なし', 'No text'))}</p>
        <label>{copy(locale, '返信文', 'Reply')}<textarea rows={6} value={reply} onChange={(event) => setReply(event.target.value)} disabled={disabled} /></label>
        <label>{copy(locale, '返信言語', 'Reply language')}<input value={replyLanguage} onChange={(event) => setReplyLanguage(event.target.value)} disabled={disabled} /></label>
        <MeoWorkspaceActions>
          <Button type="button" busy={saveReply.isPending} disabled={disabled || !idOf(selected)} onClick={() => saveReply.mutate()}>{copy(locale, '返信をZeroに保存', 'Save reply in Zero')}</Button>
          {templates.data?.items.map((row) => <Button key={idOf(row)} type="button" variant="quiet" disabled={disabled} onClick={() => setReply(text(row.body))}>{text(row.name, copy(locale, 'テンプレート', 'Template'))}</Button>)}
        </MeoWorkspaceActions>
        {saveReply.isError ? <Notice tone="error">{errorMessage(saveReply.error, locale)}</Notice> : null}
        {mutationNotice(saveReply.data, copy(locale, '返信と状態をZeroに保存しました。Googleには送信していません。', 'The reply and status were saved in Zero. Nothing was sent to Google.'), locale)}
        <h3>{copy(locale, '返信履歴', 'Reply history')}</h3>
        {array(selected.reply_history ?? selected.replyHistory).length ? <ul>{array(selected.reply_history ?? selected.replyHistory).map((entry, index) => <li key={index}><pre>{pretty(entry)}</pre></li>)}</ul> : <p>{copy(locale, '履歴はまだありません。', 'No history yet.')}</p>}
      </MeoWorkspaceSection> : null}
      <MeoWorkspaceSection title={copy(locale, '口コミを手動取込', 'Import review manually')} description={copy(locale, 'Google接続がない店舗も、口コミをZeroのDBへ保存できます。', 'Stores without a Google connection can save reviews in the Zero database.')} surface="outlined">
        <MeoWorkspaceFormGrid columns={2}>
          <label>{copy(locale, '投稿者', 'Author')}<input value={manual.authorName} onChange={(event) => setManual((current) => ({ ...current, authorName: event.target.value }))} disabled={disabled} /></label>
          <label>{copy(locale, '評価', 'Rating')}<select value={manual.rating} onChange={(event) => setManual((current) => ({ ...current, rating: event.target.value }))} disabled={disabled}>{[5,4,3,2,1].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>{copy(locale, '言語', 'Language')}<input value={manual.languageCode} onChange={(event) => setManual((current) => ({ ...current, languageCode: event.target.value }))} disabled={disabled} /></label>
          <label>{copy(locale, '投稿日', 'Review date')}<input type="datetime-local" value={manual.reviewedAt} onChange={(event) => setManual((current) => ({ ...current, reviewedAt: event.target.value }))} disabled={disabled} /></label>
        </MeoWorkspaceFormGrid>
        <label>{copy(locale, '口コミ', 'Review')}<textarea rows={4} value={manual.comment} onChange={(event) => setManual((current) => ({ ...current, comment: event.target.value }))} disabled={disabled} /></label>
        <MeoWorkspaceActions><Button type="button" busy={createReview.isPending} disabled={disabled} onClick={() => createReview.mutate()}>{copy(locale, '口コミを保存', 'Save review')}</Button></MeoWorkspaceActions>
        {createReview.isError ? <Notice tone="error">{errorMessage(createReview.error, locale)}</Notice> : null}{mutationNotice(createReview.data, copy(locale, '口コミを受信箱に保存しました。', 'The review was saved to the inbox.'), locale)}
      </MeoWorkspaceSection>
      <MeoWorkspaceSection title={copy(locale, '返信テンプレート', 'Reply templates')} description={copy(locale, '言語や評価帯ごとの定型文をDBに保存します。', 'Save reusable replies by language and rating range in the database.')} surface="outlined">
        <MeoWorkspaceFormGrid columns={2}>
          <label>{copy(locale, '名前', 'Name')}<input value={template.name} onChange={(event) => setTemplate((current) => ({ ...current, name: event.target.value }))} disabled={disabled} /></label>
          <label>{copy(locale, '言語', 'Language')}<input value={template.languageCode} onChange={(event) => setTemplate((current) => ({ ...current, languageCode: event.target.value }))} disabled={disabled} /></label>
          <label>{copy(locale, '最低評価', 'Minimum rating')}<input type="number" min="1" max="5" value={template.minRating} onChange={(event) => setTemplate((current) => ({ ...current, minRating: event.target.value }))} disabled={disabled} /></label>
          <label>{copy(locale, '最高評価', 'Maximum rating')}<input type="number" min="1" max="5" value={template.maxRating} onChange={(event) => setTemplate((current) => ({ ...current, maxRating: event.target.value }))} disabled={disabled} /></label>
        </MeoWorkspaceFormGrid>
        <label>{copy(locale, '本文', 'Body')}<textarea rows={4} value={template.body} onChange={(event) => setTemplate((current) => ({ ...current, body: event.target.value }))} disabled={disabled} /></label>
        <MeoWorkspaceActions><Button type="button" busy={saveTemplate.isPending} disabled={disabled || !template.name.trim() || !template.body.trim()} onClick={() => saveTemplate.mutate()}>{template.id ? copy(locale, 'テンプレートを更新', 'Update template') : copy(locale, 'テンプレートを追加', 'Add template')}</Button>{template.id ? <Button type="button" variant="quiet" onClick={() => setTemplate({ id: '', name: '', body: '', languageCode: 'ja', minRating: '', maxRating: '' })}>{copy(locale, '編集をやめる', 'Cancel editing')}</Button> : null}</MeoWorkspaceActions>
        {templates.isError ? <Notice tone="error">{errorMessage(templates.error, locale)}</Notice> : null}
        {templates.data ? <MeoWorkspaceDataTable label={copy(locale, '返信テンプレート一覧', 'Reply templates')} rows={templates.data.items} getRowKey={(row, index) => idOf(row) || String(index)} columns={[
          { id: 'name', header: copy(locale, '名前', 'Name'), cell: (row) => text(row.name) }, { id: 'body', header: copy(locale, '本文', 'Body'), cell: (row) => text(row.body) }, { id: 'lang', header: copy(locale, '言語', 'Language'), cell: (row) => text(row.language_code ?? row.languageCode) },
          { id: 'actions', header: copy(locale, '操作', 'Actions'), cell: (row) => <MeoWorkspaceActions><Button type="button" variant="quiet" disabled={disabled} onClick={() => setTemplate({ id: idOf(row), name: text(row.name), body: text(row.body), languageCode: text(row.language_code ?? row.languageCode, 'ja'), minRating: String(row.min_rating ?? row.minRating ?? ''), maxRating: String(row.max_rating ?? row.maxRating ?? '') })}>{copy(locale, '編集', 'Edit')}</Button><Button type="button" variant="danger" disabled={disabled} onClick={() => deleteTemplate.mutate(idOf(row))}>{copy(locale, '削除', 'Delete')}</Button></MeoWorkspaceActions> },
        ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, 'テンプレートはまだありません', 'No templates yet')} />} /> : null}
      </MeoWorkspaceSection>
      {importMessage ? <Notice tone="success">{importMessage}</Notice> : null}{importError || importReplies.isError ? <Notice tone="error">{importError || errorMessage(importReplies.error, locale)}</Notice> : null}
    </MeoWorkspacePage>
  )
}

export function ReviewInboxWorkspacePage() {
  const { locale } = useI18n()
  const workspace = useWorkspace()
  return <WorkspaceGate title={copy(locale, '口コミ受信箱', 'Review inbox')} description={copy(locale, '口コミと返信を一か所で管理します。', 'Manage reviews and replies in one place.')} workspace={workspace}>{(snapshot) => <ReviewWorkspace snapshot={snapshot} storeId={workspace.storeId} />}</WorkspaceGate>
}

type PostDraft = {
  id: string; topicType: 'update' | 'event' | 'offer'; title: string; summary: string; languageCode: string;
  ctaType: string; ctaUrl: string; mediaAssetIds: string; event: string; offer: string; status: 'draft' | 'ready_for_manual_publish'
}

const emptyPost: PostDraft = { id: '', topicType: 'update', title: '', summary: '', languageCode: 'ja', ctaType: '', ctaUrl: '', mediaAssetIds: '', event: '{}', offer: '{}', status: 'draft' }

function PostWorkspace({ snapshot, storeId }: { snapshot: MeoWorkspaceSnapshot; storeId: string }) {
  const { locale } = useI18n()
  const queryClient = useQueryClient()
  const role = snapshot.authorization.role
  const disabled = readOnly(role)
  const [draft, setDraft] = useState<PostDraft>(emptyPost)
  const [media, setMedia] = useState({ url: '', altText: '', source: 'external_url' })
  const [confirmed, setConfirmed] = useState(false)
  const [providerUrl, setProviderUrl] = useState('')
  const [providerResourceName, setProviderResourceName] = useState('')
  const [publishRevision, setPublishRevision] = useState<{ revision: number; fingerprint: string } | null>(null)
  const [formError, setFormError] = useState('')
  const posts = useQuery({ queryKey: ['meo-workspace', storeId, 'posts'], queryFn: ({ signal }) => listMeoWorkspaceResource<JsonObject>(storeId, 'posts', { limit: 100, signal }), retry: false })
  const mediaList = useQuery({ queryKey: ['meo-workspace', storeId, 'media'], queryFn: ({ signal }) => listMeoWorkspaceResource<JsonObject>(storeId, 'media', { limit: 100, signal }), retry: false })
  const invalidate = async () => { await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['meo-workspace', storeId, 'posts'] }),
    queryClient.invalidateQueries({ queryKey: ['meo-workspace', storeId, 'media'] }),
    queryClient.invalidateQueries({ queryKey: ['meo-workspace', storeId, 'snapshot'] }),
  ]) }
  const savePost = useMutation({
    mutationFn: (payload: JsonObject) => mutateMeoWorkspaceResource(storeId, 'posts', draft.id ? 'update' : 'create', payload, draft.id || null),
    onSuccess: async (result) => {
      const saved = object(result.data)
      const savedId = idOf(saved)
      const revision = number(saved.revision)
      const fingerprint = text(saved.revision_fingerprint ?? saved.revisionFingerprint)
      if (savedId) setDraft((current) => ({ ...current, id: current.id || savedId }))
      setPublishRevision(revision >= 1 && fingerprint ? { revision, fingerprint } : null)
      setConfirmed(false)
      await invalidate()
    },
  })
  const deletePost = useMutation({ mutationFn: (postId: string) => mutateMeoWorkspaceResource(storeId, 'posts', 'delete', {}, postId), onSuccess: invalidate })
  const addMedia = useMutation({
    mutationFn: () => mutateMeoWorkspaceResource(storeId, 'media', 'create', { kind: 'image', source: media.source, url: media.url.trim(), thumbnailUrl: null, altText: media.altText.trim() || null }),
    onSuccess: async (result) => { setMedia({ url: '', altText: '', source: 'external_url' }); const createdId = idOf(object(result.data)); if (createdId) setDraft((current) => ({ ...current, mediaAssetIds: [...splitLines(current.mediaAssetIds), createdId].join(', ') })); await invalidate() },
  })
  const confirmPublish = useMutation({
    mutationFn: () => mutateMeoWorkspaceResource(storeId, 'posts', 'record_publish_confirmation', {
      confirmedAt: nowIso(), provider: 'google_business', providerResourceName: providerResourceName.trim() || null,
      providerUrl: providerUrl.trim() || null, readback: { manuallyConfirmed: true }, notes: copy(locale, '店舗運用者がGoogleでの手動投稿を確認', 'Store operator confirmed the manual Google post'),
      revision: publishRevision?.revision,
      revisionFingerprint: publishRevision?.fingerprint,
    }, draft.id),
    onSuccess: async () => { setConfirmed(false); await invalidate() },
  })
  const postPayload = () => ({
    topicType: draft.topicType, title: draft.title.trim() || null, summary: draft.summary.trim(), languageCode: draft.languageCode,
    callToAction: draft.ctaType ? { actionType: draft.ctaType, url: draft.ctaUrl.trim() || null } : null,
    mediaAssetIds: splitLines(draft.mediaAssetIds),
    event: draft.topicType === 'event' ? parseObjectJson(draft.event, copy(locale, 'イベント詳細', 'Event details'), locale) : null,
    offer: draft.topicType === 'offer' ? parseObjectJson(draft.offer, copy(locale, '特典詳細', 'Offer details'), locale) : null,
    status: draft.status,
  })
  const submit = () => { setFormError(''); try { savePost.mutate(postPayload()) } catch (error) { setFormError(errorMessage(error, locale)) } }
  const edit = (row: JsonObject) => {
    const data = payloadOf(row)
    const details = object(data.details)
    const latestRevision = object(data.latest_revision ?? data.latestRevision)
    setDraft({
      id: idOf(row), topicType: (['update', 'event', 'offer'].includes(text(data.topic_type ?? data.topicType)) ? text(data.topic_type ?? data.topicType) : 'update') as PostDraft['topicType'],
      title: text(data.title), summary: text(data.summary), languageCode: text(details.language ?? data.language_code ?? data.languageCode, 'ja'),
      ctaType: text(data.call_to_action ?? object(data.callToAction).actionType ?? object(data.callToAction).action_type),
      ctaUrl: text(data.call_to_action_url ?? object(data.callToAction).url), mediaAssetIds: array(data.media_asset_ids ?? data.mediaAssetIds).map(String).join(', '),
      event: pretty(details.event ?? data.event ?? {}), offer: pretty(details.offer ?? data.offer ?? {}), status: ['ready', 'ready_for_manual_publish'].includes(text(data.status)) ? 'ready_for_manual_publish' : 'draft',
    })
    const revision = number(latestRevision.revision)
    const fingerprint = text(latestRevision.fingerprint)
    setPublishRevision(revision >= 1 && fingerprint ? { revision, fingerprint } : null)
    setConfirmed(false)
  }
  return (
    <MeoWorkspacePage title={copy(locale, 'GBP投稿', 'GBP posts')} description={copy(locale, '更新・イベント・特典を下書きし、プレビュー後にGoogleへ手動投稿します。予約実行や自動投稿は行いません。', 'Draft updates, events, and offers, then post them to Google manually after previewing. Zero does not schedule or publish automatically.')} busy={savePost.isPending || confirmPublish.isPending}>
      <MeoWorkspaceNavigation />
      <MeoWorkspacePermissionNotice role={role} />
      <Notice tone="info">{copy(locale, 'Zero内の下書きです。Instagramは素材の任意取込元にすぎず、投稿はGBPネイティブの内容として編集します。', 'Drafts stay in Zero. Instagram is only an optional media source; edit each post as native GBP content.')}</Notice>
      <MeoWorkspaceSection title={draft.id ? copy(locale, '投稿を編集', 'Edit post') : copy(locale, '新しい投稿', 'New post')} description={copy(locale, '58文字までのタイトル、1,500文字までの本文、CTA、画像を保存できます。', 'Save a title up to 58 characters, body up to 1,500 characters, CTA, and images.')} surface="outlined">
        <MeoWorkspaceFormGrid columns={2}>
          <label>{copy(locale, '投稿種別', 'Post type')}<select value={draft.topicType} onChange={(event) => setDraft((current) => ({ ...current, topicType: event.target.value as PostDraft['topicType'] }))} disabled={disabled}><option value="update">{copy(locale, '最新情報', 'Update')}</option><option value="event">{copy(locale, 'イベント', 'Event')}</option><option value="offer">{copy(locale, '特典', 'Offer')}</option></select></label>
          <label>{copy(locale, '状態', 'Status')}<select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as PostDraft['status'] }))} disabled={disabled}><option value="draft">{copy(locale, '下書き', 'Draft')}</option><option value="ready_for_manual_publish">{copy(locale, '手動公開の準備完了', 'Ready for manual publishing')}</option></select></label>
          <label>{copy(locale, 'タイトル', 'Title')}<input maxLength={58} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} disabled={disabled} /></label>
          <label>{copy(locale, '言語', 'Language')}<input value={draft.languageCode} onChange={(event) => setDraft((current) => ({ ...current, languageCode: event.target.value }))} disabled={disabled} /></label>
          <label>CTA<select value={draft.ctaType} onChange={(event) => setDraft((current) => ({ ...current, ctaType: event.target.value }))} disabled={disabled}><option value="">{copy(locale, 'なし', 'None')}</option><option value="book">{copy(locale, '予約', 'Book')}</option><option value="order">{copy(locale, '注文', 'Order')}</option><option value="shop">{copy(locale, '購入', 'Shop')}</option><option value="learn_more">{copy(locale, '詳細', 'Learn more')}</option><option value="sign_up">{copy(locale, '登録', 'Sign up')}</option><option value="call">{copy(locale, '電話', 'Call')}</option></select></label>
          <label>CTA URL<input type="url" value={draft.ctaUrl} onChange={(event) => setDraft((current) => ({ ...current, ctaUrl: event.target.value }))} disabled={disabled} /></label>
        </MeoWorkspaceFormGrid>
        <label>{copy(locale, '本文（必須）', 'Body (required)')}<textarea rows={7} required maxLength={1500} value={draft.summary} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} disabled={disabled} /></label>
        {draft.topicType === 'event' ? <label>{copy(locale, 'イベント詳細（JSON）', 'Event details (JSON)')}<textarea rows={5} spellCheck={false} value={draft.event} onChange={(event) => setDraft((current) => ({ ...current, event: event.target.value }))} disabled={disabled} /></label> : null}
        {draft.topicType === 'offer' ? <label>{copy(locale, '特典詳細（JSON）', 'Offer details (JSON)')}<textarea rows={5} spellCheck={false} value={draft.offer} onChange={(event) => setDraft((current) => ({ ...current, offer: event.target.value }))} disabled={disabled} /></label> : null}
        <label>{copy(locale, 'メディアID（カンマ区切り、最大10件）', 'Media IDs (comma-separated, up to 10)')}<input value={draft.mediaAssetIds} onChange={(event) => setDraft((current) => ({ ...current, mediaAssetIds: event.target.value }))} disabled={disabled} /></label>
        <MeoWorkspaceActions><Button type="button" busy={savePost.isPending} disabled={disabled || !draft.summary.trim()} onClick={submit}>{draft.id ? copy(locale, '改訂を保存', 'Save revision') : copy(locale, '下書きを保存', 'Save draft')}</Button>{draft.id ? <Button type="button" variant="quiet" onClick={() => setDraft(emptyPost)}>{copy(locale, '新規下書き', 'New draft')}</Button> : null}</MeoWorkspaceActions>
        {formError || savePost.isError ? <Notice tone="error">{formError || errorMessage(savePost.error, locale)}</Notice> : null}{mutationNotice(savePost.data, draft.id ? copy(locale, '改訂を保存しました。', 'Revision saved.') : copy(locale, '下書きを保存しました。', 'Draft saved.'), locale)}
      </MeoWorkspaceSection>
      <MeoWorkspaceSection title={copy(locale, 'プレビュー', 'Preview')} description={copy(locale, 'Googleへ手動で転記する前の最終確認です。', 'Final review before manually copying the post to Google.')} surface="muted">
        <article><p><small>{draft.topicType === 'update' ? copy(locale, '最新情報', 'Update') : draft.topicType === 'event' ? copy(locale, 'イベント', 'Event') : copy(locale, '特典', 'Offer')} ／ {draft.languageCode}</small></p>{draft.title ? <h3>{draft.title}</h3> : null}<p>{draft.summary || copy(locale, '本文を入力するとここに表示されます。', 'Enter the body to preview it here.')}</p>{draft.ctaType ? <p><strong>CTA:</strong> {draft.ctaType} {draft.ctaUrl}</p> : null}</article>
      </MeoWorkspaceSection>
      <MeoWorkspaceSection title={copy(locale, 'メディア管理', 'Media management')} description={copy(locale, '画像URLをZeroへ登録します。Instagramは任意の素材取込元として選べます。', 'Register image URLs in Zero. Instagram can be selected as an optional media source.')} surface="outlined">
        <MeoWorkspaceFormGrid columns={2}>
          <label>{copy(locale, '取得元', 'Source')}<select value={media.source} onChange={(event) => setMedia((current) => ({ ...current, source: event.target.value }))} disabled={disabled}><option value="external_url">{copy(locale, '外部URL', 'External URL')}</option><option value="instagram">{copy(locale, 'Instagram（任意）', 'Instagram (optional)')}</option><option value="manual">{copy(locale, '手動', 'Manual')}</option><option value="google_business">Google Business</option></select></label>
          <label>{copy(locale, '画像URL', 'Image URL')}<input type="url" value={media.url} onChange={(event) => setMedia((current) => ({ ...current, url: event.target.value }))} disabled={disabled} /></label>
          <label>{copy(locale, '代替テキスト', 'Alt text')}<input value={media.altText} onChange={(event) => setMedia((current) => ({ ...current, altText: event.target.value }))} disabled={disabled} /></label>
        </MeoWorkspaceFormGrid>
        <MeoWorkspaceActions><Button type="button" busy={addMedia.isPending} disabled={disabled || !media.url.trim()} onClick={() => addMedia.mutate()}>{copy(locale, 'メディアを登録', 'Add media')}</Button></MeoWorkspaceActions>
        {addMedia.isError ? <Notice tone="error">{errorMessage(addMedia.error, locale)}</Notice> : null}
        {mediaList.data ? <MeoWorkspaceDataTable label={copy(locale, 'メディア一覧', 'Media list')} rows={mediaList.data.items} getRowKey={(row, index) => idOf(row) || String(index)} columns={[
          { id: 'id', header: 'ID', cell: (row) => idOf(row) }, { id: 'source', header: copy(locale, '取得元', 'Source'), cell: (row) => text(object(row.safe_metadata).source, copy(locale, '手動', 'Manual')) }, { id: 'alt', header: copy(locale, '説明', 'Description'), cell: (row) => text(row.alt_text ?? row.altText, '—') },
          { id: 'url', header: 'URL', cell: (row) => <a href={text(row.storage_path ?? row.url)} target="_blank" rel="noreferrer">{copy(locale, '開く', 'Open')}<ExternalLink aria-hidden="true" /></a> },
        ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, 'メディアはまだありません', 'No media yet')} />} /> : null}
      </MeoWorkspaceSection>
      <MeoWorkspaceSection title={copy(locale, '下書き・改訂履歴', 'Draft and revision history')} surface="outlined">
        {posts.isPending ? <MeoWorkspaceLoadingState /> : null}{posts.isError ? <MeoWorkspaceErrorState title={copy(locale, '投稿を読み込めませんでした', 'Posts could not be loaded')} description={errorMessage(posts.error, locale)} onRetry={() => void posts.refetch()} /> : null}
        {posts.data ? <MeoWorkspaceDataTable label={copy(locale, '投稿一覧', 'Posts')} rows={posts.data.items} getRowKey={(row, index) => idOf(row) || String(index)} columns={[
          { id: 'topic', header: copy(locale, '種別', 'Type'), cell: (row) => text(row.topic_type ?? row.topicType) }, { id: 'summary', header: copy(locale, '本文', 'Body'), cell: (row) => text(row.summary) }, { id: 'status', header: copy(locale, '状態', 'Status'), cell: (row) => statusLabel(text(row.status), locale) }, { id: 'updated', header: copy(locale, '更新', 'Updated'), cell: (row) => formatDateTime(dateTimeOf(row), locale) },
          { id: 'action', header: copy(locale, '操作', 'Actions'), cell: (row) => <MeoWorkspaceActions><Button type="button" variant="secondary" onClick={() => edit(row)}>{copy(locale, '編集', 'Edit')}</Button><Button type="button" variant="danger" disabled={disabled} onClick={() => deletePost.mutate(idOf(row))}>{copy(locale, '削除', 'Delete')}</Button></MeoWorkspaceActions> },
        ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, '下書きはまだありません', 'No drafts yet')} />} /> : null}
      </MeoWorkspaceSection>
      <MeoWorkspaceSection title={copy(locale, '手動公開の確認記録', 'Manual publishing confirmation')} description={copy(locale, '実際にGoogleで投稿した後、対象の下書きを選び、公開先を読み返して記録します。Zeroから自動公開はしません。', 'After posting on Google, select the draft, verify the published destination, and record confirmation. Zero never publishes automatically.')} surface="outlined">
        <label>{copy(locale, 'Googleの投稿URL', 'Google post URL')}<input type="url" value={providerUrl} onChange={(event) => setProviderUrl(event.target.value)} disabled={disabled} /></label>
        <label>{copy(locale, 'Googleリソース名（任意）', 'Google resource name (optional)')}<input value={providerResourceName} onChange={(event) => setProviderResourceName(event.target.value)} disabled={disabled} /></label>
        <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={disabled} /> {copy(locale, 'Googleで手動投稿し、公開内容を確認しました', 'I posted manually on Google and verified the published content')}</label>
        <MeoWorkspaceActions><Button type="button" busy={confirmPublish.isPending} disabled={disabled || !draft.id || !publishRevision || !confirmed || !providerUrl.trim()} onClick={() => confirmPublish.mutate()}>{copy(locale, '公開確認を記録', 'Record publishing confirmation')}</Button></MeoWorkspaceActions>
        {!draft.id ? <Notice tone="warning">{copy(locale, '履歴から対象の下書きを開いてください。', 'Open the relevant draft from history.')}</Notice> : null}
        {draft.id && !publishRevision ? <Notice tone="warning">{copy(locale, '最新の改訂証跡を読み込めません。再読み込みして対象の下書きを開いてください。', 'The latest revision evidence could not be loaded. Reload and open the relevant draft again.')}</Notice> : null}
        {confirmPublish.isError ? <Notice tone="error">{errorMessage(confirmPublish.error, locale)}</Notice> : null}{mutationNotice(confirmPublish.data, copy(locale, '手動公開と読み返しの確認記録を保存しました。', 'The manual publishing and verification record was saved.'), locale)}
      </MeoWorkspaceSection>
    </MeoWorkspacePage>
  )
}

export function PostWorkspacePage() {
  const { locale } = useI18n()
  const workspace = useWorkspace()
  return <WorkspaceGate title={copy(locale, 'GBP投稿', 'GBP posts')} description={copy(locale, '下書き・素材・手動公開確認を管理します。', 'Manage drafts, media, and manual publishing confirmations.')} workspace={workspace}>{(snapshot) => <PostWorkspace snapshot={snapshot} storeId={workspace.storeId} />}</WorkspaceGate>
}

type RankDraft = { keyword: string; rank: string; targetPlaceId: string; matchedUrl: string; locationLabel: string; latitude: string; longitude: string; observedAt: string; source: 'manual' | 'csv' }
type InsightDraft = { periodStart: string; periodEnd: string; websiteClicks: string; calls: string; directions: string; views: string; searches: string; source: 'manual' | 'csv' }

function insightMetrics(row: JsonObject): Record<string, number> {
  const metrics = object(row.metrics)
  return Object.fromEntries(Object.entries(metrics).filter((entry): entry is [string, number] => typeof entry[1] === 'number'))
}

function parseCsv(content: string, locale: Locale) {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) throw new Error(copy(locale, 'CSVは見出し行と1件以上のデータが必要です。', 'CSV requires a header row and at least one data row.'))
  const cells = (line: string) => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '').replaceAll('""', '"'))
  const headers = cells(lines[0] ?? '').map((cell) => cell.toLowerCase())
  return lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, cells(line)[index] ?? ''])))
}

function PerformanceWorkspace({ snapshot, storeId }: { snapshot: MeoWorkspaceSnapshot; storeId: string }) {
  const { locale } = useI18n()
  const queryClient = useQueryClient()
  const role = snapshot.authorization.role
  const disabled = readOnly(role)
  const [tab, setTab] = useState<'rank' | 'insights' | 'compare'>('rank')
  const [rank, setRank] = useState<RankDraft>({
    keyword: '',
    rank: '',
    targetPlaceId: text(snapshot.store?.google_place_id ?? snapshot.store?.googlePlaceId),
    matchedUrl: '',
    locationLabel: '',
    latitude: '',
    longitude: '',
    observedAt: nowIso().slice(0, 16),
    source: 'manual',
  })
  const [insight, setInsight] = useState<InsightDraft>({ periodStart: today(), periodEnd: today(), websiteClicks: '', calls: '', directions: '', views: '', searches: '', source: 'manual' })
  const [csvError, setCsvError] = useState('')
  const [csvMessage, setCsvMessage] = useState('')
  const ranks = useQuery({ queryKey: ['meo-workspace', storeId, 'rank_observations'], queryFn: ({ signal }) => listMeoWorkspaceResource<JsonObject>(storeId, 'rank_observations', { limit: 100, signal }), retry: false })
  const insights = useQuery({ queryKey: ['meo-workspace', storeId, 'insights'], queryFn: ({ signal }) => listMeoWorkspaceResource<JsonObject>(storeId, 'insights', { limit: 100, signal }), retry: false })
  const invalidate = async () => { await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['meo-workspace', storeId, 'rank_observations'] }),
    queryClient.invalidateQueries({ queryKey: ['meo-workspace', storeId, 'insights'] }),
    queryClient.invalidateQueries({ queryKey: ['meo-workspace', storeId, 'snapshot'] }),
  ]) }
  const saveRank = useMutation({ mutationFn: (value: RankDraft) => mutateMeoWorkspaceResource(storeId, 'rank_observations', 'create', {
    keyword: value.keyword.trim(), rank: value.rank ? Number(value.rank) : null, targetPlaceId: value.targetPlaceId.trim(), matchedUrl: value.matchedUrl.trim() || null,
    locationLabel: value.locationLabel.trim(), latitude: value.latitude ? Number(value.latitude) : null,
    longitude: value.longitude ? Number(value.longitude) : null, observedAt: new Date(value.observedAt).toISOString(), source: value.source,
  }), onSuccess: invalidate })
  const saveInsight = useMutation({ mutationFn: (value: InsightDraft) => mutateMeoWorkspaceResource(storeId, 'insights', 'create', {
    periodStart: value.periodStart, periodEnd: value.periodEnd, source: value.source,
    metrics: { websiteClicks: Number(value.websiteClicks || 0), calls: Number(value.calls || 0), directionRequests: Number(value.directions || 0), views: Number(value.views || 0), searches: Number(value.searches || 0) },
  }), onSuccess: invalidate })
  const rankRows = ranks.data?.items ?? []
  const insightRows = insights.data?.items ?? []
  const importRankCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    setCsvError(''); setCsvMessage('')
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const rows = parseCsv(await file.text(), locale)
      await Promise.all(rows.map((row) => mutateMeoWorkspaceResource(storeId, 'rank_observations', 'create', {
        keyword: row.keyword, rank: row.rank ? Number(row.rank) : null,
        targetPlaceId: row.target_place_id || rank.targetPlaceId.trim(), matchedUrl: row.matched_url || null,
        locationLabel: row.location_label, latitude: row.latitude ? Number(row.latitude) : null, longitude: row.longitude ? Number(row.longitude) : null,
        observedAt: new Date(row.observed_at || nowIso()).toISOString(), source: 'csv',
      })))
      setCsvMessage(copy(locale, `${rows.length}件の順位を取り込みました。`, `${rows.length} rankings imported.`)); await invalidate()
    } catch (error) { setCsvError(errorMessage(error, locale)) }
    event.target.value = ''
  }
  const exportJson = () => downloadText(pretty({ ranks: rankRows, insights: insightRows }), `kuchitoru-zero-performance-${today()}.json`)
  const exportCsv = () => downloadText(createCsv([
    [copy(locale, '種別', 'type'), copy(locale, '日付', 'date'), copy(locale, 'キー', 'key'), copy(locale, '値', 'value'), copy(locale, '地点または期間', 'location_or_period')],
    ...rankRows.map((row) => ['rank', text(row.observed_at ?? row.observedAt), text(row.keyword), row.own_position ?? row.rank ?? '', text(row.location_label ?? row.locationLabel)]),
    ...insightRows.flatMap((row) => Object.entries(insightMetrics(row)).map(([key, value]) => ['insight', text(row.period_start ?? row.periodStart), key, value, `${text(row.period_start ?? row.periodStart)}${copy(locale, '〜', ' – ')}${text(row.period_end ?? row.periodEnd)}`])),
  ]), `kuchitoru-zero-performance-${today()}.csv`, 'text/csv;charset=utf-8')
  const current = insightRows[0]
  const previous = insightRows[1]
  const metricKeys = [...new Set([...Object.keys(insightMetrics(current ?? {})), ...Object.keys(insightMetrics(previous ?? {}))])]
  const comparisons = metricKeys.map((key) => {
    const currentValue = insightMetrics(current ?? {})[key] ?? 0
    const previousValue = insightMetrics(previous ?? {})[key] ?? 0
    return { key, current: currentValue, previous: previousValue, change: currentValue - previousValue }
  })
  return (
    <MeoWorkspacePage title={copy(locale, '順位・インサイト', 'Rankings & insights')} description={copy(locale, '手入力とCSVで履歴を残し、期間比較とCSV/JSON出力を行います。スクレイピングや自動計測は含みません。', 'Keep a history through manual entry and CSV, compare periods, and export CSV/JSON. Scraping and automatic measurement are not included.')} busy={saveRank.isPending || saveInsight.isPending} actions={<><Button type="button" variant="secondary" onClick={exportCsv}><Download aria-hidden="true" />{copy(locale, 'CSV出力', 'Export CSV')}</Button><Button type="button" variant="secondary" onClick={exportJson}><FileJson aria-hidden="true" />{copy(locale, 'JSON出力', 'Export JSON')}</Button></>}>
      <MeoWorkspaceNavigation />
      <MeoWorkspacePermissionNotice role={role} />
      <MeoWorkspaceTabs value={tab} onValueChange={setTab} items={[{ value: 'rank', label: copy(locale, '検索順位', 'Search rankings'), count: rankRows.length }, { value: 'insights', label: copy(locale, 'GBPインサイト', 'GBP insights'), count: insightRows.length }, { value: 'compare', label: copy(locale, '期間比較', 'Period comparison') }]} />
      {tab === 'rank' ? <>
        <MeoWorkspaceSection title={copy(locale, '順位を記録', 'Record ranking')} description={copy(locale, '検索地点と日時を添えて、確認した順位を保存します。圏外は順位を空欄にします。', 'Save an observed ranking with its search location and time. Leave rank blank when not ranked.')} surface="outlined">
          <MeoWorkspaceFormGrid columns={2}>
            <label>{copy(locale, 'キーワード', 'Keyword')}<input value={rank.keyword} onChange={(event) => setRank((current) => ({ ...current, keyword: event.target.value }))} disabled={disabled} /></label>
            <label>{copy(locale, '順位（1〜100、圏外は空欄）', 'Rank (1–100; leave blank if not ranked)')}<input type="number" min="1" max="100" value={rank.rank} onChange={(event) => setRank((current) => ({ ...current, rank: event.target.value }))} disabled={disabled} /></label>
            <label>{copy(locale, '自店のGoogle Place ID', 'Your Google Place ID')}<input required value={rank.targetPlaceId} onChange={(event) => setRank((current) => ({ ...current, targetPlaceId: event.target.value }))} disabled={disabled} /></label>
            <label>{copy(locale, '検索地点', 'Search location')}<input value={rank.locationLabel} onChange={(event) => setRank((current) => ({ ...current, locationLabel: event.target.value }))} disabled={disabled} /></label>
            <label>{copy(locale, '確認日時', 'Observed at')}<input type="datetime-local" value={rank.observedAt} onChange={(event) => setRank((current) => ({ ...current, observedAt: event.target.value }))} disabled={disabled} /></label>
            <label>{copy(locale, '緯度', 'Latitude')}<input type="number" step="any" value={rank.latitude} onChange={(event) => setRank((current) => ({ ...current, latitude: event.target.value }))} disabled={disabled} /></label>
            <label>{copy(locale, '経度', 'Longitude')}<input type="number" step="any" value={rank.longitude} onChange={(event) => setRank((current) => ({ ...current, longitude: event.target.value }))} disabled={disabled} /></label>
            <label>{copy(locale, '表示URL', 'Displayed URL')}<input type="url" value={rank.matchedUrl} onChange={(event) => setRank((current) => ({ ...current, matchedUrl: event.target.value }))} disabled={disabled} /></label>
          </MeoWorkspaceFormGrid>
          <MeoWorkspaceActions><Button type="button" busy={saveRank.isPending} disabled={disabled || !rank.keyword.trim() || !rank.locationLabel.trim() || !rank.targetPlaceId.trim()} onClick={() => saveRank.mutate(rank)}>{copy(locale, '順位を保存', 'Save ranking')}</Button><label className="button button--secondary" aria-disabled={disabled}><Upload aria-hidden="true" />{copy(locale, '順位CSVを取込', 'Import ranking CSV')}<input className="sr-only" type="file" accept="text/csv,.csv" onChange={(event) => void importRankCsv(event)} disabled={disabled} /></label></MeoWorkspaceActions>
          <p>{copy(locale, 'CSV列: keyword, rank, target_place_id, matched_url, location_label, latitude, longitude, observed_at（target_place_idは未指定時に画面のPlace IDを使用）', 'CSV columns: keyword, rank, target_place_id, matched_url, location_label, latitude, longitude, observed_at (the on-screen Place ID is used when target_place_id is omitted)')}</p>
          {saveRank.isError || csvError ? <Notice tone="error">{csvError || errorMessage(saveRank.error, locale)}</Notice> : null}{mutationNotice(saveRank.data, copy(locale, '順位を保存しました。', 'Ranking saved.'), locale)}{csvMessage ? <Notice tone="success">{csvMessage}</Notice> : null}
        </MeoWorkspaceSection>
        {ranks.isPending ? <MeoWorkspaceLoadingState /> : null}{ranks.isError ? <MeoWorkspaceErrorState title={copy(locale, '順位を読み込めませんでした', 'Rankings could not be loaded')} description={errorMessage(ranks.error, locale)} onRetry={() => void ranks.refetch()} /> : null}
        {ranks.data ? <MeoWorkspaceDataTable label={copy(locale, '順位履歴', 'Ranking history')} rows={rankRows} getRowKey={(row, index) => idOf(row) || String(index)} columns={[
          { id: 'date', header: copy(locale, '確認日時', 'Observed at'), cell: (row) => formatDateTime(text(row.observed_at ?? row.observedAt), locale) }, { id: 'keyword', header: copy(locale, 'キーワード', 'Keyword'), cell: (row) => text(row.keyword) },
          { id: 'rank', header: copy(locale, '順位', 'Rank'), cell: (row) => row.own_position === null || row.own_position === undefined ? copy(locale, '圏外', 'Not ranked') : copy(locale, `${number(row.own_position)}位`, `#${number(row.own_position)}`) }, { id: 'location', header: copy(locale, '地点', 'Location'), cell: (row) => text(row.location_label ?? row.locationLabel) }, { id: 'source', header: copy(locale, '入力元', 'Source'), cell: (row) => text(row.input_method ?? row.source) },
        ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, '順位記録はまだありません', 'No ranking records yet')} />} /> : null}
      </> : null}
      {tab === 'insights' ? <>
        <MeoWorkspaceSection title={copy(locale, 'GBPインサイトを記録', 'Record GBP insights')} description={copy(locale, 'Google Business Profileで確認した期間集計を入力します。', 'Enter period totals observed in Google Business Profile.')} surface="outlined">
          <MeoWorkspaceFormGrid columns={3}>
            <label>{copy(locale, '開始日', 'Start date')}<input type="date" value={insight.periodStart} onChange={(event) => setInsight((current) => ({ ...current, periodStart: event.target.value }))} disabled={disabled} /></label>
            <label>{copy(locale, '終了日', 'End date')}<input type="date" value={insight.periodEnd} onChange={(event) => setInsight((current) => ({ ...current, periodEnd: event.target.value }))} disabled={disabled} /></label>
            <label>{copy(locale, 'Webサイトクリック', 'Website clicks')}<input type="number" min="0" value={insight.websiteClicks} onChange={(event) => setInsight((current) => ({ ...current, websiteClicks: event.target.value }))} disabled={disabled} /></label>
            <label>{copy(locale, '通話', 'Calls')}<input type="number" min="0" value={insight.calls} onChange={(event) => setInsight((current) => ({ ...current, calls: event.target.value }))} disabled={disabled} /></label>
            <label>{copy(locale, 'ルート検索', 'Direction requests')}<input type="number" min="0" value={insight.directions} onChange={(event) => setInsight((current) => ({ ...current, directions: event.target.value }))} disabled={disabled} /></label>
            <label>{copy(locale, '閲覧', 'Views')}<input type="number" min="0" value={insight.views} onChange={(event) => setInsight((current) => ({ ...current, views: event.target.value }))} disabled={disabled} /></label>
            <label>{copy(locale, '検索', 'Search')}<input type="number" min="0" value={insight.searches} onChange={(event) => setInsight((current) => ({ ...current, searches: event.target.value }))} disabled={disabled} /></label>
          </MeoWorkspaceFormGrid>
          <MeoWorkspaceActions><Button type="button" busy={saveInsight.isPending} disabled={disabled || !insight.periodStart || !insight.periodEnd} onClick={() => saveInsight.mutate(insight)}>{copy(locale, 'インサイトを保存', 'Save insights')}</Button></MeoWorkspaceActions>
          {saveInsight.isError ? <Notice tone="error">{errorMessage(saveInsight.error, locale)}</Notice> : null}{mutationNotice(saveInsight.data, copy(locale, 'インサイトを保存しました。', 'Insights saved.'), locale)}
        </MeoWorkspaceSection>
        {insights.isPending ? <MeoWorkspaceLoadingState /> : null}{insights.isError ? <MeoWorkspaceErrorState title={copy(locale, 'インサイトを読み込めませんでした', 'Insights could not be loaded')} description={errorMessage(insights.error, locale)} onRetry={() => void insights.refetch()} /> : null}
        {insights.data ? <MeoWorkspaceDataTable label={copy(locale, 'インサイト履歴', 'Insights history')} rows={insightRows} getRowKey={(row, index) => idOf(row) || String(index)} columns={[
          { id: 'period', header: copy(locale, '期間', 'Period'), cell: (row) => `${formatDate(text(row.period_start ?? row.periodStart), locale)}${copy(locale, '〜', ' – ')}${formatDate(text(row.period_end ?? row.periodEnd), locale)}` },
          { id: 'metrics', header: copy(locale, '指標', 'Metrics'), cell: (row) => Object.entries(insightMetrics(row)).map(([key, value]) => `${key}: ${value}`).join(copy(locale, ' ／ ', ' / ')) }, { id: 'source', header: copy(locale, '入力元', 'Source'), cell: (row) => text(row.source) },
        ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, 'インサイト記録はまだありません', 'No insight records yet')} />} /> : null}
      </> : null}
      {tab === 'compare' ? <MeoWorkspaceSection title={copy(locale, '直近2期間の比較', 'Compare the latest two periods')} description={copy(locale, '保存日時順の直近2件を同じ指標で比較します。', 'Compare the same metrics in the two most recently saved periods.')} surface="outlined">
        <MeoWorkspaceDataTable label={copy(locale, '期間比較', 'Period comparison')} rows={comparisons} getRowKey={(row) => row.key} columns={[
          { id: 'metric', header: copy(locale, '指標', 'Metrics'), cell: (row) => row.key }, { id: 'current', header: copy(locale, '最新', 'Latest'), cell: (row) => row.current }, { id: 'previous', header: copy(locale, '前期間', 'Previous period'), cell: (row) => row.previous },
          { id: 'change', header: copy(locale, '差分', 'Change'), cell: (row) => <MeoWorkspaceStatus label={`${row.change >= 0 ? '+' : ''}${row.change}`} tone={row.change > 0 ? 'success' : row.change < 0 ? 'warning' : 'neutral'} /> },
        ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, '比較には2期間のデータが必要です', 'Two periods are required for comparison')} />} />
      </MeoWorkspaceSection> : null}
    </MeoWorkspacePage>
  )
}

export function PerformanceWorkspacePage() {
  const { locale } = useI18n()
  const workspace = useWorkspace()
  return <WorkspaceGate title={copy(locale, '順位・インサイト', 'Rankings & insights')} description={copy(locale, '手入力・比較・出力を行います。', 'Enter, compare, and export data.')} workspace={workspace}>{(snapshot) => <PerformanceWorkspace snapshot={snapshot} storeId={workspace.storeId} />}</WorkspaceGate>
}
