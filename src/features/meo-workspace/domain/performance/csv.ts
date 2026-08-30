import type { RankObservation, ValidationIssue, ValidationResult } from './types'
import { validateRankObservation } from './validation'
import type { Locale } from '../../../../shared/i18n'

const HEADERS = ['id', 'store_id', 'keyword_id', 'observed_on', 'rank', 'status', 'source', 'competitor_id']

function parseRows(input: string, locale: Locale): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (quoted && character === '"' && input[index + 1] === '"') {
      cell += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (!quoted && character === ',') {
      row.push(cell)
      cell = ''
    } else if (!quoted && (character === '\n' || character === '\r')) {
      row.push(cell)
      if (row.some((value) => value !== '')) rows.push(row)
      row = []
      cell = ''
      if (character === '\r' && input[index + 1] === '\n') index += 1
    } else {
      cell += character
    }
  }
  if (quoted) throw new Error(locale === 'ja' ? 'CSVの引用符が閉じられていません' : 'The CSV contains an unclosed quoted field')
  row.push(cell)
  if (row.some((value) => value !== '')) rows.push(row)
  return rows
}

export function importManualRankCsv(input: string, locale: Locale = 'ja'): ValidationResult<RankObservation[]> {
  let rows: string[][]
  try {
    rows = parseRows(input.replace(/^\uFEFF/, ''), locale)
  } catch (error) {
    return { ok: false, issues: [{ field: 'csv', message: (error as Error).message }] }
  }
  if (rows.length === 0) return { ok: false, issues: [{ field: 'csv', message: locale === 'ja' ? 'CSVが空です' : 'The CSV is empty' }] }
  const headers = (rows.at(0) ?? []).map((value) => value.trim())
  const missing = HEADERS.filter((header) => !headers.includes(header))
  if (missing.length > 0) {
    return { ok: false, issues: missing.map((field) => ({ field, message: locale === 'ja' ? 'ヘッダーがありません' : 'Missing header' })) }
  }
  const observations: RankObservation[] = []
  const issues: ValidationIssue[] = []
  for (const [offset, columns] of rows.slice(1).entries()) {
    const get = (name: string) => (columns[headers.indexOf(name)] ?? '').trim()
    const rawRank = get('rank')
    const status = get('status')
    const candidate = {
      id: get('id'), storeId: get('store_id'), keywordId: get('keyword_id'),
      observedOn: get('observed_on'), source: 'manual' as const,
      status, rank: status === 'not_found' && rawRank === '' ? null : Number(rawRank),
      ...(get('competitor_id') ? { competitorId: get('competitor_id') } : {}),
    } as Partial<RankObservation>
    if (get('source') !== 'manual') {
      issues.push({ row: offset + 2, field: 'source', message: locale === 'ja' ? 'CSVインポートのsourceはmanualのみです' : 'CSV imports only support manual as the source' })
      continue
    }
    const result = validateRankObservation(candidate, offset + 2, locale)
    if (result.ok) observations.push(result.value)
    else issues.push(...result.issues)
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: observations }
}
