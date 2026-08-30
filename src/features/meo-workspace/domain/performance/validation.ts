import type { RankObservation, ValidationIssue, ValidationResult } from './types'
import type { Locale } from '../../../../shared/i18n'

export const MIN_RANK = 1
export const MAX_RANK = 100

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const SOURCES = new Set(['manual', 'google_business', 'owner_provider'])

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

export function validateRankObservation(
  value: Partial<RankObservation>,
  row?: number,
  locale: Locale = 'ja',
): ValidationResult<RankObservation> {
  const issues: ValidationIssue[] = []
  const issue = (field: string, message: string): ValidationIssue => ({
    field, message, ...(row === undefined ? {} : { row }),
  })
  const required = ['id', 'storeId', 'keywordId'] as const
  for (const field of required) {
    if (typeof value[field] !== 'string' || value[field].trim() === '') {
      issues.push(issue(field, locale === 'ja' ? '必須項目です' : 'This field is required'))
    }
  }
  if (typeof value.observedOn !== 'string' || !isIsoDate(value.observedOn)) {
    issues.push(issue('observedOn', locale === 'ja' ? 'YYYY-MM-DD形式の実在する日付を指定してください' : 'Enter a valid calendar date in YYYY-MM-DD format'))
  }
  if (!value.source || !SOURCES.has(value.source)) {
    issues.push(issue('source', locale === 'ja' ? '不明なデータソースです' : 'Unknown data source'))
  }
  if (value.status !== 'ranked' && value.status !== 'not_found') {
    issues.push(issue('status', locale === 'ja' ? 'rankedまたはnot_foundを指定してください' : 'Specify ranked or not_found'))
  } else if (value.status === 'ranked') {
    if (!Number.isInteger(value.rank) || (value.rank ?? 0) < MIN_RANK || (value.rank ?? 0) > MAX_RANK) {
      issues.push(issue('rank', locale === 'ja' ? `${MIN_RANK}〜${MAX_RANK}の整数を指定してください` : `Enter an integer from ${MIN_RANK} to ${MAX_RANK}`))
    }
  } else if (value.rank !== null) {
    issues.push(issue('rank', locale === 'ja' ? 'not_foundの場合、順位はnullにしてください' : 'Rank must be null when status is not_found'))
  }
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, value: value as RankObservation }
}
