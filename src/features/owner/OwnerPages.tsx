import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  FileDown,
  FileText,
  Globe2,
  Link2,
  KeyRound,
  MapPinned,
  Pause,
  Play,
  Printer,
  RefreshCw,
  Save,
  Share2,
  Trash2,
} from 'lucide-react'
import QRCode from 'qrcode'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { z } from 'zod'
import { Fade, Fades } from '../../components/animate-ui/primitives/effects/fade'
import { SlidingNumber } from '../../components/animate-ui/primitives/texts/sliding-number'
import { OwnerAnimatedIcon, OwnerIconMotion } from './OwnerAnimatedIcon'
import { AI_PROVIDER_IDS, aiModelFor, aiProviderCatalog, aiProviderLabel, type AiProviderName } from '../../shared/ai-providers'
import { publicAiProviderLabel } from './public-ai-provider'
import { ApiError, apiRequest } from '../../shared/api/http'
import { runtimeConfig } from '../../shared/config/runtime'
import { ThemeSwitcher } from '../../shared/theme/ThemeSwitcher'
import { useI18n, type Locale } from '../../shared/i18n'
import { AiProviderLogo } from '../../shared/ui/AiProviderLogo'
import { copyText } from '../../shared/lib/clipboard'
import { createCsv } from '../../shared/lib/csv'
import { validateGoogleReviewUrl } from '../../shared/lib/google-review-url'
import { createReviewAnalysisJson } from '../../shared/lib/review-analysis-export'
import { Badge, Button, EmptyState, LoadingState, Notice, PageTitle, Panel } from '../../shared/ui/ui'
import { TurnstileWidget } from '../../shared/ui/TurnstileWidget'
import { useAuth } from '../auth/auth-context'
import { passwordMeetsRequirements } from '../auth/password-policy'
import { MEO_FEATURES, meoFeatureDefinition } from '../meo/feature-registry'
import { meoFeatureCapabilitiesQueryOptions } from '../meo/meo-api'
import { loadDashboardData, type DashboardSetupState } from './dashboard-data'
import { MonthlySummaryPanel } from './MonthlySummaryPanel'
import {
  deleteAiConnection,
  getAiConnection,
  getAiConnections,
  getAllInterviewRows,
  getInterviewDetail,
  getInterviewHistory,
  getMonthlySummary,
  getOwnerStore,
  getSurveyRevisions,
  revalidateAiConnection,
  selectAiModel,
  saveOwnerStore,
  selectAiProvider,
  setStorePublished,
  validateAndSaveAiConnection,
  type AiConnection,
  type InterviewRow,
  type StoreRecord,
} from './owner-api'
import { surveyAnswerColumns, surveyAnswerPairs, surveyAnswerValues } from './interview-answer-export'
import { ownerStorePath, useActiveStoreId } from './store-scope'

const formatDate = (value: string | null, locale: Locale) =>
  value ? new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(value)) : '—'
const reviewText = (row: InterviewRow, locale: Locale) => row.edited_review ?? row.generated_review ?? (locale === 'ja' ? '回答は保存されています' : 'Response saved')
const formatMeoRoadmapDate = (value: string | null, locale: Locale) => value ? new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
  month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Tokyo',
}).format(new Date(value)) : locale === 'ja' ? '公開日未定' : 'Release date TBD'
function downloadTextFile(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

async function downloadDataUrl(dataUrl: string, filename: string) {
  const blob = await fetch(dataUrl).then((response) => response.blob())
  const url = URL.createObjectURL(new Blob([blob], { type: 'image/png' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function MobileMeoRoadmap({ storeId }: { storeId: string }) {
  const { locale, text, formatNumber } = useI18n()
  const capabilitiesQuery = useQuery(meoFeatureCapabilitiesQueryOptions(storeId))
  const features = MEO_FEATURES.flatMap((definition) => {
    const capability = capabilitiesQuery.data?.features.find((item) => item.key === definition.key)
    if (!capability || capability.status === 'hidden') return []
    return [{ definition, capability }]
  }).toSorted((left, right) => new Date(left.capability.releaseAt ?? 0).getTime() - new Date(right.capability.releaseAt ?? 0).getTime())
  const nextRelease = features.find(({ capability }) => capability.status === 'coming_soon')
  if (features.length === 0) return null
  return (
    <section className="dashboard-meo-roadmap" aria-label={text({ ja:'Google集客の機能一覧', en:'Google growth features' })}>
      <details>
        <summary>
          <span className="dashboard-meo-roadmap__icon"><MapPinned aria-hidden="true" /></span>
          <span className="dashboard-meo-roadmap__summary-copy">
            <strong>{text({ ja:'Google集客', en:'Google growth' })}</strong>
            <small>{nextRelease ? text({ ja:`次回 ${formatMeoRoadmapDate(nextRelease.capability.releaseAt, locale)}`, en:`Next: ${formatMeoRoadmapDate(nextRelease.capability.releaseAt, locale)}` }) : text({ ja:'利用できる機能を見る', en:'View available features' })}</small>
          </span>
          <span className="dashboard-meo-roadmap__count">{text({ ja:`${formatNumber(features.length)}機能`, en:`${formatNumber(features.length)} features` })}</span>
        </summary>
        <div className="dashboard-meo-roadmap__list">
          {features.map(({ definition, capability }, index) => {
            const FeatureIcon = definition.icon
            const content = (
              <>
                <FeatureIcon data-testid={`dashboard-meo-icon-${definition.key}`} aria-hidden="true" />
                <span>
                  <small>{text({ ja:`第${formatNumber(index + 1)}弾`, en:`Release ${formatNumber(index + 1)}` })}</small>
                  <strong>{locale === 'ja' ? capability.title || definition.shortTitle : meoFeatureDefinition(definition.key, locale).shortTitle}</strong>
                </span>
                  <small>{capability.status === 'available' ? text({ ja:'利用可能', en:'Available' }) : formatMeoRoadmapDate(capability.releaseAt, locale)}</small>
              </>
            )
            return capability.status === 'available' ? (
              <Link className="dashboard-meo-roadmap__item" key={definition.key} to={ownerStorePath(storeId, definition.path)}>{content}</Link>
            ) : (
              <div className="dashboard-meo-roadmap__item" key={definition.key}>{content}</div>
            )
          })}
        </div>
      </details>
    </section>
  )
}

export function DashboardPage() {
  const { locale, text } = useI18n()
  const storeId = useActiveStoreId()
  const query = useQuery({
    queryKey: ['owner-dashboard', storeId],
    queryFn: () => loadDashboardData(storeId),
  })
  if (query.isLoading) return <LoadingState label={text({ ja:'ホームを読み込んでいます', en:'Loading dashboard' })} />
  if (query.isError || !query.data) return <Notice tone="error">{text({ ja:'ホームを読み込めませんでした。', en:'Could not load the dashboard.' })}</Notice>
  const { store, setup, ai, summary, recent } = query.data
  if (!store) return <div className="owner-page"><PageTitle title={text({ ja:'ホーム', en:'Dashboard' })} /><EmptyState title={text({ ja:'先に店舗情報を入力してください', en:'Enter your store information first' })} action={<Link className="button button--primary" to={ownerStorePath(storeId, '/store')}>{text({ ja:'店舗情報を開く', en:'Open store information' })}</Link>} /></div>
  if (!setup.isComplete) return <StoreSetupGate storeId={storeId} setup={setup} />
  const generationStatus = ai
    ? { label: text({ ja:`${aiProviderLabel(ai.provider, locale)} 接続済み`, en:`${aiProviderLabel(ai.provider, locale)} connected` }), detail: text({ ja:`末尾 ${ai.keyLast4}・${ai.model}`, en:`Ending in ${ai.keyLast4} · ${ai.model}` }) }
    : { label: text({ ja:'AI未設定', en:'AI not configured' }), detail: text({ ja:'口コミ文の生成には店舗管理者のAI接続が必要', en:'An owner-managed AI connection is required to generate review text' }) }

  return (
    <div className="owner-page">
      <PageTitle title={text({ ja:'ホーム', en:'Dashboard' })} />
      <MobileMeoRoadmap storeId={storeId} />
      <Fade asChild inView inViewOnce>
      <section className="metrics-section">
        <h2>{text({ ja:'今月の状況', en:'This month' })}</h2>
        {summary ? (
          <div className="metrics-row metrics-row--without-trial">
            <div><span>{text({ ja:'完了数', en:'Completed' })}</span><strong><SlidingNumber number={summary.completed} fromNumber={summary.completed} initiallyStable inView inViewOnce /></strong></div>
            <div><span>{text({ ja:'Google遷移数', en:'Google handoffs' })}</span><strong><SlidingNumber number={summary.google_handoffs} fromNumber={summary.google_handoffs} initiallyStable inView inViewOnce /></strong></div>
          </div>
        ) : <EmptyState title={text({ ja:'今月のデータはまだありません', en:'No data for this month yet' })} />}
      </section>
      </Fade>
      <Fades asChild inView inViewOnce holdDelay={70}>
      <section className="panel recent-panel">
        <div className="section-heading"><h2>{text({ ja:'最近の回答', en:'Recent responses' })}</h2><Link to={ownerStorePath(storeId, '/interviews')}>{text({ ja:'すべての回答を見る', en:'View all responses' })}</Link></div>
        {recent.length === 0 ? <EmptyState title={text({ ja:'回答はまだありません', en:'No responses yet' })} /> : <InterviewTable rows={recent} />}
      </section>
      <section className="panel status-band status-band--compact">
        <OwnerIconMotion>
          <div className="status-band__item" data-owner-icon-trigger="status"><span>{text({ ja:'公開状態', en:'Publication status' })}</span><strong><OwnerAnimatedIcon name="globe" fallback={Globe2} />{store.status === 'published' ? text({ ja:'公開中', en:'Published' }) : store.status === 'paused' ? text({ ja:'停止中', en:'Paused' }) : text({ ja:'下書き', en:'Draft' })}</strong></div>
        </OwnerIconMotion>
        <OwnerIconMotion>
          <div className="status-band__item" data-owner-icon-trigger="status"><span>{text({ ja:'文章生成', en:'Text generation' })}</span><strong><OwnerAnimatedIcon name="connections" fallback={Link2} />{generationStatus.label}</strong>{generationStatus.detail ? <small>{generationStatus.detail}</small> : null}</div>
        </OwnerIconMotion>
        <div className="status-band__action">
          {store.status === 'published'
            ? <Link className="button button--secondary" to={`/s/${store.public_slug}`} target="_blank" rel="noopener noreferrer">{text({ ja:'公開ページを確認', en:'View public page' })}</Link>
            : <Link className="button button--secondary" to={ownerStorePath(storeId, '/qr')}>{text({ ja:'公開準備を確認', en:'Check publication setup' })}</Link>}
        </div>
      </section>
      </Fades>
    </div>
  )
}

function StoreSetupGate({ storeId, setup }: { storeId: string; setup: DashboardSetupState }) {
  const { text } = useI18n()
  const items = [
    {
      key: 'store',
      title: text({ ja:'店舗情報', en:'Store information' }),
      description: text({ ja:'Google口コミ投稿URLを登録してください', en:'Add your Google review URL' }),
      complete: setup.storeInformationComplete,
      to: ownerStorePath(storeId, '/store'),
      icon: MapPinned,
    },
    {
      key: 'survey',
      title: text({ ja:'アンケート編集', en:'Survey editing' }),
      description: text({ ja:'内容を確認して、一度保存してください', en:'Review the survey and save it once' }),
      complete: setup.surveyEditingComplete,
      to: ownerStorePath(storeId, '/survey'),
      icon: FileText,
    },
  ]

  return (
    <div className="owner-page owner-page--setup-gate">
      <section className="dashboard-setup-gate" aria-labelledby="dashboard-setup-gate-title">
        <header className="dashboard-setup-gate__header">
          <span className="dashboard-setup-gate__eyebrow">{text({ ja:'はじめに', en:'Get started' })}</span>
          <h1 id="dashboard-setup-gate-title">{text({ ja:'初期設定を完了してください', en:'Complete your initial setup' })}</h1>
          <p>{text({ ja:'この店舗のホームを表示するには、次の2つの設定が必要です。', en:'Complete these two settings to view this store dashboard.' })}</p>
        </header>
        <nav className="dashboard-setup-gate__items" aria-label={text({ ja:'初期設定', en:'Initial setup' })}>
          {items.map((item) => {
            const Icon = item.icon
            return (
              <Link className="dashboard-setup-gate__item" data-complete={item.complete} key={item.key} to={item.to}>
                <span className="dashboard-setup-gate__icon"><Icon aria-hidden="true" /></span>
                <span className="dashboard-setup-gate__copy"><strong>{item.title}</strong><small>{item.description}</small></span>
                <span className="dashboard-setup-gate__status">{item.complete ? <><CheckCircle2 aria-hidden="true" />{text({ ja:'完了', en:'Complete' })}</> : text({ ja:'設定する', en:'Set up' })}</span>
                <ChevronRight className="dashboard-setup-gate__chevron" aria-hidden="true" />
              </Link>
            )
          })}
        </nav>
      </section>
    </div>
  )
}

function InterviewTable({ rows }: { rows: InterviewRow[] }) {
  const { locale, text } = useI18n()
  const storeId = useActiveStoreId()
  return (
    <div className="table-scroll"><table><thead><tr><th>{text({ ja:'回答日時', en:'Response date' })}</th><th>{text({ ja:'評価', en:'Rating' })}</th><th>{text({ ja:'生成状態', en:'Generation status' })}</th><th>{text({ ja:'口コミ文', en:'Review text' })}</th><th>{text({ ja:'Google遷移', en:'Google handoff' })}</th><th><span className="sr-only">{text({ ja:'詳細', en:'Details' })}</span></th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}><td>{formatDate(row.created_at, locale)}</td><td>{row.rating ?? text({ ja:'なし', en:'None' })}</td><td>{row.generation_status === 'succeeded' ? <Badge>{text({ ja:'生成済み', en:'Generated' })}</Badge> : row.generation_status === 'failed' ? text({ ja:'生成失敗', en:'Generation failed' }) : text({ ja:'未生成', en:'Not generated' })}</td><td className="review-excerpt">{reviewText(row, locale)}</td><td>{row.google_handoff_opened_at ? <Badge>{text({ ja:'あり', en:'Yes' })}</Badge> : text({ ja:'なし', en:'No' })}</td><td><Link aria-label={text({ ja:`${formatDate(row.created_at, locale)}の回答詳細`, en:`Response details for ${formatDate(row.created_at, locale)}` })} to={ownerStorePath(storeId, `/interviews/${row.id}`)}>›</Link></td></tr>)}</tbody>
    </table></div>
  )
}

function DataLoadError({
  title,
  description,
  onRetry,
}: {
  title: string
  description: string
  onRetry: () => void
}) {
  const { text } = useI18n()
  return (
    <Notice tone="error">
      <strong>{title}</strong>
      <p>{description}</p>
      <Button type="button" variant="secondary" onClick={onRetry}><RefreshCw />{text({ ja:'もう一度試す', en:'Try again' })}</Button>
    </Notice>
  )
}

export function QrPage() {
  const storeId = useActiveStoreId()
  return <QrPageForStore key={storeId} storeId={storeId} />
}

function QrPageForStore({ storeId }: { storeId: string }) {
  const { locale, text } = useI18n()
  const queryClient = useQueryClient()
  const storeQuery = useQuery({ queryKey: ['owner-store', storeId], queryFn: () => getOwnerStore(storeId) })
  const [qr, setQr] = useState('')
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success')
  const store = storeQuery.data
  const publicUrl = store ? `${runtimeConfig.appOrigin}/s/${store.public_slug}` : ''
  useEffect(() => {
    if (!publicUrl) return
    let cancelled = false
    void QRCode.toDataURL(publicUrl, { width: 420, margin: 2, color: { dark: '#1f2937', light: '#ffffff' } })
      .then((generatedQr) => {
        if (!cancelled) setQr(generatedQr)
      })
      .catch(() => {
        if (cancelled) return
        setMessageTone('error')
        setMessage(text({ ja:'QRコードを生成できませんでした。', en:'Could not generate the QR code.' }))
      })
    return () => { cancelled = true }
  }, [publicUrl, text])
  const statusMutation = useMutation({
    mutationFn: (published: boolean) => setStorePublished(storeId, published),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['owner-store', storeId] }),
    onError: (caught) => {
      setMessageTone('error')
      setMessage(locale === 'ja' && caught instanceof Error ? caught.message : text({ ja:'公開状態を変更できませんでした。', en:'Could not change publication status.' }))
    },
  })
  if (storeQuery.isLoading) return <LoadingState label={text({ ja:'読み込んでいます', en:'Loading' })} />
  if (!store) return <EmptyState title={text({ ja:'先に店舗情報を登録してください', en:'Register your store information first' })} action={<Link className="button button--primary" to={ownerStorePath(storeId, '/store')}>{text({ ja:'店舗情報を開く', en:'Open store information' })}</Link>} />
  const copyUrl = async () => { try { if (!await copyText(publicUrl)) throw new Error('copy failed'); setMessageTone('success'); setMessage(text({ ja:'URLをコピーしました。', en:'URL copied.' })) } catch { setMessageTone('error'); setMessage(text({ ja:'URLをコピーできませんでした。長押しまたは選択してコピーしてください。', en:'Could not copy the URL. Press and hold or select it to copy.' })) } }
  return (
    <div className="owner-page"><PageTitle title={text({ ja:'QR・共有リンク', en:'QR code and share link' })} />
      {message ? <Notice tone={messageTone}>{message}</Notice> : null}
      <Fades asChild inView inViewOnce holdDelay={70}>
      <div className="qr-page-grid"><section className="panel qr-large"><h2>{store.name}</h2>{qr ? <img src={qr} alt={text({ ja:`${publicUrl}のQRコード`, en:`QR code for ${publicUrl}` })} /> : null}<code>{publicUrl}</code></section>
        <section className="panel action-list"><h2>{text({ ja:'共有する', en:'Share' })}</h2><Button onClick={() => void copyUrl()}><Copy />{text({ ja:'URLをコピー', en:'Copy URL' })}</Button><Button variant="secondary" onClick={() => qr && void downloadDataUrl(qr, 'kuchitoru-zero-qr.png').catch(() => { setMessageTone('error'); setMessage(text({ ja:'QRコードをダウンロードできませんでした。', en:'Could not download the QR code.' })) })}><Download />{text({ ja:'PNGをダウンロード', en:'Download PNG' })}</Button><Button variant="secondary" disabled={!navigator.share} onClick={() => void navigator.share?.({ title: store.name, url: publicUrl }).catch(() => { setMessageTone('error'); setMessage(text({ ja:'共有を完了できませんでした。', en:'Could not complete sharing.' })) })}><Share2 />{text({ ja:'共有', en:'Share' })}</Button><Button variant="secondary" onClick={() => window.print()}><Printer />{text({ ja:'印刷', en:'Print' })}</Button><hr />{store.status !== 'published' && !store.google_review_url ? <Notice tone="warning">{text({ ja:'公開前に、', en:'Before publishing, ' })}<Link to={ownerStorePath(storeId, '/store')}>{text({ ja:'店舗情報でGoogle口コミ投稿URLを登録', en:'add a Google review URL in store information' })}</Link>{text({ ja:'してください。', en:'.' })}</Notice> : <Button variant="secondary" animated={store.status !== 'published'} busy={statusMutation.isPending} onClick={() => statusMutation.mutate(store.status !== 'published')}>{store.status === 'published' ? <><Pause />{text({ ja:'公開を停止', en:'Unpublish' })}</> : <><Play />{text({ ja:'公開する', en:'Publish' })}</>}</Button>}</section></div>
      </Fades>
    </div>
  )
}

export function InterviewsPage() {
  const storeId = useActiveStoreId()
  return <InterviewsPageForStore key={storeId} storeId={storeId} />
}

function InterviewsPageForStore({ storeId }: { storeId: string }) {
  const { locale, text } = useI18n()
  const [cursor, setCursor] = useState<{ createdAt: string; id: string } | undefined>()
  const [previous, setPrevious] = useState<Array<{ createdAt: string; id: string } | undefined>>([])
  const query = useQuery({ queryKey: ['interviews', storeId, cursor], queryFn: () => getInterviewHistory(storeId, cursor) })
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const exportGeneration = useRef(0)
  useEffect(() => () => { exportGeneration.current += 1 }, [])
  const exportCsv = async () => {
    const generation = ++exportGeneration.current
    setExportError('')
    setExporting(true)
    try {
      const [rows, revisions] = await Promise.all([getAllInterviewRows(storeId), getSurveyRevisions(storeId)])
      if (generation !== exportGeneration.current) return
      const columns = surveyAnswerColumns(rows, revisions, locale)
      const csvRows: unknown[][] = [[
        text({ ja:'回答日時', en:'Response date' }),text({ ja:'完了状態', en:'Completion status' }),text({ ja:'評価', en:'Rating' }),text({ ja:'来店頻度', en:'Visit frequency' }),text({ ja:'生成口コミ文', en:'Generated review' }),text({ ja:'編集後口コミ文', en:'Edited review' }),text({ ja:'Google投稿画面遷移', en:'Google posting handoff' }),'AI Provider',
        ...columns.map((column) => column.header),
      ]]
      rows.forEach((row) => {
        const answers = surveyAnswerValues(row, revisions, columns, locale)
        csvRows.push([
          formatDate(row.created_at, locale),row.status,row.rating ?? '',row.visit_frequency ?? '',row.generated_review ?? '',row.edited_review ?? '',row.google_handoff_opened_at ? text({ ja:'あり', en:'Yes' }) : text({ ja:'なし', en:'No' }),publicAiProviderLabel(row.generation_provider),
          ...columns.map((column) => answers[column.header] ?? ''),
        ])
      })
      downloadTextFile(createCsv(csvRows), 'kuchitoru-zero-interviews.csv', 'text/csv;charset=utf-8')
    } catch (caught) {
      if (generation === exportGeneration.current) {
        setExportError(locale === 'ja' && caught instanceof Error ? caught.message : text({ ja:'CSVを作成できませんでした。', en:'Could not create the CSV file.' }))
      }
    } finally {
      if (generation === exportGeneration.current) setExporting(false)
    }
  }
  const exportJson = async () => {
    const generation = ++exportGeneration.current
    setExportError('')
    setExporting(true)
    try {
      const [rows, store, revisions] = await Promise.all([getAllInterviewRows(storeId), getOwnerStore(storeId), getSurveyRevisions(storeId)])
      if (generation !== exportGeneration.current) return
      const columns = surveyAnswerColumns(rows, revisions, locale)
      const json = createReviewAnalysisJson({
        storeName: store?.name ?? null,
        exportedAt: new Date(),
        rows: rows.map((row) => ({ ...row, generation_provider: publicAiProviderLabel(row.generation_provider), question_answers: surveyAnswerValues(row, revisions, columns, locale) })),
      })
      downloadTextFile(json, 'kuchitoru-zero-review-analysis.json', 'application/json;charset=utf-8')
    } catch (caught) {
      if (generation === exportGeneration.current) {
        setExportError(locale === 'ja' && caught instanceof Error ? caught.message : text({ ja:'分析用JSONを作成できませんでした。', en:'Could not create the analysis JSON file.' }))
      }
    } finally {
      if (generation === exportGeneration.current) setExporting(false)
    }
  }
  const data = query.data
  const canExport = Boolean(data?.rows.length) && !query.isError
  return (
    <div className="owner-page"><PageTitle title={text({ ja:'回答履歴', en:'Response history' })} action={<div className="button-group"><Button data-testid="analysis-download" variant="secondary" busy={exporting} disabled={!canExport} onClick={() => void exportJson()}><FileText />{text({ ja:'JSONをダウンロード', en:'Download JSON' })}</Button><Button data-testid="csv-download" busy={exporting} disabled={!canExport} onClick={() => void exportCsv()}><FileDown />{text({ ja:'CSVをダウンロード', en:'Download CSV' })}</Button></div>} />
      {exportError ? <Notice tone="error">{exportError}</Notice> : null}
      {query.isLoading ? <LoadingState label={text({ ja:'回答履歴を読み込んでいます', en:'Loading response history' })} /> : query.isError || !data ? <DataLoadError title={text({ ja:'回答履歴を取得できませんでした', en:'Could not load response history' })} description={text({ ja:'通信状況を確認して、もう一度お試しください。回答が0件という意味ではありません。', en:'Check your connection and try again. This does not mean there are no responses.' })} onRetry={() => void query.refetch()} /> : data.rows.length === 0 ? <EmptyState title={text({ ja:'まだ回答はありません', en:'No responses yet' })} action={<Link className="button button--primary" to={ownerStorePath(storeId, '/qr')}>{text({ ja:'回答を集める準備をする', en:'Get ready to collect responses' })}</Link>} /> : <div className="owner-motion-wrapper"><Fade inView inViewOnce><Panel className="table-panel"><InterviewTable rows={data.rows} /></Panel></Fade><Fade inView inViewOnce delay={70}><div className="pagination"><Button variant="secondary" disabled={previous.length === 0} onClick={() => { const copy=[...previous]; setCursor(copy.pop()); setPrevious(copy) }}>{text({ ja:'前へ', en:'Previous' })}</Button><Button variant="secondary" disabled={!data.nextCursor} onClick={() => { setPrevious((value) => [...value,cursor]); setCursor(data.nextCursor ?? undefined) }}>{text({ ja:'次へ', en:'Next' })}</Button></div></Fade></div>}
    </div>
  )
}

export function InterviewDetailPage() {
  const { locale, text } = useI18n()
  const storeId = useActiveStoreId()
  const { id = '' } = useParams()
  const query = useQuery({ queryKey: ['interview-detail', storeId, id], queryFn: () => getInterviewDetail(storeId, id), enabled: id !== '' })
  if (query.isLoading) return <LoadingState label={text({ ja:'読み込んでいます', en:'Loading' })} />
  if (!query.data?.session) return <EmptyState title={text({ ja:'回答が見つかりません', en:'Response not found' })} description={text({ ja:'削除済みか、表示する権限がありません。', en:'It may have been deleted, or you may not have permission to view it.' })} />
  const { session, surveyRevisions } = query.data
  const answerPairs = surveyAnswerPairs(session, surveyRevisions, locale)
  return <div className="owner-page"><PageTitle title={text({ ja:'回答詳細', en:'Response details' })} description={formatDate(session.created_at, locale)} action={<Link className="button button--secondary" to={ownerStorePath(storeId, '/interviews')}>{text({ ja:'一覧へ戻る', en:'Back to list' })}</Link>} />
    <div className="detail-grid"><Fade asChild inView inViewOnce><section className="panel"><h2>{text({ ja:'回答', en:'Responses' })}</h2><dl className="details">{answerPairs.map((pair) => <div key={pair.id}><dt>Q: {pair.label}</dt><dd>A: {pair.answer}</dd></div>)}</dl><h3>{text({ ja:'処理情報', en:'Processing information' })}</h3><dl className="details"><dt>{text({ ja:'アンケート版', en:'Survey version' })}</dt><dd>{session.survey_revision ?? text({ ja:'旧形式', en:'Legacy format' })}</dd><dt>{text({ ja:'完了状態', en:'Completion status' })}</dt><dd>{session.status}</dd><dt>{text({ ja:'生成状態', en:'Generation status' })}</dt><dd>{session.generation_status}</dd><dt>AI Provider</dt><dd>{publicAiProviderLabel(session.generation_provider)}</dd><dt>{text({ ja:'Google遷移', en:'Google handoff' })}</dt><dd>{formatDate(session.google_handoff_opened_at, locale)}</dd></dl></section></Fade>
      <Fade asChild inView inViewOnce delay={70}><section className="panel"><h2>{text({ ja:'口コミ文', en:'Review text' })}</h2><h3>{text({ ja:'生成文', en:'Generated text' })}</h3><p>{session.generated_review ?? text({ ja:'生成されていません。', en:'Not generated.' })}</p><h3>{text({ ja:'編集後', en:'Edited' })}</h3><p>{session.edited_review ?? text({ ja:'編集はありません。', en:'No edits.' })}</p></section></Fade></div>
  </div>
}

export function SummaryPage() {
  const { text } = useI18n()
  const storeId = useActiveStoreId()
  const query = useQuery({ queryKey: ['monthly-summary', storeId], queryFn: () => getMonthlySummary(storeId) })
  return <div className="owner-page">
    <h1 className="sr-only">{text({ ja:'月次サマリー', en:'Monthly summary' })}</h1>
    {query.isLoading ? <LoadingState label={text({ ja:'月次サマリーを読み込んでいます', en:'Loading monthly summary' })} /> : query.isError || !query.data ? <DataLoadError title={text({ ja:'月次サマリーを取得できませんでした', en:'Could not load monthly summary' })} description={text({ ja:'集計データを読み込めませんでした。時間をおいて、もう一度お試しください。', en:'Could not load the summary data. Wait a moment and try again.' })} onRetry={() => void query.refetch()} /> : query.data.started === 0 ? <EmptyState title={text({ ja:'今月の回答はまだありません', en:'No responses this month yet' })} action={<Link className="button button--primary" to={ownerStorePath(storeId, '/qr')}>{text({ ja:'回答を集める準備をする', en:'Get ready to collect responses' })}</Link>} /> : <Fade asChild inView inViewOnce><MonthlySummaryPanel summary={query.data} /></Fade>}
  </div>
}

const createStoreSchema = (locale: Locale) => z.object({
  name: z.string().trim().min(1).max(120), industry: z.string().max(120), address: z.string().max(500),
  description: z.string().max(2000), websiteUrl: z.union([z.literal(''), z.url()]), welcomeMessage: z.string().max(1000), closingMessage: z.string().max(1000),
  googleReviewUrl: z.string().transform((value, context) => {
    if (value.trim() === '') return ''
    try { return validateGoogleReviewUrl(value) } catch (caught) {
      context.addIssue({ code: 'custom', message: locale === 'ja' && caught instanceof Error ? caught.message : locale === 'ja' ? 'Google口コミ投稿URLを確認してください。' : 'Check the Google review URL.' })
      return z.NEVER
    }
  }),
  googlePlaceId: z.string().trim().max(255).regex(/^$|^[A-Za-z0-9_-]{10,255}$/, locale === 'ja' ? 'GoogleマップのPlace IDを確認してください。' : 'Check the Google Maps Place ID.'),
})
type StoreValues = z.infer<ReturnType<typeof createStoreSchema>>

export function StorePage() {
  const storeId = useActiveStoreId()
  return <StorePageForStore key={storeId} storeId={storeId} />
}

function StorePageForStore({ storeId }: { storeId: string }) {
  const { text } = useI18n()
  const query = useQuery({ queryKey: ['owner-store', storeId], queryFn: () => getOwnerStore(storeId) })
  if (query.isLoading) {
    return <div className="owner-page"><LoadingState label={text({ ja:'店舗情報を読み込んでいます', en:'Loading store information' })} /></div>
  }
  if (query.isError || !query.data || query.data.id !== storeId) {
    return <div className="owner-page"><DataLoadError title={text({ ja:'店舗情報を取得できませんでした', en:'Could not load store information' })} description={text({ ja:'選択した店舗の情報を読み込めませんでした。設定を変更せずに、もう一度お試しください。', en:'Could not load the selected store. Try again without changing your settings.' })} onRetry={() => void query.refetch()} /></div>
  }
  return <StoreEditor key={storeId} storeId={storeId} store={query.data} />
}

function StoreEditor({ storeId, store }: { storeId: string; store: StoreRecord }) {
  const { locale, text } = useI18n()
  const storeSchema = createStoreSchema(locale)
  const queryClient = useQueryClient()
  const [message, setMessage] = useState('')
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success')
  const form = useForm<StoreValues>({ resolver: zodResolver(storeSchema), defaultValues: { name:store.name,industry:store.industry ?? '',address:store.address ?? '',description:store.description ?? '',websiteUrl:store.website_url ?? '',welcomeMessage:store.welcome_message ?? '',closingMessage:store.closing_message ?? '',googleReviewUrl:store.google_review_url ?? '',googlePlaceId:store.google_place_id ?? '' } })
  const persistStore = async (values: StoreValues, showFormMessage = true) => {
    setMessage('')
    try {
      await saveOwnerStore(storeId, values)
      if (showFormMessage) {
        setMessageTone('success')
        setMessage(text({ ja:'店舗情報を保存しました。', en:'Store information saved.' }))
      }
      await queryClient.invalidateQueries({ queryKey:['owner-store', storeId] })
      await queryClient.invalidateQueries({ queryKey:['owner-stores'] })
    } catch (caught) {
      if (showFormMessage) {
        setMessageTone('error')
        setMessage(locale === 'ja' && caught instanceof Error ? caught.message : text({ ja:'店舗情報を保存できませんでした。', en:'Could not save store information.' }))
      }
      throw caught
    }
  }
  return <div className="owner-page"><PageTitle title={text({ ja:'店舗情報', en:'Store information' })} />
    <Fade asChild inView inViewOnce><section className="panel"><form className="form-stack" onSubmit={form.handleSubmit(async (values) => { await persistStore(values).catch(() => undefined) })}>
      {message ? <Notice tone={messageTone}>{message}</Notice> : null}<label>{text({ ja:'店舗名', en:'Store name' })}<input {...form.register('name')} /></label><label>{text({ ja:'業種', en:'Industry' })}<input {...form.register('industry')} /></label><label>{text({ ja:'住所', en:'Address' })}<input {...form.register('address')} /></label><label>{text({ ja:'店舗説明', en:'Store description' })}<textarea rows={4} {...form.register('description')} /></label><label>{text({ ja:'Webサイト', en:'Website' })}<input type="url" {...form.register('websiteUrl')} /></label><label>{text({ ja:'ウェルカムメッセージ', en:'Welcome message' })}<textarea rows={3} {...form.register('welcomeMessage')} /></label><label>{text({ ja:'終了メッセージ', en:'Closing message' })}<textarea rows={3} {...form.register('closingMessage')} /></label><label>{text({ ja:'Google口コミ投稿URL', en:'Google review URL' })}<input type="url" placeholder="https://g.page/r/.../review" {...form.register('googleReviewUrl')} /></label>{form.formState.errors.googleReviewUrl ? <span className="field-error">{form.formState.errors.googleReviewUrl.message}</span> : null}<p className="field-help">{text({ ja:'公開に必要です。Googleの口コミ投稿画面を開くURLを登録します。', en:'Required for publication. Enter the URL that opens the Google review form.' })}</p><label>{text({ ja:'GoogleマップのPlace ID', en:'Google Maps Place ID' })}<input placeholder="ChIJ..." autoCapitalize="none" autoCorrect="off" {...form.register('googlePlaceId')} /></label>{form.formState.errors.googlePlaceId ? <span className="field-error">{form.formState.errors.googlePlaceId.message}</span> : null}<p className="field-help">{text({ ja:'口コミ文の確認後にGoogleマップを開くために使います。', en:'Used to open Google Maps after the review text is confirmed.' })}</p><a className="button button--secondary" href="https://developers.google.com/maps/documentation/javascript/examples/places-placeid-finder" target="_blank" rel="noopener noreferrer"><ExternalLink/>{text({ ja:'Place IDを検索する', en:'Find a Place ID' })}</a><Button type="submit" busy={form.formState.isSubmitting}>{text({ ja:'保存する', en:'Save' })}</Button>
    </form></section></Fade>
  </div>
}

const createAiSchema = (keyTooLong: string) => z.object({
  apiKeys: z.object({ openai: z.string().max(4096,keyTooLong), gemini: z.string().max(4096,keyTooLong), deepseek: z.string().max(4096,keyTooLong), xai: z.string().max(4096,keyTooLong), anthropic: z.string().max(4096,keyTooLong) }),
  models: z.object({ openai: z.string(), gemini: z.string(), deepseek: z.string(), xai: z.string(), anthropic: z.string() }),
})
type AiValues = z.infer<ReturnType<typeof createAiSchema>>
const EMPTY_AI_CONNECTIONS: AiConnection[] = []
type AiConnectionPresentationStatus = 'active' | 'connected' | 'disconnected'
const aiConnectionStatus = (connection: AiConnection | undefined, activeProvider: AiProviderName | undefined): AiConnectionPresentationStatus => connection?.status==='active' ? connection.provider===activeProvider ? 'active' : 'connected' : 'disconnected'
export function AiConnectionPage() {
  const storeId = useActiveStoreId()
  return <AiConnectionPageForStore key={storeId} storeId={storeId} />
}

function AiConnectionPageForStore({ storeId }: { storeId: string }) {
  const { locale, text } = useI18n()
  const providerCatalog = aiProviderCatalog(locale)
  const copy = {
    title:text({ja:'AI接続',en:'AI connections'}), loading:text({ja:'AI接続を読み込んでいます',en:'Loading AI connections'}),
    loadFailed:text({ja:'AI接続を取得できませんでした',en:'Could not load AI connections'}), loadFailedDetail:text({ja:'保存済みの接続情報を読み込めませんでした。未接続という意味ではないため、設定を変更せずにもう一度お試しください。',en:'Your saved connection information could not be loaded. This does not mean you are disconnected. Try again without changing your settings.'}),
    empty:text({ja:'AI接続はまだありません',en:'No AI connections yet'}), connect:text({ja:'AIを接続する',en:'Connect an AI provider'}), choose:text({ja:'AIを選択',en:'Choose an AI provider'}), choice:text({ja:'AIの選択',en:'AI provider selection'}),
    active:text({ja:'使用中',en:'Active'}), connected:text({ja:'接続済み',en:'Connected'}), disconnected:text({ja:'未接続',en:'Disconnected'}), model:text({ja:'使用するモデル',en:'Model to use'}),
    getKey:text({ja:'取得する',en:'Get API key'}), updatePlaceholder:text({ja:'更新する場合のみ入力',en:'Enter only to update'}), keyPlaceholder:text({ja:'APIキーを入力',en:'Enter API key'}), keyHidden:text({ja:'保存済みのキーは表示されません。',en:'Saved keys are never displayed.'}), updateKey:text({ja:'APIキーを更新',en:'Update API key'}), saveKey:text({ja:'APIキーを確認して保存',en:'Validate and save API key'}),
    saveModel:text({ja:'モデルを保存',en:'Save model'}), revalidate:text({ja:'再確認',en:'Revalidate'}), deleteConnection:text({ja:'接続を削除',en:'Delete connection'}), connectionActions:text({ja:'接続操作',en:'connection actions'}),
    keyTooLong:text({ja:'APIキーが長すぎます。',en:'The API key is too long.'}), invalidKey:text({ja:'入力したAPIキーを確認してください。',en:'Check the API key you entered.'}), genericFailure:text({ja:'処理できませんでした。',en:'The action could not be completed.'}), saveFailed:text({ja:'APIキーを保存できませんでした。',en:'Could not save the API key.'}),
  }
  const statusLabel=(status:AiConnectionPresentationStatus)=>({active:copy.active,connected:copy.connected,disconnected:copy.disconnected})[status]
  const providerSettingLabel=(provider:AiProviderName)=>text({ja:`${aiProviderLabel(provider, locale)}の設定を開く`,en:`Open ${aiProviderLabel(provider, locale)} settings`})
  const localizedError=(caught:unknown,fallback:string)=>{
    if(!(caught instanceof Error)||!caught.message)return fallback
    const known:Record<string,string>={
      '処理できませんでした。':copy.genericFailure,
      'APIキーを保存できませんでした。':copy.saveFailed,
      '入力したAPIキーを確認してください。':copy.invalidKey,
    }
    const localized=known[caught.message]
    if(localized)return localized
    return locale==='ja'?caught.message:fallback
  }
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey:['ai-connections', storeId], queryFn:()=>getAiConnections(storeId) })
  const activeQuery = useQuery({ queryKey:['ai-connection', storeId], queryFn:()=>getAiConnection(storeId) })
  const aiSchema=createAiSchema(copy.keyTooLong)
  const form=useForm<AiValues>({resolver:zodResolver(aiSchema),defaultValues:{apiKeys:{openai:'',gemini:'',deepseek:'',xai:'',anthropic:''},models:{openai:providerCatalog.openai.defaultModel,gemini:providerCatalog.gemini.defaultModel,deepseek:providerCatalog.deepseek.defaultModel,xai:providerCatalog.xai.defaultModel,anthropic:providerCatalog.anthropic.defaultModel}}})
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [pendingAction,setPendingAction]=useState<string|null>(null)
  const [visibleProviders,setVisibleProviders]=useState<Partial<Record<AiProviderName,boolean>>>({})
  const [editingProvider,setEditingProvider]=useState<AiProviderName>('openai')
  const initializedProvider=useRef(false)
  const apiKeys=useWatch({ control:form.control, name:'apiKeys' })
  const models=useWatch({ control:form.control, name:'models' })
  const connections=query.data ?? EMPTY_AI_CONNECTIONS
  const connectionsByProvider=new Map(connections.map((connection)=>[connection.provider,connection]))
  const activeProvider=activeQuery.data?.status==='active'?activeQuery.data.provider:undefined
  const hasActiveConnection=activeProvider!==undefined
  useEffect(()=>{connections.forEach((connection)=>form.setValue(`models.${connection.provider}`,aiModelFor(connection.provider,connection.model,locale).id));if(!initializedProvider.current&&query.data!==undefined&&activeQuery.isSuccess){setEditingProvider(activeQuery.data?.provider??connections[0]?.provider??'openai');initializedProvider.current=true}},[activeQuery.data?.provider,activeQuery.isSuccess,connections,form,locale,query.data])
  const refresh=()=>{void queryClient.invalidateQueries({queryKey:['ai-connections',storeId]});void queryClient.invalidateQueries({queryKey:['ai-connection',storeId]})}
  const runAction=async(action:()=>Promise<unknown>,success:string,actionId:string)=>{if(pendingAction)return;setError('');setMessage('');setPendingAction(actionId);try{await action();setMessage(success);refresh()}catch(caught){setError(localizedError(caught,copy.genericFailure))}finally{setPendingAction(null)}}
  const saveProvider=async(provider:AiProviderName)=>{if(pendingAction)return;setError('');setMessage('');const apiKey=form.getValues(`apiKeys.${provider}`).trim();if(apiKey.length<12){setError(copy.invalidKey);return}const model=aiModelFor(provider,form.getValues(`models.${provider}`),locale);const activate=!hasActiveConnection;setPendingAction(`${provider}:save`);try{await validateAndSaveAiConnection(storeId,{provider,model:model.id,apiKey,activate});form.setValue(`apiKeys.${provider}`,'',{shouldDirty:false,shouldValidate:false});setVisibleProviders((current)=>({...current,[provider]:false}));setMessage(text({ja:`${aiProviderLabel(provider, locale)}のAPIキーを保存${activate?'し、使用中に設定':''}しました。`,en:`Saved the ${aiProviderLabel(provider, locale)} API key${activate?' and made it active':''}.`}));refresh()}catch(caught){setError(localizedError(caught,copy.saveFailed))}finally{setPendingAction(null)}}
  const editingConnection=connectionsByProvider.get(editingProvider)
  const editingDisclosure=providerCatalog[editingProvider]
  const editingVisible=visibleProviders[editingProvider]===true
  const editingModel=aiModelFor(editingProvider,models?.[editingProvider]??editingConnection?.model,locale)
  const editingConnected=editingConnection?.status==='active'
  const editingSelected=Boolean(editingConnected&&editingProvider===activeProvider)
  const editingStatus=aiConnectionStatus(editingConnection,activeProvider)
  const hasPendingKey=Boolean(apiKeys?.[editingProvider].trim())
  if(query.isLoading||activeQuery.isLoading)return <div className="owner-page ai-settings-page"><h1 className="sr-only">{copy.title}</h1><LoadingState label={copy.loading} /></div>
  if(query.isError||activeQuery.isError||!query.data)return <div className="owner-page ai-settings-page"><h1 className="sr-only">{copy.title}</h1><DataLoadError title={copy.loadFailed} description={copy.loadFailedDetail} onRetry={()=>{void query.refetch();void activeQuery.refetch()}} /></div>
  const providerSettings=<>
    {message?<Notice tone="success">{message}</Notice>:null}{error?<Notice tone="error">{error}</Notice>:null}
    {connections.length===0?<Fade asChild inView inViewOnce><EmptyState title={copy.empty} action={<a className="button button--primary" href="#ai-provider-settings">{copy.connect}</a>} /></Fade>:null}
    <Fade asChild inView inViewOnce delay={70}><form id="ai-provider-settings" className="ai-settings-form" onSubmit={(event)=>event.preventDefault()}>
      <div className="ai-settings-section-heading"><h2>{copy.choose}</h2></div>
      <div className="ai-provider-workspace">
        <nav className="ai-provider-list" aria-label={copy.choice}>
          {AI_PROVIDER_IDS.map((provider)=>{const connection=connectionsByProvider.get(provider);const status=aiConnectionStatus(connection,activeProvider);const model=aiModelFor(provider,models?.[provider]??connection?.model,locale);return <button type="button" className={`ai-provider-list__item${editingProvider===provider?' ai-provider-list__item--selected':''}`} aria-label={providerSettingLabel(provider)} aria-pressed={editingProvider===provider} onClick={()=>setEditingProvider(provider)} key={provider}>
            <span className={`ai-provider-card__mark ai-provider-card__mark--${provider}`} data-provider-logo={provider} aria-hidden="true"><AiProviderLogo provider={provider} /></span><span className="ai-provider-list__copy"><strong>{aiProviderLabel(provider, locale)}</strong><small>{model.label}</small></span><span className={`ai-provider-list__status ai-provider-list__status--${status}`}>{statusLabel(status)}</span>
          </button>})}
        </nav>
        <section className={`ai-provider-card ai-provider-detail${editingSelected?' ai-provider-card--selected':''}`} aria-labelledby="ai-provider-detail-title">
          <header className="ai-provider-card__header"><div className="ai-provider-card__identity"><span className={`ai-provider-card__mark ai-provider-card__mark--${editingProvider}`} aria-hidden="true"><AiProviderLogo provider={editingProvider} /></span><h3 id="ai-provider-detail-title">{aiProviderLabel(editingProvider, locale)}</h3></div>
            <button type="button" className={`ai-provider-card__status ai-provider-card__status--${editingStatus}`} aria-label={editingConnected&&!editingSelected?text({ja:`${aiProviderLabel(editingProvider, locale)}を使用する`,en:`Use ${aiProviderLabel(editingProvider, locale)}`}):text({ja:`${aiProviderLabel(editingProvider, locale)}は${statusLabel(editingStatus)}`,en:`${aiProviderLabel(editingProvider, locale)} is ${statusLabel(editingStatus)}`})} disabled={!editingConnected||editingSelected||pendingAction!==null||form.formState.isSubmitting} onClick={()=>void runAction(()=>selectAiProvider(storeId,editingProvider),text({ja:`${aiProviderLabel(editingProvider, locale)}を使用中に設定しました。`,en:`Made ${aiProviderLabel(editingProvider, locale)} active.`}),`${editingProvider}:select`)}>{statusLabel(editingStatus)}</button>
          </header>
          <div className="ai-provider-card__model"><label>{copy.model}<select aria-label={text({ja:`${aiProviderLabel(editingProvider, locale)}のモデル`,en:`${aiProviderLabel(editingProvider, locale)} model`})} {...form.register(`models.${editingProvider}`)}>{editingDisclosure.models.map((candidate)=><option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></label></div>
          <div className="ai-provider-card__key"><div className="ai-provider-card__key-heading"><label htmlFor={`api-key-${editingProvider}`}><KeyRound aria-hidden="true" />{text({ja:`${aiProviderLabel(editingProvider, locale)} APIキー`,en:`${aiProviderLabel(editingProvider, locale)} API key`})}</label><a href={editingDisclosure.keyUrl} aria-label={text({ja:`${aiProviderLabel(editingProvider, locale)}のAPIキーを取得`,en:`Get a ${aiProviderLabel(editingProvider, locale)} API key`})} target="_blank" rel="noopener noreferrer">{copy.getKey}<ExternalLink aria-hidden="true" /></a></div><span className="password-field"><input id={`api-key-${editingProvider}`} type={editingVisible?'text':'password'} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={Boolean(form.formState.errors.apiKeys?.[editingProvider])} aria-describedby={`${hasPendingKey?`api-key-help-${editingProvider} `:''}${form.formState.errors.apiKeys?.[editingProvider]?`api-key-error-${editingProvider}`:''}`.trim()||undefined} placeholder={editingConnection?copy.updatePlaceholder:copy.keyPlaceholder} {...form.register(`apiKeys.${editingProvider}`)} /><button type="button" aria-label={text({ja:`${aiProviderLabel(editingProvider, locale)}のAPIキーを${editingVisible?'隠す':'表示'}`,en:`${editingVisible?'Hide':'Show'} ${aiProviderLabel(editingProvider, locale)} API key`})} aria-pressed={editingVisible} onClick={()=>setVisibleProviders((current)=>({...current,[editingProvider]:!editingVisible}))}>{editingVisible?<EyeOff/>:<Eye/>}</button></span>{hasPendingKey?<p id={`api-key-help-${editingProvider}`} className="field-help">{copy.keyHidden}</p>:null}{form.formState.errors.apiKeys?.[editingProvider]?<span id={`api-key-error-${editingProvider}`} className="field-error">{form.formState.errors.apiKeys[editingProvider]?.message}</span>:null}<Button type="button" className="ai-provider-card__save-key" busy={pendingAction===`${editingProvider}:save`} disabled={!hasPendingKey||pendingAction!==null||form.formState.isSubmitting} onClick={()=>void saveProvider(editingProvider)}>{editingConnection?copy.updateKey:copy.saveKey}</Button></div>
          {editingConnection?<div className="ai-provider-card__actions" aria-label={`${aiProviderLabel(editingProvider, locale)} ${copy.connectionActions}`}><Button type="button" variant="quiet" title={copy.saveModel} aria-label={text({ja:`${aiProviderLabel(editingProvider, locale)}のモデルを保存`,en:`Save ${aiProviderLabel(editingProvider, locale)} model`})} busy={pendingAction===`${editingProvider}:model`} disabled={form.formState.isSubmitting||pendingAction!==null||editingConnection.model===editingModel.id} onClick={()=>void runAction(()=>selectAiModel(storeId,editingProvider,editingModel.id),text({ja:`${aiProviderLabel(editingProvider, locale)}の使用モデルを${editingModel.label}に変更しました。`,en:`Changed the ${aiProviderLabel(editingProvider, locale)} model to ${editingModel.label}.`}),`${editingProvider}:model`)}><Save aria-hidden="true" /></Button><Button type="button" variant="quiet" title={copy.revalidate} aria-label={text({ja:`${aiProviderLabel(editingProvider, locale)}を再確認`,en:`Revalidate ${aiProviderLabel(editingProvider, locale)}`})} busy={pendingAction===`${editingProvider}:revalidate`} disabled={form.formState.isSubmitting||pendingAction!==null} onClick={()=>void runAction(()=>revalidateAiConnection(storeId,editingProvider),text({ja:`${aiProviderLabel(editingProvider, locale)}を再確認しました。`,en:`Revalidated ${aiProviderLabel(editingProvider, locale)}.`}),`${editingProvider}:revalidate`)}><RefreshCw aria-hidden="true" /></Button><Button type="button" variant="quiet" title={copy.deleteConnection} className="ai-provider-card__delete" aria-label={text({ja:`${aiProviderLabel(editingProvider, locale)}の接続を削除`,en:`Delete ${aiProviderLabel(editingProvider, locale)} connection`})} busy={pendingAction===`${editingProvider}:delete`} disabled={form.formState.isSubmitting||pendingAction!==null} onClick={()=>{const warning=editingSelected?text({ja:`${aiProviderLabel(editingProvider, locale)}は現在使用中です。削除するとAI文案生成が利用できなくなります。APIキーを削除しますか？`,en:`${aiProviderLabel(editingProvider, locale)} is currently active. Deleting it will disable AI draft generation. Delete the API key?`}):text({ja:`${aiProviderLabel(editingProvider, locale)}の保存済みAPIキーを削除しますか？`,en:`Delete the saved ${aiProviderLabel(editingProvider, locale)} API key?`});if(window.confirm(warning))void runAction(()=>deleteAiConnection(storeId,editingProvider),text({ja:`${aiProviderLabel(editingProvider, locale)}のAPIキーを削除しました。`,en:`Deleted the ${aiProviderLabel(editingProvider, locale)} API key.`}),`${editingProvider}:delete`)}}><Trash2 aria-hidden="true" /></Button></div>:null}
        </section>
      </div>
    </form></Fade>
  </>
  return <div className="owner-page ai-settings-page"><h1 className="sr-only">{copy.title}</h1>{providerSettings}</div>
}

export function AccountPage() {
  const { user, signOut, signIn, signInWithGoogle, updateAccountEmail, updateAccountPassword, updateAccountLanguage } = useAuth()
  const { locale, text } = useI18n()
  const copy = {
    account: text({ja:'アカウント',en:'Account'}), loginInformation: text({ja:'ログイン情報',en:'Login information'}),
    changeEmail: text({ja:'メールアドレスを変更',en:'Change email address'}), currentEmail: text({ja:'現在のメールアドレス',en:'Current email address'}), newEmail: text({ja:'新しいメールアドレス',en:'New email address'}), sendConfirmation: text({ja:'確認メールを送信',en:'Send confirmation email'}),
    invalidEmail: text({ja:'新しいメールアドレスを正しく入力してください。',en:'Enter a valid new email address.'}), sameEmail: text({ja:'現在と異なるメールアドレスを入力してください。',en:'Enter an email address different from your current one.'}), emailSent: text({ja:'確認メールを送信しました。メール内の案内に沿って変更を完了してください。',en:'Confirmation email sent. Follow the instructions in the email to complete the change.'}), emailFailed: text({ja:'メールアドレスを変更できませんでした。',en:'Could not change the email address.'}),
    changePassword: text({ja:'パスワードを変更',en:'Change password'}), googlePasswordHelp: text({ja:'Googleログインのみを利用している場合は、先にパスワード再設定からパスワードを登録してください。',en:'If you only use Google sign-in, set a password through password reset first.'}), currentPassword: text({ja:'現在のパスワード',en:'Current password'}), newPassword: text({ja:'新しいパスワード',en:'New password'}), confirmPassword: text({ja:'新しいパスワード（確認）',en:'Confirm new password'}), passwordRequirements: text({ja:'8文字以上で、英大文字・英小文字・数字・記号をそれぞれ1文字以上含めてください。',en:'Use at least 8 characters, including an uppercase letter, lowercase letter, number, and symbol.'}),
    currentPasswordRequired: text({ja:'現在のパスワードを入力してください。',en:'Enter your current password.'}), passwordRequirementsError: text({ja:'新しいパスワードの条件を満たしていません。',en:'The new password does not meet the requirements.'}), passwordMismatch: text({ja:'新しいパスワードが一致しません。',en:'The new passwords do not match.'}), samePassword: text({ja:'現在と異なるパスワードを入力してください。',en:'Enter a password different from your current one.'}), securityRequired: text({ja:'セキュリティ確認を完了してください。',en:'Complete the security check.'}), passwordChanged: text({ja:'パスワードを変更しました。',en:'Password changed.'}), passwordFailed: text({ja:'パスワードを変更できませんでした。',en:'Could not change the password.'}),
    display: text({ja:'表示設定',en:'Display'}), logout: text({ja:'ログアウト',en:'Log out'}), logoutFailed: text({ja:'ログアウトできませんでした。',en:'Could not log out.'}), languageFailed: text({ja:'言語設定を更新できませんでした。',en:'Could not update the language setting.'}),
    cancel: text({ja:'キャンセル',en:'Cancel'}), deleteAccount: text({ja:'アカウントを削除',en:'Delete account'}), irreversible: text({ja:'削除すると元に戻せません。',en:'Deletion cannot be undone.'}), password: text({ja:'パスワード',en:'Password'}), reauthPassword: text({ja:'パスワードで再認証',en:'Reauthenticate with password'}), reauthGoogle: text({ja:'Googleで再認証',en:'Reauthenticate with Google'}), executeDelete: text({ja:'削除を実行',en:'Delete account now'}), startDelete: text({ja:'削除手続きを始める',en:'Start account deletion'}), reauthFailed: text({ja:'再認証できませんでした。',en:'Could not reauthenticate.'}), googleReauthFailed: text({ja:'Google再認証を開始できませんでした。',en:'Could not start Google reauthentication.'}), staleSession: text({ja:'セッションが古いため、もう一度再認証してください。',en:'Your session is outdated. Reauthenticate and try again.'}), deleteFailed: text({ja:'削除できませんでした。',en:'Could not delete the account.'}),
  }
  const [languagePending,setLanguagePending]=useState<Locale|null>(null)
  const [languageError,setLanguageError]=useState('')
  const changeLanguage=async(next:Locale)=>{if(next===locale||languagePending)return;setLanguageError('');setLanguagePending(next);try{await updateAccountLanguage(next)}catch(caught){setLanguageError(locale==='ja'&&caught instanceof Error?caught.message:copy.languageFailed)}finally{setLanguagePending(null)}}
  const navigate=useNavigate()
  const [searchParams]=useSearchParams()
  const [confirming,setConfirming]=useState(searchParams.get('delete')==='confirm')
  const [reauthenticated,setReauthenticated]=useState(searchParams.get('delete')==='confirm')
  const [password,setPassword]=useState('')
  const [error,setError]=useState('')
  const [newEmail,setNewEmail]=useState('')
  const [emailPending,setEmailPending]=useState(false)
  const [emailMessage,setEmailMessage]=useState('')
  const [emailError,setEmailError]=useState('')
  const [currentPassword,setCurrentPassword]=useState('')
  const [newPassword,setNewPassword]=useState('')
  const [newPasswordConfirmation,setNewPasswordConfirmation]=useState('')
  const [passwordPending,setPasswordPending]=useState(false)
  const [passwordMessage,setPasswordMessage]=useState('')
  const [passwordError,setPasswordError]=useState('')
  const [passwordCaptchaToken,setPasswordCaptchaToken]=useState('')
  const [passwordCaptchaAttempt,setPasswordCaptchaAttempt]=useState(0)
  const [captchaToken,setCaptchaToken]=useState('')
  const [captchaAttempt,setCaptchaAttempt]=useState(0)
  const updateCaptchaToken=useCallback((token:string)=>setCaptchaToken(token),[])
  const updatePasswordCaptchaToken=useCallback((token:string)=>setPasswordCaptchaToken(token),[])
  const resetCaptcha=useCallback(()=>{setCaptchaToken('');setCaptchaAttempt((value)=>value+1)},[])
  const resetPasswordCaptcha=useCallback(()=>{setPasswordCaptchaToken('');setPasswordCaptchaAttempt((value)=>value+1)},[])
  const submitEmailChange=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();const email=newEmail.trim();setEmailError('');setEmailMessage('');if(!z.email().safeParse(email).success){setEmailError(copy.invalidEmail);return}if(email.toLowerCase()===user?.email?.toLowerCase()){setEmailError(copy.sameEmail);return}setEmailPending(true);try{await updateAccountEmail(email);setNewEmail('');setEmailMessage(copy.emailSent)}catch(caught){setEmailError(locale==='ja'&&caught instanceof Error?caught.message:copy.emailFailed)}finally{setEmailPending(false)}}
  const submitPasswordChange=async(event:React.FormEvent<HTMLFormElement>)=>{event.preventDefault();setPasswordError('');setPasswordMessage('');if(!currentPassword){setPasswordError(copy.currentPasswordRequired);return}if(!passwordMeetsRequirements(newPassword)){setPasswordError(copy.passwordRequirementsError);return}if(newPassword!==newPasswordConfirmation){setPasswordError(copy.passwordMismatch);return}if(currentPassword===newPassword){setPasswordError(copy.samePassword);return}if(!passwordCaptchaToken){setPasswordError(copy.securityRequired);return}setPasswordPending(true);try{await updateAccountPassword(currentPassword,newPassword,passwordCaptchaToken);setCurrentPassword('');setNewPassword('');setNewPasswordConfirmation('');setPasswordMessage(copy.passwordChanged)}catch(caught){setPasswordError(locale==='ja'&&caught instanceof Error?caught.message:copy.passwordFailed)}finally{setPasswordPending(false);resetPasswordCaptcha()}}
  const reauthenticate=async()=>{if(!user?.email)return;setError('');try{await signIn(user.email,password,captchaToken);setPassword('');setReauthenticated(true)}catch(caught){setError(locale==='ja'&&caught instanceof Error?caught.message:copy.reauthFailed)}finally{resetCaptcha()}}
  const deleteAccount=async()=>{setError('');try{await apiRequest('/owner-api/account',{method:'DELETE',ownerAuth:true});navigate('/')}catch(caught){if(caught instanceof ApiError&&caught.code==='REAUTHENTICATION_REQUIRED'){setReauthenticated(false);setError(copy.staleSession)}else setError(locale==='ja'&&caught instanceof Error?caught.message:copy.deleteFailed)}}
  return <div className="owner-page">
    <h1 className="sr-only">{copy.account}</h1>
    <Fades asChild inView inViewOnce holdDelay={70}>
      <section className="panel account-credentials-panel">
        <details className="account-credentials-disclosure">
          <summary><span><strong>{copy.loginInformation}</strong><small>{user?.email ?? '—'}</small></span><ChevronDown aria-hidden="true" /></summary>
          <div className="account-credentials-grid">
            <form className="form-stack account-credential-form" onSubmit={(event)=>void submitEmailChange(event)}>
              <div><h3>{copy.changeEmail}</h3><p className="field-help">{copy.currentEmail}{text({ja:'：',en:': '})}{user?.email ?? '—'}</p></div>
              <label htmlFor="account-new-email">{copy.newEmail}<input id="account-new-email" type="email" autoComplete="email" inputMode="email" value={newEmail} onChange={(event)=>setNewEmail(event.target.value)} /></label>
              {emailMessage?<Notice tone="success">{emailMessage}</Notice>:null}{emailError?<Notice tone="error">{emailError}</Notice>:null}
              <Button type="submit" busy={emailPending} disabled={!newEmail.trim()}>{copy.sendConfirmation}</Button>
            </form>
            <form className="form-stack account-credential-form" onSubmit={(event)=>void submitPasswordChange(event)}>
              <div><h3>{copy.changePassword}</h3><p className="field-help">{copy.googlePasswordHelp}</p></div>
              <label htmlFor="account-current-password">{copy.currentPassword}<input id="account-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event)=>setCurrentPassword(event.target.value)} /></label>
              <label htmlFor="account-new-password">{copy.newPassword}<input id="account-new-password" type="password" autoComplete="new-password" aria-describedby="account-password-requirements" value={newPassword} onChange={(event)=>setNewPassword(event.target.value)} /></label>
              <span id="account-password-requirements" className="field-help password-requirements">{copy.passwordRequirements}</span>
              <label htmlFor="account-new-password-confirmation">{copy.confirmPassword}<input id="account-new-password-confirmation" type="password" autoComplete="new-password" value={newPasswordConfirmation} onChange={(event)=>setNewPasswordConfirmation(event.target.value)} /></label>
              <TurnstileWidget key={passwordCaptchaAttempt} action="auth_change_password" onToken={updatePasswordCaptchaToken}/>
              {passwordMessage?<Notice tone="success">{passwordMessage}</Notice>:null}{passwordError?<Notice tone="error">{passwordError}</Notice>:null}
              <Button type="submit" busy={passwordPending} disabled={!currentPassword||!newPassword||!newPasswordConfirmation||!passwordCaptchaToken}>{copy.changePassword}</Button>
            </form>
          </div>
        </details>
      </section>
      <section className="panel account-theme-panel"><div><h2>{copy.display}</h2></div><ThemeSwitcher /></section>
      <section className="panel account-theme-panel" aria-labelledby="account-language-heading"><div><h2 id="account-language-heading">{text({ja:'言語',en:'Language'})}</h2><p className="field-help">{text({ja:'アプリで使用する言語',en:'Language used in the app'})}</p></div><div role="group" aria-label={text({ja:'言語を選択',en:'Choose language'})}><Button variant="secondary" aria-pressed={locale==='ja'} disabled={languagePending!==null} busy={languagePending==='ja'} onClick={()=>void changeLanguage('ja')}>日本語</Button><Button variant="secondary" aria-pressed={locale==='en'} disabled={languagePending!==null} busy={languagePending==='en'} onClick={()=>void changeLanguage('en')}>English</Button></div>{languageError?<Notice tone="error">{languageError}</Notice>:null}</section>
      <section className="panel account-logout-panel account-action-panel"><h2>{copy.logout}</h2><Button variant="secondary" onClick={()=>void signOut().then(()=>navigate('/login')).catch((caught:unknown)=>setError(locale==='ja'&&caught instanceof Error?caught.message:copy.logoutFailed))}>{copy.logout}</Button></section>
    </Fades>
    <Panel className={confirming ? 'danger-zone danger-zone--confirming' : 'danger-zone account-action-panel'}>
      <h2>{copy.deleteAccount}</h2>
      {confirming ? <><Notice tone="error">{copy.irreversible}</Notice>{!reauthenticated?<div className="form-stack"><label>{copy.password}<input type="password" autoComplete="current-password" value={password} onChange={(event)=>setPassword(event.target.value)} /></label><TurnstileWidget key={captchaAttempt} action="auth_reauthenticate" onToken={updateCaptchaToken}/><Button variant="secondary" disabled={!password||!captchaToken} onClick={()=>void reauthenticate()}>{copy.reauthPassword}</Button>{runtimeConfig.googleAuthEnabled ? <Button variant="secondary" onClick={()=>void signInWithGoogle('/account?delete=confirm').catch((caught:unknown)=>setError(locale==='ja'&&caught instanceof Error?caught.message:copy.googleReauthFailed))}>{copy.reauthGoogle}</Button> : null}</div>:<Button variant="danger" onClick={()=>void deleteAccount()}>{copy.executeDelete}</Button>}<Button variant="quiet" onClick={()=>{setConfirming(false);setReauthenticated(false)}}>{copy.cancel}</Button></> : <Button variant="danger" onClick={()=>setConfirming(true)}>{copy.startDelete}</Button>}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </Panel>
  </div>
}
