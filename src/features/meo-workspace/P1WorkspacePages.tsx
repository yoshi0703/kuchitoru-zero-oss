import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileJson, Upload } from 'lucide-react'
import { useMemo, useState, type ChangeEvent } from 'react'
import { Button, Notice } from '../../shared/ui/ui'
import { useI18n, type Locale } from '../../shared/i18n'
import { getOwnerStores, type OwnerStoreListRecord } from '../owner/owner-api'
import { MeoWorkspacePageFrame } from './MeoWorkspacePageFrame'
import {
  MeoWorkspaceActions,
  MeoWorkspaceDataTable,
  MeoWorkspaceEmptyState,
  MeoWorkspaceErrorState,
  MeoWorkspaceFormGrid,
  MeoWorkspaceLoadingState,
  MeoWorkspaceSection,
  MeoWorkspaceStatus,
  MeoWorkspaceTabs,
} from './components'
import {
  can,
  exportStoreCsv,
  parseStoreCsv,
  planBulkChange,
  rankStores,
  type BulkPlan,
  type Role,
  type StoreCsvRow,
  type StoreSummary,
} from './domain/multistore'
import {
  buildLocalBusinessJsonLd,
  canonicalizeNap,
  createGptAnalysisEnvelope,
  diagnoseAioReadiness,
  exportGptAnalysisEnvelope,
  importGptAnalysisEnvelope,
  reconcileGptSuggestions,
  type CitationSource,
  type GptSuggestion,
  type ListingCitation,
} from './domain/aio'
import {
  listMeoWorkspaceResource,
  mutateMeoWorkspaceResource,
  type MeoWorkspaceMutationResult,
} from './meo-workspace-api'

type JsonObject = Record<string, unknown>

const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
const object = (value: unknown): JsonObject => value !== null && !Array.isArray(value) && typeof value === 'object' ? value as JsonObject : {}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const idOf = (row: JsonObject) => text(row.id ?? row.user_id ?? row.userId)
const nowIso = () => new Date().toISOString()
const today = () => nowIso().slice(0, 10)
const copy = (locale: Locale, japanese: string, english: string) => locale === 'ja' ? japanese : english
const statusLabel = (value: string, locale: Locale) => locale === 'en' ? ({
  active: 'Active', applied: 'Applied', archived: 'Archived', consistent: 'Consistent', draft: 'Draft', missing: 'Missing',
  pending: 'Pending', published: 'Published', rejected: 'Rejected', unchecked: 'Unchecked',
} as const)[value as 'active' | 'applied' | 'archived' | 'consistent' | 'draft' | 'missing' | 'pending' | 'published' | 'rejected' | 'unchecked'] ?? value : value
const formatDate = (value: unknown, locale: Locale) => typeof value === 'string' && value
  ? new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(value))
  : '—'

function errorMessage(error: unknown, locale: Locale = 'ja') {
  if (!(error instanceof Error)) return locale === 'ja' ? '操作を完了できませんでした。' : 'We could not complete the operation.'
  // Upstream messages are not product copy and may contain sensitive or untranslated text.
  return locale === 'ja' ? error.message : 'We could not complete the operation.'
}

function downloadText(content: string, filename: string, type = 'application/json;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function mutationNotice(result: MeoWorkspaceMutationResult<unknown> | undefined, message: string, locale: Locale = 'ja') {
  if (!result) return null
  return <Notice tone="success">{result.approvalRequired ? (locale === 'ja' ? '変更申請を保存しました。OwnerまたはAdminの承認後に反映されます。' : 'Change request saved. It will take effect after an Owner or Admin approves it.') : message}</Notice>
}

type MultiStoreTab = 'stores' | 'groups' | 'members' | 'approvals' | 'ranking' | 'audit'

type RankedStoreRow = {
  storeId: string
  name: string
  value: number | null
  rank: number | null
  error: boolean
}

function storesForDomain(
  stores: readonly OwnerStoreListRecord[],
  organizationId: string,
  groups: readonly JsonObject[],
): StoreSummary[] {
  const groupByStore = new Map<string, string>()
  for (const group of groups) {
    const groupId = idOf(group)
    if (!groupId) continue
    for (const storeId of array(group.store_ids ?? group.storeIds)) {
      if (typeof storeId === 'string') groupByStore.set(storeId, groupId)
    }
  }
  return stores.map((store) => {
    const groupId = groupByStore.get(store.id)
    return {
      id: store.id,
      organizationId,
      name: store.name,
      locationCode: store.public_slug,
      ...(groupId ? { groupId } : {}),
    }
  })
}

function GroupAssignmentPlan({ plan }: { plan: BulkPlan }) {
  const { locale, formatNumber } = useI18n()
  return (
    <>
      <MeoWorkspaceStatus
        label={locale === 'ja' ? `${formatNumber(plan.summary.changes)}件を変更` : `${formatNumber(plan.summary.changes)} changes`}
        detail={locale === 'ja' ? `対象 ${formatNumber(plan.summary.total)} / 変更なし ${formatNumber(plan.summary.unchanged)} / エラー ${formatNumber(plan.summary.errors)}` : `Total ${formatNumber(plan.summary.total)} / Unchanged ${formatNumber(plan.summary.unchanged)} / Errors ${formatNumber(plan.summary.errors)}`}
        tone={plan.summary.errors ? 'error' : plan.summary.changes ? 'warning' : 'neutral'}
      />
      <MeoWorkspaceDataTable
        label={locale === 'ja' ? '一括変更dry-run' : 'Bulk-change dry run'}
        rows={plan.items}
        getRowKey={(row) => row.storeId}
        columns={[
          { id: 'store', header: locale === 'ja' ? '店舗ID' : 'Store ID', cell: (row) => row.storeId },
          { id: 'before', header: locale === 'ja' ? '変更前' : 'Before', cell: (row) => row.before || (locale === 'ja' ? '未所属' : 'Unassigned') },
          { id: 'after', header: locale === 'ja' ? '変更後' : 'After', cell: (row) => row.after || (locale === 'ja' ? '未所属' : 'Unassigned') },
          { id: 'status', header: locale === 'ja' ? '判定' : 'Result', cell: (row) => <MeoWorkspaceStatus label={row.status === 'change' ? (locale === 'ja' ? '変更' : 'Change') : row.status === 'unchanged' ? (locale === 'ja' ? '変更なし' : 'Unchanged') : (locale === 'ja' ? 'エラー' : 'Error')} detail={row.error} tone={row.status === 'error' ? 'error' : row.status === 'change' ? 'warning' : 'neutral'} /> },
        ]}
      />
    </>
  )
}

function MultiStoreContent({
  storeId,
  organizationId,
  role,
  approvalRequired,
  organization,
}: {
  storeId: string
  organizationId: string
  role: Role
  approvalRequired: boolean
  organization: JsonObject
}) {
  const { locale } = useI18n()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<MultiStoreTab>('stores')
  const [organizationDraft, setOrganizationDraft] = useState({
    name: text(organization.name),
    approvalPolicy: text(organization.approval_policy ?? organization.approvalPolicy, 'owner_direct'),
  })
  const [groupDraft, setGroupDraft] = useState({ name: '', description: '', parentGroupId: '', storeIds: [] as string[] })
  const [memberDraft, setMemberDraft] = useState({ email: '', role: 'analyst', scope: 'organization' })
  const [selectedStores, setSelectedStores] = useState<string[]>([])
  const [targetGroupId, setTargetGroupId] = useState('')
  const [bulkReason, setBulkReason] = useState('')
  const [bulkPlan, setBulkPlan] = useState<BulkPlan | null>(null)
  const [csvResult, setCsvResult] = useState<ReturnType<typeof parseStoreCsv> | null>(null)
  const [csvPlan, setCsvPlan] = useState<BulkPlan | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [rankingMetric, setRankingMetric] = useState('views')
  const [invitation, setInvitation] = useState<{ token: string; expiresAt: string } | null>(null)

  const stores = useQuery({ queryKey: ['owner-stores'], queryFn: getOwnerStores, retry: false })
  const groups = useQuery({ queryKey: ['meo-workspace', storeId, 'groups'], queryFn: ({ signal }) => listMeoWorkspaceResource<JsonObject>(storeId, 'groups', { limit: 100, signal }), retry: false })
  const members = useQuery({ queryKey: ['meo-workspace', storeId, 'members'], queryFn: ({ signal }) => listMeoWorkspaceResource<JsonObject>(storeId, 'members', { limit: 100, signal }), retry: false })
  const changes = useQuery({ queryKey: ['meo-workspace', storeId, 'change_requests'], queryFn: ({ signal }) => listMeoWorkspaceResource<JsonObject>(storeId, 'change_requests', { limit: 100, signal }), retry: false })
  const audit = useQuery({
    queryKey: ['meo-workspace', storeId, 'audit'],
    queryFn: ({ signal }) => listMeoWorkspaceResource<JsonObject>(storeId, 'audit', { limit: 100, signal }),
    enabled: tab === 'audit',
    retry: false,
  })
  const rankings = useQuery({
    queryKey: ['meo-workspace', 'cross-store-ranking', stores.data?.map(({ id }) => id), rankingMetric],
    enabled: tab === 'ranking' && Boolean(stores.data?.length),
    retry: false,
    queryFn: async (): Promise<RankedStoreRow[]> => {
      const storeRows = stores.data ?? []
      const settled = await Promise.allSettled(storeRows.map(async (store) => {
        const page = await listMeoWorkspaceResource<JsonObject>(store.id, 'insights', { limit: 1 })
        const metricValue = number(object(page.items[0]?.metrics)[rankingMetric])
        return { storeId: store.id, name: store.name, value: metricValue, error: false }
      }))
      const inputs = settled.map((result, index) => result.status === 'fulfilled'
        ? result.value
        : { storeId: storeRows[index]?.id ?? `error-${index}`, name: storeRows[index]?.name ?? copy(locale, '取得失敗', 'Retrieval failed'), value: null, error: true })
      const ranked = new Map(rankStores(inputs.map(({ storeId: id, value }) => ({ storeId: id, value }))).map((item) => [item.storeId, item.rank]))
      return inputs.map((item) => ({ ...item, rank: ranked.get(item.storeId) ?? null })).sort((left, right) => (left.rank ?? Number.POSITIVE_INFINITY) - (right.rank ?? Number.POSITIVE_INFINITY) || left.name.localeCompare(right.name, locale === 'ja' ? 'ja' : 'en'))
    },
  })

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['meo-workspace', storeId] }),
      queryClient.invalidateQueries({ queryKey: ['owner-stores'] }),
    ])
  }
  const updateOrganization = useMutation({
    mutationFn: () => mutateMeoWorkspaceResource(storeId, 'organizations', 'update', {
      name: organizationDraft.name.trim(), approvalPolicy: organizationDraft.approvalPolicy,
    }, organizationId),
    onSuccess: invalidate,
  })
  const createGroup = useMutation({
    mutationFn: () => mutateMeoWorkspaceResource(storeId, 'groups', 'create', {
      name: groupDraft.name.trim(), description: groupDraft.description.trim() || null,
      parentGroupId: groupDraft.parentGroupId || null, storeIds: groupDraft.storeIds,
    }),
    onSuccess: async () => { setGroupDraft({ name: '', description: '', parentGroupId: '', storeIds: [] }); await invalidate() },
  })
  const archiveGroup = useMutation({ mutationFn: (groupId: string) => mutateMeoWorkspaceResource(storeId, 'groups', 'delete', {}, groupId), onSuccess: invalidate })
  const inviteMember = useMutation({
    mutationFn: () => mutateMeoWorkspaceResource(storeId, 'members', 'create', {
      email: memberDraft.email.trim(), role: memberDraft.role, scope: memberDraft.scope,
    }),
    onSuccess: async (result) => {
      const invitationRow = object(object(result.data).invitation)
      setInvitation(text(invitationRow.token) ? { token: text(invitationRow.token), expiresAt: text(invitationRow.expiresAt ?? invitationRow.expires_at) } : null)
      setMemberDraft({ email: '', role: 'analyst', scope: 'organization' })
      await invalidate()
    },
  })
  const updateMember = useMutation({
    mutationFn: ({ userId, nextRole, scope }: { userId: string; nextRole: string; scope: string }) => mutateMeoWorkspaceResource(storeId, 'members', 'update', { role: nextRole, scope }, userId),
    onSuccess: invalidate,
  })
  const deleteMember = useMutation({ mutationFn: ({ userId, scope }: { userId: string; scope: string }) => mutateMeoWorkspaceResource(storeId, 'members', 'delete', { scope }, userId), onSuccess: invalidate })
  const applyBulk = useMutation({
    mutationFn: async ({ groupId, storeIds, reason }: { groupId: string; storeIds: string[]; reason: string }) => {
      if (role === 'editor') {
        return mutateMeoWorkspaceResource(storeId, 'change_requests', 'create', {
          resource: 'groups', action: 'update', recordId: groupId, payload: { storeIds }, reason: reason.trim() || null,
        })
      }
      return mutateMeoWorkspaceResource(storeId, 'groups', 'update', { storeIds }, groupId)
    },
    onSuccess: async () => { setBulkPlan(null); setCsvPlan(null); await invalidate() },
  })
  const reviewChange = useMutation({
    mutationFn: ({ requestId, decision }: { requestId: string; decision: 'approve' | 'reject' }) => mutateMeoWorkspaceResource(storeId, 'change_requests', decision, { comment: reviewNote.trim() || null }, requestId),
    onSuccess: invalidate,
  })

  const storeRows = storesForDomain(stores.data ?? [], organizationId, groups.data?.items ?? [])
  const selectedGroup = groups.data?.items.find((row) => idOf(row) === targetGroupId)
  const canManageGroups = can(role, 'manage-groups')
  const canManageMembers = can(role, 'manage-members')
  const canReview = can(role, 'review-changes')
  const canProposeBulk = role !== 'analyst'
  const createDryRun = () => {
    setCsvPlan(null)
    setBulkPlan(planBulkChange(storeRows, selectedStores, { field: 'groupId', value: targetGroupId || undefined }))
  }
  const loadCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const parsed = parseStoreCsv(await file.text(), locale)
    setCsvResult(parsed); setCsvPlan(null); setBulkPlan(null)
    if (!parsed.errors.length) {
      const groupIds = [...new Set(parsed.rows.map((row) => row.groupId).filter((value): value is string => Boolean(value)))]
      if (groupIds.length === 1) {
        setTargetGroupId(groupIds[0] ?? '')
        setSelectedStores(parsed.rows.map(({ storeId: id }) => id))
      }
    }
    event.target.value = ''
  }
  const dryRunCsv = () => {
    if (!csvResult || csvResult.errors.length) return
    const groupIds = [...new Set(csvResult.rows.map((row) => row.groupId).filter((value): value is string => Boolean(value)))]
    if (groupIds.length !== 1) return
    const plan = planBulkChange(storeRows, csvResult.rows.map(({ storeId: id }) => id), { field: 'groupId', value: groupIds[0] })
    setCsvPlan(plan); setBulkPlan(null); setTargetGroupId(groupIds[0] ?? '')
  }
  const exportCsv = () => downloadText(exportStoreCsv(storeRows.map((store): StoreCsvRow => ({ storeId: store.id, name: store.name, locationCode: store.locationCode, ...(store.groupId ? { groupId: store.groupId } : {}) }))), `kuchitoru-zero-stores-${today()}.csv`, 'text/csv;charset=utf-8')

  return (
    <>
      <MeoWorkspaceTabs value={tab} onValueChange={setTab} items={[
        { value: 'stores', label: locale === 'ja' ? '店舗・CSV' : 'Stores & CSV', ...(stores.data ? { count: stores.data.length } : {}) },
        { value: 'groups', label: locale === 'ja' ? '組織・グループ' : 'Organization & groups', ...(groups.data ? { count: groups.data.items.length } : {}) },
        { value: 'members', label: locale === 'ja' ? '権限' : 'Permissions', ...(members.data ? { count: members.data.items.length } : {}) },
        { value: 'approvals', label: locale === 'ja' ? '申請・承認' : 'Requests & approvals', ...(changes.data ? { count: changes.data.items.filter((row) => text(row.status) === 'pending').length } : {}) },
        { value: 'ranking', label: locale === 'ja' ? '店舗横断ランキング' : 'Cross-store ranking' }, { value: 'audit', label: locale === 'ja' ? '監査' : 'Audit' },
      ]} />
      {approvalRequired ? <Notice tone="warning">{copy(locale, 'この店舗では二者承認が有効です。Editorの変更は直接反映されません。', 'Two-person approval is enabled for this store. Editor changes are not applied directly.')}</Notice> : null}
      {tab === 'stores' ? <>
        <MeoWorkspaceSection title={copy(locale, '店舗一覧とCSV', 'Stores and CSV')} description={copy(locale, '店舗一覧をCSVで出力し、同じ形式を検証して一括グループ割当のdry-runに使います。', 'Export the store list as CSV, then validate the same format for a bulk group-assignment dry run.')} surface="outlined" actions={<Button type="button" variant="secondary" onClick={exportCsv} disabled={!stores.data?.length}><Download aria-hidden="true" />{copy(locale, 'CSV出力', 'Export CSV')}</Button>}>
          {stores.isPending ? <MeoWorkspaceLoadingState title={copy(locale, '店舗を読み込んでいます', 'Loading stores')} /> : null}
          {stores.isError ? <MeoWorkspaceErrorState title={copy(locale, '店舗一覧を読み込めませんでした', 'Could not load the store list')} description={errorMessage(stores.error, locale)} onRetry={() => void stores.refetch()} /> : null}
          {stores.data ? <MeoWorkspaceDataTable label={copy(locale, '店舗一覧', 'Store list')} rows={stores.data} getRowKey={(row) => row.id} columns={[
            { id: 'select', header: copy(locale, '選択', 'Select'), cell: (row) => <input type="checkbox" aria-label={locale === 'ja' ? `${row.name}を選択` : `Select ${row.name}`} checked={selectedStores.includes(row.id)} disabled={!canProposeBulk} onChange={(event) => setSelectedStores((current) => event.target.checked ? [...current, row.id] : current.filter((id) => id !== row.id))} /> },
            { id: 'name', header: copy(locale, '店舗', 'Store'), cell: (row) => row.name }, { id: 'code', header: copy(locale, 'ロケーションコード', 'Location code'), cell: (row) => row.public_slug }, { id: 'status', header: copy(locale, '状態', 'Status'), cell: (row) => <MeoWorkspaceStatus label={statusLabel(row.status, locale)} tone={row.status === 'published' ? 'success' : 'neutral'} /> },
          ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, '店舗がありません', 'No stores')} />} /> : null}
          <MeoWorkspaceActions>
            <label className="button button--secondary" aria-disabled={!canProposeBulk}><Upload aria-hidden="true" />{copy(locale, 'CSVを読込', 'Import CSV')}<input className="sr-only" type="file" accept="text/csv,.csv" disabled={!canProposeBulk} onChange={(event) => void loadCsv(event)} /></label>
          </MeoWorkspaceActions>
          {csvResult?.errors.length ? <Notice tone="error">{csvResult.errors.map((error) => locale === 'ja' ? `行${error.row}${error.column ? ` ${error.column}` : ''}: ${error.message}` : `Row ${error.row}${error.column ? ` ${error.column}` : ''}: ${error.message}`).join(locale === 'ja' ? ' ／ ' : ' / ')}</Notice> : null}
          {csvResult && !csvResult.errors.length ? <Notice tone="success">{locale === 'ja' ? `CSV ${csvResult.rows.length}件を検証しました。まだ変更は適用していません。` : `Validated ${csvResult.rows.length} CSV rows. No changes have been applied.`}</Notice> : null}
        </MeoWorkspaceSection>
        <MeoWorkspaceSection title={copy(locale, '一括グループ割当', 'Bulk group assignment')} description={copy(locale, '必ずdry-runで差分を確認してから、直接適用または変更申請を行います。', 'Always review changes in a dry run before applying them or submitting a change request.')} surface="outlined">
          <MeoWorkspaceFormGrid columns={2}>
            <label>{copy(locale, '割当先グループ', 'Destination group')}<select value={targetGroupId} onChange={(event) => { setTargetGroupId(event.target.value); setBulkPlan(null); setCsvPlan(null) }} disabled={!canProposeBulk}><option value="">{copy(locale, '選択してください', 'Select a group')}</option>{groups.data?.items.filter((row) => text(row.status, 'active') === 'active').map((row) => <option key={idOf(row)} value={idOf(row)}>{text(row.name)}</option>)}</select></label>
            <label>{copy(locale, '申請理由（任意）', 'Request reason (optional)')}<input value={bulkReason} onChange={(event) => setBulkReason(event.target.value)} disabled={!canProposeBulk} /></label>
          </MeoWorkspaceFormGrid>
          <MeoWorkspaceActions>
            <Button type="button" variant="secondary" disabled={!canProposeBulk || !targetGroupId || !selectedStores.length} onClick={createDryRun}>{copy(locale, '選択店舗をdry-run', 'Dry-run selected stores')}</Button>
            <Button type="button" variant="secondary" disabled={!canProposeBulk || !csvResult || Boolean(csvResult.errors.length)} onClick={dryRunCsv}>{copy(locale, 'CSVをdry-run', 'Dry-run CSV')}</Button>
          </MeoWorkspaceActions>
          {bulkPlan ? <GroupAssignmentPlan plan={bulkPlan} /> : null}{csvPlan ? <GroupAssignmentPlan plan={csvPlan} /> : null}
          {bulkPlan || csvPlan ? <MeoWorkspaceActions><Button type="button" busy={applyBulk.isPending} disabled={!targetGroupId || Boolean((bulkPlan ?? csvPlan)?.summary.errors) || !(bulkPlan ?? csvPlan)?.summary.changes} onClick={() => applyBulk.mutate({ groupId: targetGroupId, storeIds: (bulkPlan ?? csvPlan)?.items.filter(({ status }) => status !== 'error').map(({ storeId: id }) => id) ?? [], reason: bulkReason })}>{role === 'editor' ? copy(locale, '変更申請を作成', 'Create change request') : copy(locale, '確認した変更を適用', 'Apply reviewed changes')}</Button></MeoWorkspaceActions> : null}
          {applyBulk.isError ? <Notice tone="error">{errorMessage(applyBulk.error, locale)}</Notice> : null}{mutationNotice(applyBulk.data, locale === 'ja' ? `${text(selectedGroup?.name, 'グループ')}への一括割当を適用しました。` : `Applied the bulk assignment to ${text(selectedGroup?.name, 'the group')}.`, locale)}
        </MeoWorkspaceSection>
      </> : null}
      {tab === 'groups' ? <>
        <MeoWorkspaceSection title={copy(locale, '組織設定', 'Organization settings')} description={copy(locale, 'Ownerだけが組織名と承認ポリシーを変更できます。', 'Only the Owner can change the organization name and approval policy.')} surface="outlined">
          <MeoWorkspaceFormGrid columns={2}><label>{copy(locale, '組織名', 'Organization name')}<input value={organizationDraft.name} onChange={(event) => setOrganizationDraft((current) => ({ ...current, name: event.target.value }))} disabled={role !== 'owner'} /></label><label>{copy(locale, '承認ポリシー', 'Approval policy')}<select value={organizationDraft.approvalPolicy} onChange={(event) => setOrganizationDraft((current) => ({ ...current, approvalPolicy: event.target.value }))} disabled={role !== 'owner'}><option value="owner_direct">{copy(locale, 'Owner直接反映', 'Owner applies directly')}</option><option value="two_person">{copy(locale, '二者承認', 'Two-person approval')}</option></select></label></MeoWorkspaceFormGrid>
          <MeoWorkspaceActions><Button type="button" busy={updateOrganization.isPending} disabled={role !== 'owner' || !organizationDraft.name.trim()} onClick={() => updateOrganization.mutate()}>{copy(locale, '組織設定を保存', 'Save organization settings')}</Button></MeoWorkspaceActions>
          {updateOrganization.isError ? <Notice tone="error">{errorMessage(updateOrganization.error, locale)}</Notice> : null}{mutationNotice(updateOrganization.data, copy(locale, '組織設定を更新しました。', 'Organization settings updated.'), locale)}
        </MeoWorkspaceSection>
        <MeoWorkspaceSection title={copy(locale, 'グループ', 'Groups')} description={copy(locale, 'Owner/Adminが店舗グループを作成・アーカイブできます。', 'Owners and Admins can create and archive store groups.')} surface="outlined">
          <MeoWorkspaceFormGrid columns={2}><label>{copy(locale, 'グループ名', 'Group name')}<input value={groupDraft.name} onChange={(event) => setGroupDraft((current) => ({ ...current, name: event.target.value }))} disabled={!canManageGroups} /></label><label>{copy(locale, '親グループ', 'Parent group')}<select value={groupDraft.parentGroupId} onChange={(event) => setGroupDraft((current) => ({ ...current, parentGroupId: event.target.value }))} disabled={!canManageGroups}><option value="">{copy(locale, 'なし', 'None')}</option>{groups.data?.items.map((row) => <option key={idOf(row)} value={idOf(row)}>{text(row.name)}</option>)}</select></label><label>{copy(locale, '説明', 'Description')}<textarea value={groupDraft.description} onChange={(event) => setGroupDraft((current) => ({ ...current, description: event.target.value }))} disabled={!canManageGroups} /></label></MeoWorkspaceFormGrid>
          <MeoWorkspaceActions><Button type="button" busy={createGroup.isPending} disabled={!canManageGroups || !groupDraft.name.trim()} onClick={() => createGroup.mutate()}>{copy(locale, 'グループを作成', 'Create group')}</Button></MeoWorkspaceActions>
          {groups.isError ? <MeoWorkspaceErrorState title={copy(locale, 'グループを読み込めませんでした', 'Could not load groups')} description={errorMessage(groups.error, locale)} onRetry={() => void groups.refetch()} /> : null}
          {groups.data ? <MeoWorkspaceDataTable label={copy(locale, 'グループ一覧', 'Group list')} rows={groups.data.items} getRowKey={(row, index) => idOf(row) || String(index)} columns={[
            { id: 'name', header: copy(locale, '名前', 'Name'), cell: (row) => text(row.name) }, { id: 'description', header: copy(locale, '説明', 'Description'), cell: (row) => text(row.description, '—') }, { id: 'status', header: copy(locale, '状態', 'Status'), cell: (row) => statusLabel(text(row.status, 'active'), locale) }, { id: 'action', header: copy(locale, '操作', 'Actions'), cell: (row) => <Button type="button" variant="danger" disabled={!canManageGroups || text(row.status) === 'archived'} onClick={() => archiveGroup.mutate(idOf(row))}>{copy(locale, 'アーカイブ', 'Archive')}</Button> },
          ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, 'グループはまだありません', 'No groups yet')} />} /> : null}
          {createGroup.isError || archiveGroup.isError ? <Notice tone="error">{errorMessage(createGroup.error ?? archiveGroup.error, locale)}</Notice> : null}{mutationNotice(createGroup.data, copy(locale, 'グループを作成しました。', 'Group created.'), locale)}{mutationNotice(archiveGroup.data, copy(locale, 'グループをアーカイブしました。', 'Group archived.'), locale)}
        </MeoWorkspaceSection>
      </> : null}
      {tab === 'members' ? <MeoWorkspaceSection title={copy(locale, 'メンバーと権限', 'Members and permissions')} description={copy(locale, 'Owner/AdminがAdmin・Editor・Analystを組織全体または現在の店舗へ招待します。Ownerは組織の所有者として保護されます。', 'Owners and Admins can invite Admins, Editors, and Analysts to the organization or current store. The Owner is protected as the organization owner.')} surface="outlined">
        <MeoWorkspaceFormGrid columns={3}><label>{copy(locale, 'メールアドレス', 'Email address')}<input type="email" value={memberDraft.email} onChange={(event) => setMemberDraft((current) => ({ ...current, email: event.target.value }))} disabled={!canManageMembers} /></label><label>{copy(locale, '権限', 'Role')}<select value={memberDraft.role} onChange={(event) => setMemberDraft((current) => ({ ...current, role: event.target.value }))} disabled={!canManageMembers}><option value="admin">Admin</option><option value="editor">Editor</option><option value="analyst">Analyst</option></select></label><label>{copy(locale, '範囲', 'Scope')}<select value={memberDraft.scope} onChange={(event) => setMemberDraft((current) => ({ ...current, scope: event.target.value }))} disabled={!canManageMembers}><option value="organization">{copy(locale, '組織全体', 'Entire organization')}</option><option value="store">{copy(locale, '現在の店舗', 'Current store')}</option></select></label></MeoWorkspaceFormGrid>
        <MeoWorkspaceActions><Button type="button" busy={inviteMember.isPending} disabled={!canManageMembers || !memberDraft.email.trim()} onClick={() => inviteMember.mutate()}>{copy(locale, '招待を作成', 'Create invitation')}</Button></MeoWorkspaceActions>
        {members.isError ? <MeoWorkspaceErrorState title={copy(locale, 'メンバーを読み込めませんでした', 'Could not load members')} description={errorMessage(members.error, locale)} onRetry={() => void members.refetch()} /> : null}
        {members.data ? <MeoWorkspaceDataTable label={copy(locale, 'メンバー一覧', 'Member list')} rows={members.data.items} getRowKey={(row, index) => idOf(row) || String(index)} columns={[
          { id: 'user', header: copy(locale, 'ユーザー', 'User'), cell: (row) => text(row.email ?? row.user_id ?? row.userId) }, { id: 'role', header: copy(locale, '権限', 'Role'), cell: (row) => text(row.role) }, { id: 'scope', header: copy(locale, '範囲', 'Scope'), cell: (row) => text(row.scope, 'organization') }, { id: 'status', header: copy(locale, '状態', 'Status'), cell: (row) => statusLabel(text(row.status, 'active'), locale) },
          { id: 'action', header: copy(locale, '操作', 'Actions'), cell: (row) => text(row.role) === 'owner' ? copy(locale, 'Ownerは保護されています', 'The Owner is protected') : <MeoWorkspaceActions><select aria-label={locale === 'ja' ? `${text(row.email ?? row.user_id)}の権限` : `Role for ${text(row.email ?? row.user_id)}`} defaultValue={text(row.role)} disabled={!canManageMembers} onChange={(event) => updateMember.mutate({ userId: idOf(row), nextRole: event.target.value, scope: text(row.scope, 'organization') })}><option value="admin">Admin</option><option value="editor">Editor</option><option value="analyst">Analyst</option></select><Button type="button" variant="danger" disabled={!canManageMembers} onClick={() => deleteMember.mutate({ userId: idOf(row), scope: text(row.scope, 'organization') })}>{copy(locale, '削除', 'Delete')}</Button></MeoWorkspaceActions> },
        ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, 'メンバーはまだいません', 'No members yet')} />} /> : null}
        {inviteMember.isError || updateMember.isError || deleteMember.isError ? <Notice tone="error">{errorMessage(inviteMember.error ?? updateMember.error ?? deleteMember.error, locale)}</Notice> : null}{mutationNotice(inviteMember.data, copy(locale, '招待を作成しました。招待トークンはこの画面で一度だけ表示します。', 'Invitation created. The invitation token is shown only once on this screen.'), locale)}
        {invitation ? <Notice tone="warning"><strong>{copy(locale, '一度だけ表示される招待情報', 'One-time invitation details')}</strong><br />{copy(locale, '受諾URL', 'Acceptance URL')}: <code>{`${window.location.origin}/dashboard/invitations/accept?token=${invitation.token}`}</code><br />{copy(locale, 'トークン', 'Token')}: <code>{invitation.token}</code><br />{copy(locale, '有効期限', 'Expires')}: {formatDate(invitation.expiresAt, locale)}{copy(locale, '。', '. ')}{copy(locale, '安全な経路で対象者へ共有し、画面を離れる前に控えてください。', 'Share it through a secure channel and save it before leaving this screen.')}</Notice> : null}
      </MeoWorkspaceSection> : null}
      {tab === 'approvals' ? <MeoWorkspaceSection title={copy(locale, '変更申請と承認', 'Change requests and approvals')} description={copy(locale, '申請者本人の承認はサーバー側でも拒否されます。承認時に対象操作を一度だけ適用します。', 'The server prevents requesters from approving their own requests. Approval applies the operation exactly once.')} surface="outlined">
        <label>{copy(locale, '承認・却下コメント', 'Approval or rejection comment')}<input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} disabled={!canReview} /></label>
        {changes.isError ? <MeoWorkspaceErrorState title={copy(locale, '変更申請を読み込めませんでした', 'Could not load change requests')} description={errorMessage(changes.error, locale)} onRetry={() => void changes.refetch()} /> : null}
        {changes.data ? <MeoWorkspaceDataTable label={copy(locale, '変更申請一覧', 'Change request list')} rows={changes.data.items} getRowKey={(row, index) => idOf(row) || String(index)} columns={[
          { id: 'date', header: copy(locale, '申請日', 'Requested at'), cell: (row) => formatDate(row.created_at, locale) }, { id: 'resource', header: copy(locale, '対象', 'Target'), cell: (row) => `${text(row.resource)} / ${text(row.action)}` }, { id: 'reason', header: copy(locale, '申請理由', 'Request reason'), cell: (row) => text(row.request_reason ?? row.requestReason, '—') }, { id: 'payload', header: copy(locale, '変更内容', 'Changes'), cell: (row) => <pre className="meo-workspace-json-preview">{JSON.stringify(object(row.payload), null, 2)}</pre> }, { id: 'status', header: copy(locale, '状態', 'Status'), cell: (row) => <MeoWorkspaceStatus label={statusLabel(text(row.status), locale)} tone={text(row.status) === 'pending' ? 'warning' : text(row.status) === 'applied' ? 'success' : 'neutral'} /> },
          { id: 'action', header: copy(locale, '操作', 'Actions'), cell: (row) => text(row.status) === 'pending' ? <MeoWorkspaceActions><Button type="button" disabled={!canReview} busy={reviewChange.isPending} onClick={() => reviewChange.mutate({ requestId: idOf(row), decision: 'approve' })}>{copy(locale, '承認して適用', 'Approve and apply')}</Button><Button type="button" variant="danger" disabled={!canReview} onClick={() => reviewChange.mutate({ requestId: idOf(row), decision: 'reject' })}>{copy(locale, '却下', 'Reject')}</Button></MeoWorkspaceActions> : copy(locale, '完了', 'Complete') },
        ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, '変更申請はありません', 'No change requests')} />} /> : null}
        {reviewChange.isError ? <Notice tone="error">{errorMessage(reviewChange.error, locale)}</Notice> : null}{mutationNotice(reviewChange.data, copy(locale, '申請を処理しました。', 'Request processed.'), locale)}
      </MeoWorkspaceSection> : null}
      {tab === 'ranking' ? <MeoWorkspaceSection title={copy(locale, '店舗横断ランキング', 'Cross-store ranking')} description={copy(locale, '各店舗に保存された直近のGBPインサイトを比較します。未取得データは0にせず「データなし」と表示します。', 'Compare the latest stored GBP insights across stores. Missing data is shown as unavailable rather than zero.')} surface="outlined">
        <label>{copy(locale, '比較指標', 'Metric')}<select value={rankingMetric} onChange={(event) => setRankingMetric(event.target.value)}><option value="views">{copy(locale, '閲覧', 'Views')}</option><option value="searches">{copy(locale, '検索', 'Searches')}</option><option value="websiteClicks">{copy(locale, 'Webサイトクリック', 'Website clicks')}</option><option value="calls">{copy(locale, '通話', 'Calls')}</option><option value="directionRequests">{copy(locale, 'ルート検索', 'Direction requests')}</option></select></label>
        {rankings.isPending ? <MeoWorkspaceLoadingState title={copy(locale, '店舗横断データを集計しています', 'Aggregating cross-store data')} /> : null}
        {rankings.isError ? <MeoWorkspaceErrorState title={copy(locale, '店舗横断ランキングを作成できませんでした', 'Could not create the cross-store ranking')} description={errorMessage(rankings.error, locale)} onRetry={() => void rankings.refetch()} /> : null}
        {rankings.data ? <MeoWorkspaceDataTable label={copy(locale, '店舗横断ランキング', 'Cross-store ranking')} rows={rankings.data} getRowKey={(row) => row.storeId} columns={[
          { id: 'rank', header: copy(locale, '順位', 'Rank'), cell: (row) => row.rank ? locale === 'ja' ? `${row.rank}位` : `#${row.rank}` : '—' }, { id: 'store', header: copy(locale, '店舗', 'Store'), cell: (row) => row.name }, { id: 'value', header: copy(locale, '値', 'Value'), cell: (row) => row.value ?? copy(locale, 'データなし', 'No data') }, { id: 'state', header: copy(locale, '取得状態', 'Retrieval status'), cell: (row) => <MeoWorkspaceStatus label={row.error ? copy(locale, '取得失敗', 'Retrieval failed') : row.value === null ? copy(locale, '未入力', 'Not entered') : copy(locale, '取得済み', 'Retrieved')} tone={row.error ? 'error' : row.value === null ? 'neutral' : 'success'} /> },
        ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, '比較できる店舗がありません', 'No stores to compare')} />} /> : null}
      </MeoWorkspaceSection> : null}
      {tab === 'audit' ? <MeoWorkspaceSection title={copy(locale, '監査ログ', 'Audit log')} description={copy(locale, '組織・店舗に対する変更と承認のサーバー記録です。', 'Server records of organization and store changes and approvals.')} surface="outlined">
        {audit.isPending ? <MeoWorkspaceLoadingState title={copy(locale, '監査ログを読み込んでいます', 'Loading the audit log')} /> : null}
        {audit.isError ? <MeoWorkspaceErrorState title={copy(locale, '監査ログを読み込めませんでした', 'Could not load the audit log')} description={copy(locale, '監査resourceが未公開の場合は変更申請履歴で確認してください。', 'If the audit resource is unavailable, check the change-request history.')} onRetry={() => void audit.refetch()} /> : null}
        {audit.data ? <MeoWorkspaceDataTable label={copy(locale, '監査ログ', 'Audit log')} rows={audit.data.items} getRowKey={(row, index) => idOf(row) || String(index)} columns={[
          { id: 'date', header: copy(locale, '日時', 'Date and time'), cell: (row) => formatDate(row.created_at, locale) }, { id: 'actor', header: copy(locale, '実行者', 'Actor'), cell: (row) => text(row.actor_id, copy(locale, 'システム', 'System')) }, { id: 'action', header: copy(locale, '操作', 'Actions'), cell: (row) => text(row.action) }, { id: 'resource', header: copy(locale, '対象', 'Target'), cell: (row) => text(row.resource) }, { id: 'metadata', header: copy(locale, '安全な記録', 'Safe record'), cell: (row) => JSON.stringify(row.safe_metadata ?? {}) },
        ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, '監査記録はまだありません', 'No audit records yet')} />} /> : null}
      </MeoWorkspaceSection> : null}
    </>
  )
}

export function MultiStoreWorkspacePage() {
  const { locale } = useI18n()
  return (
    <MeoWorkspacePageFrame title={locale === 'ja' ? '多店舗・権限' : 'Multi-store & permissions'} description={locale === 'ja' ? '店舗グループ、CSV、一括変更、権限、承認、店舗横断比較を管理します。' : 'Manage store groups, CSV, bulk changes, permissions, approvals, and cross-store comparisons.'}>
      {({ storeId, authorization, query, role }) => (
        <MultiStoreContent
          storeId={storeId}
          organizationId={authorization?.organizationId ?? ''}
          role={role}
          approvalRequired={authorization?.approvalRequired ?? false}
          organization={object(query.data?.organization)}
        />
      )}
    </MeoWorkspacePageFrame>
  )
}

export const MultistoreWorkspacePage = MultiStoreWorkspacePage

type AioTab = 'diagnosis' | 'citations' | 'jsonld' | 'gpt'

type NapDraft = { name: string; address: string; phone: string; url: string }
type CitationDraft = {
  id: string
  source: CitationSource
  label: string
  listingUrl: string
  name: string
  address: string
  phone: string
  websiteUrl: string
  checkedAt: string
  notes: string
  missing: boolean
}

const sourceOptions: ReadonlyArray<{ value: CitationSource; label: string; labelEn: string; sourceType: 'map' | 'directory' | 'other' }> = [
  { value: 'google-business-profile', label: 'Google Business Profile', labelEn: 'Google Business Profile', sourceType: 'map' },
  { value: 'apple-business-connect', label: 'Apple Business Connect', labelEn: 'Apple Business Connect', sourceType: 'map' },
  { value: 'yahoo-line-place', label: 'Yahoo!プレイス / LINE PLACE', labelEn: 'Yahoo! JAPAN / LINE PLACE', sourceType: 'directory' },
  { value: 'bing-places', label: 'Bing Places', labelEn: 'Bing Places', sourceType: 'map' },
  { value: 'major-directory', label: '主要ディレクトリ', labelEn: 'Major directory', sourceType: 'directory' },
  { value: 'other', label: 'その他', labelEn: 'Other', sourceType: 'other' },
]

const sourceOptionLabel = (source: (typeof sourceOptions)[number], locale: Locale) => locale === 'ja' ? source.label : source.labelEn

const emptyCitation = (): CitationDraft => ({
  id: '', source: 'apple-business-connect', label: 'Apple Business Connect', listingUrl: '',
  name: '', address: '', phone: '', websiteUrl: '', checkedAt: nowIso().slice(0, 16), notes: '', missing: false,
})

function sourceFromLabel(label: string): CitationSource {
  const lower = label.toLowerCase()
  if (lower.includes('google')) return 'google-business-profile'
  if (lower.includes('apple')) return 'apple-business-connect'
  if (lower.includes('yahoo') || lower.includes('line')) return 'yahoo-line-place'
  if (lower.includes('bing')) return 'bing-places'
  if (lower.includes('directory') || lower.includes('ディレクトリ')) return 'major-directory'
  return 'other'
}

function citationFromRow(row: JsonObject, locale: Locale): ListingCitation {
  const nap = object(row.nap_snapshot ?? row.napSnapshot)
  const sourceLabel = text(row.source_name ?? row.sourceName ?? row.directory, copy(locale, 'その他', 'Other'))
  const listingUrl = text(row.url ?? row.listing_url ?? row.listingUrl)
  const note = text(row.notes)
  return {
    id: idOf(row),
    source: sourceFromLabel(sourceLabel),
    sourceLabel,
    ...(listingUrl ? { listingUrl } : {}),
    observedAt: text(row.last_checked_at ?? row.checkedAt ?? row.created_at, nowIso()),
    nap: canonicalizeNap({
      name: text(nap.business_name ?? nap.businessName ?? row.businessName),
      address: text(nap.address ?? row.address),
      phone: text(nap.phone ?? row.phone),
      url: text(nap.website_url ?? nap.websiteUrl ?? row.websiteUrl),
    }),
    evidenceIds: [],
    ...(note ? { note } : {}),
  }
}

function citationStatus(base: NapDraft, draft: CitationDraft): 'consistent' | 'inconsistent' | 'missing' {
  if (draft.missing) return 'missing'
  const canonical = canonicalizeNap(base)
  const listing = canonicalizeNap({ name: draft.name, address: draft.address, phone: draft.phone, url: draft.websiteUrl })
  const fields = ['name', 'address', 'phone', 'url'] as const
  return fields.every((field) => canonical[field].valid && listing[field].valid && canonical[field].canonical === listing[field].canonical)
    ? 'consistent'
    : 'inconsistent'
}

function profileNap(profile: JsonObject): NapDraft {
  const phones = object(profile.phoneNumbers ?? profile.phone_numbers)
  const addressObject = object(profile.address)
  const addressLines = array(addressObject.addressLines ?? addressObject.address_lines).map(String).join(' ')
  const address = [text(addressObject.postalCode ?? addressObject.postal_code), text(addressObject.administrativeArea ?? addressObject.administrative_area), text(addressObject.locality), addressLines].filter(Boolean).join(' ')
  return {
    name: text(profile.businessName ?? profile.business_name ?? profile.name),
    address: address || text(profile.address),
    phone: text(phones.primaryPhone ?? phones.primary_phone ?? profile.phone),
    url: text(profile.websiteUri ?? profile.website_uri ?? profile.website_url),
  }
}

function AioContent({ storeId, role, profile }: { storeId: string; role: Role; profile: JsonObject }) {
  const { locale } = useI18n()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<AioTab>('diagnosis')
  const [base, setBase] = useState<NapDraft>(() => profileNap(profile))
  const [draft, setDraft] = useState<CitationDraft>(emptyCitation)
  const [jsonLdDraft, setJsonLdDraft] = useState({
    type: 'LocalBusiness', description: text(profile.description), image: '', priceRange: '',
    streetAddress: profileNap(profile).address, locality: '', region: '', postalCode: '', sameAs: '',
  })
  const [gptImportMessage, setGptImportMessage] = useState('')
  const [gptImportError, setGptImportError] = useState('')
  const [gptSuggestions, setGptSuggestions] = useState<readonly GptSuggestion[]>([])
  const [deleteConfirmedId, setDeleteConfirmedId] = useState('')
  const editable = role !== 'analyst'

  const citations = useQuery({
    queryKey: ['meo-workspace', storeId, 'aio_citations'],
    queryFn: ({ signal }) => listMeoWorkspaceResource<JsonObject>(storeId, 'aio_citations', { limit: 100, signal }),
    retry: false,
  })
  const jsonLdHistory = useQuery({
    queryKey: ['meo-workspace', storeId, 'jsonld'],
    queryFn: ({ signal }) => listMeoWorkspaceResource<JsonObject>(storeId, 'jsonld', { limit: 50, signal }),
    retry: false,
  })
  const mappedCitations = useMemo(() => (citations.data?.items ?? []).map((row) => citationFromRow(row, locale)), [citations.data?.items, locale])
  const canonical = useMemo(() => canonicalizeNap(base), [base])
  const diagnostics = useMemo(() => diagnoseAioReadiness(canonical, mappedCitations, new Date(), locale), [canonical, locale, mappedCitations])
  const jsonLdPreview = useMemo(() => buildLocalBusinessJsonLd({
    nap: canonical,
    schemaType: jsonLdDraft.type,
    description: jsonLdDraft.description,
    imageUrl: jsonLdDraft.image,
    priceRange: jsonLdDraft.priceRange,
  }, nowIso()), [canonical, jsonLdDraft])

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['meo-workspace', storeId, 'aio_citations'] }),
      queryClient.invalidateQueries({ queryKey: ['meo-workspace', storeId, 'jsonld'] }),
      queryClient.invalidateQueries({ queryKey: ['meo-workspace', storeId] }),
    ])
  }
  const saveCitation = useMutation({
    mutationFn: () => {
      const selectedSource = sourceOptions.find(({ value }) => value === draft.source)
      return mutateMeoWorkspaceResource(storeId, 'aio_citations', draft.id ? 'update' : 'create', {
        directory: draft.label.trim() || (selectedSource ? sourceOptionLabel(selectedSource, locale) : copy(locale, 'その他', 'Other')),
        sourceType: selectedSource?.sourceType ?? 'other',
        listingUrl: draft.listingUrl.trim() || null,
        businessName: draft.missing ? null : draft.name.trim() || null,
        address: draft.missing ? null : draft.address.trim() || null,
        phone: draft.missing ? null : draft.phone.trim() || null,
        websiteUrl: draft.missing ? null : draft.websiteUrl.trim() || null,
        status: citationStatus(base, draft),
        checkedAt: draft.checkedAt ? new Date(draft.checkedAt).toISOString() : null,
        notes: draft.notes.trim() || null,
      }, draft.id || null)
    },
    onSuccess: async () => { setDraft(emptyCitation()); await invalidate() },
  })
  const deleteCitation = useMutation({
    mutationFn: (citationId: string) => mutateMeoWorkspaceResource(storeId, 'aio_citations', 'delete', {}, citationId),
    onSuccess: async () => { setDeleteConfirmedId(''); await invalidate() },
  })
  const saveJsonLd = useMutation({
    mutationFn: () => mutateMeoWorkspaceResource(storeId, 'jsonld', 'save', {
      type: jsonLdDraft.type,
      name: base.name.trim(),
      url: base.url.trim() || null,
      image: jsonLdDraft.image.trim() || null,
      telephone: base.phone.trim() || null,
      priceRange: jsonLdDraft.priceRange.trim() || null,
      address: {
        streetAddress: jsonLdDraft.streetAddress.trim() || null,
        addressLocality: jsonLdDraft.locality.trim() || null,
        addressRegion: jsonLdDraft.region.trim() || null,
        postalCode: jsonLdDraft.postalCode.trim() || null,
        addressCountry: 'JP',
      },
      sameAs: jsonLdDraft.sameAs.split(/[\n,]/).map((value) => value.trim()).filter(Boolean),
    }),
    onSuccess: invalidate,
  })
  const exportGpt = () => {
    const envelope = createGptAnalysisEnvelope({ exportedAt: nowIso(), canonicalNap: canonical, citations: mappedCitations })
    downloadText(exportGptAnalysisEnvelope(envelope), `kuchitoru-zero-aio-gpt-${today()}.json`)
  }
  const importGpt = async (event: ChangeEvent<HTMLInputElement>) => {
    setGptImportError(''); setGptImportMessage(''); setGptSuggestions([])
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const content = await file.text()
      const raw: unknown = JSON.parse(content)
      const row = object(raw)
      const envelope = row.envelope
        ? importGptAnalysisEnvelope(JSON.stringify(row.envelope))
        : importGptAnalysisEnvelope(content)
      const rawSuggestions = array(row.suggestions)
      const suggestions = rawSuggestions.filter((item): item is GptSuggestion => {
        const suggestion = object(item)
        return typeof suggestion.id === 'string' && typeof suggestion.citationId === 'string' && ['name', 'address', 'phone', 'url'].includes(text(suggestion.field)) && typeof suggestion.proposedValue === 'string' && typeof suggestion.rationale === 'string'
      })
      const accepted = reconcileGptSuggestions(envelope, suggestions)
      setGptSuggestions(accepted)
      setGptImportMessage(rawSuggestions.length
        ? (locale === 'ja' ? `${rawSuggestions.length}件中${accepted.length}件の提案を検証しました。自動適用していません。` : `Validated ${accepted.length} of ${rawSuggestions.length} suggestions. None were applied automatically.`)
        : (locale === 'ja' ? `GPT連携JSONを検証しました（引用台帳 ${envelope.citations.length}件）。変更はありません。` : `Validated GPT integration JSON (${envelope.citations.length} ledger entries). Nothing changed.`))
    } catch (error) { setGptImportError(errorMessage(error, locale)) }
    event.target.value = ''
  }
  const editCitation = (row: JsonObject) => {
    const nap = object(row.nap_snapshot ?? row.napSnapshot)
    const sourceLabel = text(row.source_name ?? row.sourceName)
    setDraft({
      id: idOf(row), source: sourceFromLabel(sourceLabel), label: sourceLabel,
      listingUrl: text(row.url), name: text(nap.business_name ?? nap.businessName), address: text(nap.address), phone: text(nap.phone),
      websiteUrl: text(nap.website_url ?? nap.websiteUrl), checkedAt: text(row.last_checked_at).slice(0, 16), notes: text(row.notes),
      missing: text(row.consistency_status) === 'missing',
    })
  }

  return (
    <>
      <MeoWorkspaceTabs value={tab} onValueChange={setTab} items={[
        { value: 'diagnosis', label: locale === 'ja' ? 'NAP診断' : 'NAP diagnosis' }, { value: 'citations', label: locale === 'ja' ? 'サイテーション台帳' : 'Citation ledger', ...(citations.data ? { count: citations.data.items.length } : {}) },
        { value: 'jsonld', label: 'JSON-LD', ...(jsonLdHistory.data ? { count: jsonLdHistory.data.items.length } : {}) }, { value: 'gpt', label: locale === 'ja' ? '外部GPT連携' : 'External GPT integration' },
      ]} />
      <Notice tone="info">{copy(locale, '手動診断です。自動クロール、順位保証、AI回答への掲載保証、エージェント実行は行いません。', 'This is a manual diagnostic. It does not crawl automatically, guarantee rankings or inclusion in AI answers, or run agents.')}</Notice>
      <MeoWorkspaceSection title={copy(locale, '店舗の基準NAP', 'Canonical store NAP')} description={copy(locale, '診断の比較元です。この画面での変更は診断中だけ保持され、GBPプロフィールを変更しません。', 'This is the diagnostic baseline. Changes here last only for this session and do not modify the GBP profile.')} surface="outlined">
        <MeoWorkspaceFormGrid columns={2}>
          <label>{copy(locale, '正式な店舗名', 'Official store name')}<input value={base.name} onChange={(event) => setBase((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>{copy(locale, '住所', 'Address')}<input value={base.address} onChange={(event) => setBase((current) => ({ ...current, address: event.target.value }))} /></label>
          <label>{copy(locale, '電話番号', 'Phone number')}<input value={base.phone} onChange={(event) => setBase((current) => ({ ...current, phone: event.target.value }))} /></label>
          <label>{copy(locale, '正規Webサイト', 'Canonical website')}<input type="url" value={base.url} onChange={(event) => setBase((current) => ({ ...current, url: event.target.value }))} /></label>
        </MeoWorkspaceFormGrid>
      </MeoWorkspaceSection>
      {tab === 'diagnosis' ? <MeoWorkspaceSection title={copy(locale, 'AIO・サイテーション診断', 'AIO and citation diagnosis')} description={diagnostics.disclaimer} surface="outlined">
        <MeoWorkspaceFormGrid columns={3}>
          <MeoWorkspaceStatus label={locale === 'ja' ? `${diagnostics.score}点` : `${diagnostics.score} points`} detail={copy(locale, '総合準備スコア', 'Overall readiness score')} tone={diagnostics.score >= 80 ? 'success' : diagnostics.score >= 50 ? 'warning' : 'error'} />
          <MeoWorkspaceStatus label={locale === 'ja' ? `${diagnostics.completenessScore}点` : `${diagnostics.completenessScore} points`} detail={copy(locale, 'NAP整合性', 'NAP consistency')} />
          <MeoWorkspaceStatus label={locale === 'ja' ? `${diagnostics.sourceScore}点` : `${diagnostics.sourceScore} points`} detail={copy(locale, '掲載元の広がり', 'Source coverage')} />
          <MeoWorkspaceStatus label={locale === 'ja' ? `${diagnostics.recencyScore}点` : `${diagnostics.recencyScore} points`} detail={copy(locale, '確認日の新しさ', 'Observation recency')} />
        </MeoWorkspaceFormGrid>
        <MeoWorkspaceDataTable label={copy(locale, '診断チェックリスト', 'Diagnostic checklist')} rows={diagnostics.checklist.map((item, index) => ({ id: String(index), item }))} getRowKey={(row) => row.id} columns={[{ id: 'item', header: copy(locale, '改善候補', 'Suggested improvement'), cell: (row) => row.item }]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, '確認項目はありません', 'No checks needed')} description={copy(locale, '定期的に各掲載先を手動確認してください。', 'Manually review each listing periodically.')} />} />
      </MeoWorkspaceSection> : null}
      {tab === 'citations' ? <>
        <MeoWorkspaceSection title={draft.id ? copy(locale, '掲載記録を編集', 'Edit listing record') : copy(locale, '掲載先を手動記録', 'Manually record listing')} description={copy(locale, 'Apple、Yahoo!/LINE、Bing等で目視確認した情報だけを記録します。', 'Record only information you manually verified on Apple, Yahoo!/LINE, Bing, or another source.')} surface="outlined">
          <MeoWorkspaceFormGrid columns={2}>
            <label>{copy(locale, '掲載先', 'Listing source')}<select value={draft.source} onChange={(event) => { const source = event.target.value as CitationSource; const selected = sourceOptions.find(({ value }) => value === source); setDraft((current) => ({ ...current, source, label: selected ? sourceOptionLabel(selected, locale) : current.label })) }} disabled={!editable}>{sourceOptions.map((source) => <option key={source.value} value={source.value}>{sourceOptionLabel(source, locale)}</option>)}</select></label>
            <label>{copy(locale, '掲載先名', 'Listing source name')}<input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} disabled={!editable} /></label>
            <label>{copy(locale, '掲載URL（HTTPS）', 'Listing URL (HTTPS)')}<input type="url" value={draft.listingUrl} onChange={(event) => setDraft((current) => ({ ...current, listingUrl: event.target.value }))} disabled={!editable} /></label>
            <label>{copy(locale, '確認日時', 'Observed at')}<input type="datetime-local" value={draft.checkedAt} onChange={(event) => setDraft((current) => ({ ...current, checkedAt: event.target.value }))} disabled={!editable} /></label>
            <label>{copy(locale, '掲載されている店舗名', 'Listed store name')}<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} disabled={!editable || draft.missing} /></label>
            <label>{copy(locale, '掲載されている住所', 'Listed address')}<input value={draft.address} onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))} disabled={!editable || draft.missing} /></label>
            <label>{copy(locale, '掲載されている電話', 'Listed phone')}<input value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} disabled={!editable || draft.missing} /></label>
            <label>{copy(locale, '掲載されているWebサイト', 'Listed website')}<input type="url" value={draft.websiteUrl} onChange={(event) => setDraft((current) => ({ ...current, websiteUrl: event.target.value }))} disabled={!editable || draft.missing} /></label>
          </MeoWorkspaceFormGrid>
          <label><input type="checkbox" checked={draft.missing} onChange={(event) => setDraft((current) => ({ ...current, missing: event.target.checked }))} disabled={!editable} /> {copy(locale, 'この掲載先に店舗情報が見つからない', 'Store information was not found on this source')}</label>
          <label>{copy(locale, '確認証跡・メモ', 'Verification evidence and notes')}<textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} disabled={!editable} /></label>
          <MeoWorkspaceStatus label={draft.missing ? copy(locale, '未掲載', 'Not listed') : citationStatus(base, draft) === 'consistent' ? copy(locale, 'NAP一致', 'NAP matches') : copy(locale, 'NAP不一致', 'NAP mismatch')} detail={copy(locale, '入力値を正規化した決定論的判定', 'Deterministic result after normalizing input')} tone={draft.missing ? 'warning' : citationStatus(base, draft) === 'consistent' ? 'success' : 'error'} />
          <MeoWorkspaceActions><Button type="button" busy={saveCitation.isPending} disabled={!editable || !draft.label.trim()} onClick={() => saveCitation.mutate()}>{draft.id ? copy(locale, '掲載記録を更新', 'Update listing record') : copy(locale, '掲載記録を追加', 'Add listing record')}</Button>{draft.id ? <Button type="button" variant="quiet" onClick={() => setDraft(emptyCitation())}>{copy(locale, '編集をやめる', 'Stop editing')}</Button> : null}</MeoWorkspaceActions>
          {saveCitation.isError ? <Notice tone="error">{errorMessage(saveCitation.error, locale)}</Notice> : null}{mutationNotice(saveCitation.data, copy(locale, 'サイテーション台帳へ保存しました。', 'Saved to the citation ledger.'), locale)}
        </MeoWorkspaceSection>
        {citations.isPending ? <MeoWorkspaceLoadingState title={copy(locale, '台帳を読み込んでいます', 'Loading the ledger')} /> : null}
        {citations.isError ? <MeoWorkspaceErrorState title={copy(locale, 'サイテーション台帳を読み込めませんでした', 'Could not load the citation ledger')} description={errorMessage(citations.error, locale)} onRetry={() => void citations.refetch()} /> : null}
        {citations.data ? <MeoWorkspaceDataTable label={copy(locale, 'サイテーション台帳', 'Citation ledger')} rows={citations.data.items} getRowKey={(row, index) => idOf(row) || String(index)} columns={[
          { id: 'source', header: copy(locale, '掲載先', 'Listing source'), cell: (row) => text(row.source_name ?? row.sourceName) }, { id: 'status', header: copy(locale, '整合性', 'Consistency'), cell: (row) => <MeoWorkspaceStatus label={statusLabel(text(row.consistency_status), locale)} tone={text(row.consistency_status) === 'consistent' ? 'success' : text(row.consistency_status) === 'unchecked' ? 'neutral' : 'warning'} /> },
          { id: 'checked', header: copy(locale, '確認日', 'Observed at'), cell: (row) => formatDate(row.last_checked_at, locale) }, { id: 'url', header: 'URL', cell: (row) => text(row.url) ? <a href={text(row.url)} target="_blank" rel="noreferrer">{copy(locale, '開く', 'Open')}</a> : '—' },
          { id: 'action', header: copy(locale, '操作', 'Actions'), cell: (row) => <MeoWorkspaceActions><Button type="button" variant="secondary" onClick={() => editCitation(row)}>{copy(locale, '編集', 'Edit')}</Button>{deleteConfirmedId === idOf(row) ? <><Button type="button" variant="danger" disabled={!editable} busy={deleteCitation.isPending} onClick={() => deleteCitation.mutate(idOf(row))}>{copy(locale, '削除を確定', 'Confirm deletion')}</Button><Button type="button" variant="quiet" onClick={() => setDeleteConfirmedId('')}>{copy(locale, '取消', 'Cancel')}</Button></> : <Button type="button" variant="danger" disabled={!editable} onClick={() => setDeleteConfirmedId(idOf(row))}>{copy(locale, '削除', 'Delete')}</Button>}</MeoWorkspaceActions> },
        ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, '掲載記録はまだありません', 'No listing records yet')} />} /> : null}
        {deleteCitation.isError ? <Notice tone="error">{errorMessage(deleteCitation.error, locale)}</Notice> : null}{mutationNotice(deleteCitation.data, copy(locale, '掲載記録を削除しました。', 'Listing record deleted.'), locale)}
      </> : null}
      {tab === 'jsonld' ? <>
        <MeoWorkspaceSection title={copy(locale, 'LocalBusiness JSON-LD', 'LocalBusiness JSON-LD')} description={copy(locale, '構造化データを生成・保存・出力します。Webサイトへの自動設置は行いません。', 'Generate, save, and export structured data. It is not automatically installed on your website.')} surface="outlined">
          <MeoWorkspaceFormGrid columns={2}>
            <label>Schema type<select value={jsonLdDraft.type} onChange={(event) => setJsonLdDraft((current) => ({ ...current, type: event.target.value }))} disabled={!editable}><option value="LocalBusiness">LocalBusiness</option><option value="Restaurant">Restaurant</option><option value="Store">Store</option><option value="ProfessionalService">ProfessionalService</option><option value="HealthAndBeautyBusiness">HealthAndBeautyBusiness</option></select></label>
            <label>{copy(locale, '画像URL', 'Image URL')}<input type="url" value={jsonLdDraft.image} onChange={(event) => setJsonLdDraft((current) => ({ ...current, image: event.target.value }))} disabled={!editable} /></label>
            <label>{copy(locale, '価格帯', 'Price range')}<input value={jsonLdDraft.priceRange} onChange={(event) => setJsonLdDraft((current) => ({ ...current, priceRange: event.target.value }))} disabled={!editable} placeholder="¥¥" /></label>
            <label>{copy(locale, '都道府県', 'Prefecture')}<input value={jsonLdDraft.region} onChange={(event) => setJsonLdDraft((current) => ({ ...current, region: event.target.value }))} disabled={!editable} /></label>
            <label>{copy(locale, '市区町村', 'City')}<input value={jsonLdDraft.locality} onChange={(event) => setJsonLdDraft((current) => ({ ...current, locality: event.target.value }))} disabled={!editable} /></label>
            <label>{copy(locale, '郵便番号', 'Postal code')}<input value={jsonLdDraft.postalCode} onChange={(event) => setJsonLdDraft((current) => ({ ...current, postalCode: event.target.value }))} disabled={!editable} /></label>
          </MeoWorkspaceFormGrid>
          <label>{copy(locale, '住所', 'Address')}<input value={jsonLdDraft.streetAddress} onChange={(event) => setJsonLdDraft((current) => ({ ...current, streetAddress: event.target.value }))} disabled={!editable} /></label>
          <label>{copy(locale, '説明', 'Description')}<textarea value={jsonLdDraft.description} onChange={(event) => setJsonLdDraft((current) => ({ ...current, description: event.target.value }))} disabled={!editable} /></label>
          <label>{copy(locale, 'sameAs URL（カンマまたは改行区切り）', 'sameAs URLs (comma or newline separated)')}<textarea value={jsonLdDraft.sameAs} onChange={(event) => setJsonLdDraft((current) => ({ ...current, sameAs: event.target.value }))} disabled={!editable} /></label>
          <pre>{JSON.stringify(jsonLdPreview.jsonLd, null, 2)}</pre>
          <MeoWorkspaceActions><Button type="button" busy={saveJsonLd.isPending} disabled={!editable || !base.name.trim()} onClick={() => saveJsonLd.mutate()}>{copy(locale, 'JSON-LDを保存', 'Save JSON-LD')}</Button><Button type="button" variant="secondary" disabled={!base.name.trim()} onClick={() => downloadText(JSON.stringify(jsonLdPreview.jsonLd, null, 2), `localbusiness-${today()}.jsonld`)}><Download aria-hidden="true" />{copy(locale, 'JSON-LD出力', 'Export JSON-LD')}</Button></MeoWorkspaceActions>
          {saveJsonLd.isError ? <Notice tone="error">{errorMessage(saveJsonLd.error, locale)}</Notice> : null}{mutationNotice(saveJsonLd.data, copy(locale, 'JSON-LDスナップショットを保存しました。', 'JSON-LD snapshot saved.'), locale)}
        </MeoWorkspaceSection>
        {jsonLdHistory.data ? <MeoWorkspaceDataTable label={copy(locale, 'JSON-LD履歴', 'JSON-LD history')} rows={jsonLdHistory.data.items} getRowKey={(row, index) => idOf(row) || String(index)} columns={[
          { id: 'date', header: copy(locale, '生成日', 'Generated at'), cell: (row) => formatDate(row.created_at, locale) }, { id: 'type', header: 'type', cell: (row) => text(row.schema_type) }, { id: 'status', header: copy(locale, '状態', 'Status'), cell: (row) => statusLabel(text(row.status), locale) }, { id: 'document', header: copy(locale, '内容', 'Content'), cell: (row) => <details><summary>{copy(locale, 'JSONを表示', 'Show JSON')}</summary><pre>{JSON.stringify(row.document ?? {}, null, 2)}</pre></details> },
        ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, 'JSON-LD履歴はまだありません', 'No JSON-LD history yet')} />} /> : null}
      </> : null}
      {tab === 'gpt' ? <MeoWorkspaceSection title={copy(locale, '任意の外部GPT連携', 'Optional external GPT integration')} description={copy(locale, '基準NAPと台帳をJSONで持ち出し、外部GPTの出力を検証します。Zeroの機能は外部GPTなしでも動きます。', 'Export canonical NAP and ledger data as JSON and validate external GPT output. Zero works without an external GPT.')} surface="outlined">
        <MeoWorkspaceActions><Button type="button" variant="secondary" onClick={exportGpt}><FileJson aria-hidden="true" />{copy(locale, 'GPT入力JSONを出力', 'Export GPT input JSON')}</Button><label className="button button--secondary"><Upload aria-hidden="true" />{copy(locale, 'GPT出力JSONを検証', 'Validate GPT output JSON')}<input className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void importGpt(event)} /></label></MeoWorkspaceActions>
        <Notice tone="warning">{copy(locale, '外部GPTの提案は自動適用しません。引用・掲載を保証せず、利用者が根拠を確認します。', 'External GPT suggestions are never applied automatically. They do not guarantee citation or inclusion; you must verify the evidence.')}</Notice>
        {gptImportMessage ? <Notice tone="success">{gptImportMessage}</Notice> : null}{gptImportError ? <Notice tone="error">{gptImportError}</Notice> : null}
        <MeoWorkspaceDataTable label={copy(locale, '検証済みGPT提案', 'Validated GPT suggestions')} rows={gptSuggestions} getRowKey={(row) => row.id} columns={[
          { id: 'citation', header: copy(locale, '台帳ID', 'Ledger ID'), cell: (row) => row.citationId }, { id: 'field', header: copy(locale, '項目', 'Field'), cell: (row) => row.field }, { id: 'value', header: copy(locale, '提案値', 'Suggested value'), cell: (row) => row.proposedValue }, { id: 'reason', header: copy(locale, '根拠', 'Rationale'), cell: (row) => row.rationale },
        ]} emptyState={<MeoWorkspaceEmptyState title={copy(locale, '検証済み提案はありません', 'No validated suggestions')} description={copy(locale, 'JSONを取り込むまで変更はありません。', 'Nothing changes until you import JSON.')} />} />
      </MeoWorkspaceSection> : null}
    </>
  )
}

export function AioWorkspacePage() {
  const { locale } = useI18n()
  return (
    <MeoWorkspacePageFrame title={locale === 'ja' ? 'AIO・サイテーション' : 'AIO & citations'} description={locale === 'ja' ? 'NAP整合性、手動掲載台帳、LocalBusiness JSON-LDを管理します。' : 'Manage NAP consistency, a manual citation ledger, and LocalBusiness JSON-LD.'}>
      {({ storeId, query, role }) => <AioContent storeId={storeId} role={role} profile={object(query.data?.profile)} />}
    </MeoWorkspacePageFrame>
  )
}

export const AIOWorkspacePage = AioWorkspacePage
