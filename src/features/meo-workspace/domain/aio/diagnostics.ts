import type { AioDiagnostics, CanonicalNap, CitationDiagnostic, ListingCitation } from './types'
import type { Locale } from '../../../../shared/i18n'

const FIELDS = ['name', 'address', 'phone', 'url'] as const
const DAY_MS = 86_400_000

export function compareCitation(canonical: CanonicalNap, citation: ListingCitation, now: Date, locale: Locale = 'ja'): CitationDiagnostic {
  const comparisons = FIELDS.map((field) => {
    const expected = canonical[field]
    const actual = citation.nap[field]
    const matches = expected.valid && actual.valid && expected.canonical === actual.canonical
    return {
      field,
      canonicalValue: expected.canonical,
      listingValue: actual.canonical,
      matches,
      explanation: locale === 'ja'
        ? (matches
            ? `${field}: 正規化後の値が一致しています。`
            : `${field}: 正規化後の値が不一致です（基準「${expected.canonical || '未設定'}」/掲載「${actual.canonical || '未設定'}」）。`)
        : (matches
            ? `${field}: The normalized values match.`
            : `${field}: The normalized values do not match (canonical: "${expected.canonical || 'not set'}" / listing: "${actual.canonical || 'not set'}").`),
    }
  })
  const observed = Date.parse(citation.observedAt)
  const ageDays = Number.isFinite(observed) ? Math.max(0, Math.floor((now.getTime() - observed) / DAY_MS)) : null
  const matchCount = comparisons.filter(({ matches }) => matches).length
  const issues = comparisons.filter(({ matches }) => !matches).map(({ explanation }) => explanation)
  if (ageDays === null) issues.push(locale === 'ja' ? '確認日時が無効です。' : 'The observation date is invalid.')
  else if (ageDays > 90) issues.push(locale === 'ja' ? `最終確認から${ageDays}日経過しています。` : `${ageDays} days have passed since the last observation.`)
  return { citationId: citation.id, comparisons, ageDays, score: Math.round(matchCount / FIELDS.length * 100), issues }
}

export function diagnoseAioReadiness(canonical: CanonicalNap, citations: readonly ListingCitation[], now = new Date(), locale: Locale = 'ja'): AioDiagnostics {
  const results = citations.map((citation) => compareCitation(canonical, citation, now, locale))
  const sources = new Set(citations.map(({ source }) => source))
  const sourceScore = Math.min(100, sources.size * 20)
  const fresh = results.filter(({ ageDays }) => ageDays !== null && ageDays <= 90).length
  const recencyScore = results.length === 0 ? 0 : Math.round(fresh / results.length * 100)
  const completenessScore = results.length === 0 ? 0 : Math.round(results.reduce((sum, item) => sum + item.score, 0) / results.length)
  const checklist: string[] = []
  for (const field of FIELDS) if (!canonical[field].valid) checklist.push(locale === 'ja' ? `基準${field}を有効な値で設定してください。` : `Set a valid canonical ${field} value.`)
  if (citations.length === 0) checklist.push(locale === 'ja' ? '手動で掲載元を確認し、引用台帳に追加してください。' : 'Manually verify a listing source and add it to the citation ledger.')
  if (sourceScore < 60) checklist.push(locale === 'ja' ? 'Apple Business Connect、Yahoo!/LINE PLACE、Bing Places、主要ディレクトリ等を手動確認してください。' : 'Manually verify Apple Business Connect, Yahoo!/LINE PLACE, Bing Places, and major directories.')
  if (recencyScore < 100) checklist.push(locale === 'ja' ? '90日を超えた、または日付不明の掲載情報を再確認してください。' : 'Recheck listings older than 90 days or with an unknown date.')
  for (const result of results) checklist.push(...result.issues.map((issue) => `${result.citationId}: ${issue}`))
  return {
    score: Math.round(sourceScore * 0.3 + recencyScore * 0.3 + completenessScore * 0.4),
    disclaimer: locale === 'ja'
      ? 'このスコアは手動記録に基づく準備状況の診断であり、AI回答への引用や掲載を保証しません。API同期も行いません。'
      : 'This score assesses readiness based on manual records. It does not guarantee citation or inclusion in AI answers, and it does not synchronize through APIs.',
    sourceScore, recencyScore, completenessScore, citations: results, checklist,
  }
}
