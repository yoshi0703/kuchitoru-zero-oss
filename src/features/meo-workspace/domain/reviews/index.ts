export type ReviewLanguage = 'ja' | 'en' | 'unknown'
export type ReviewRating = 1 | 2 | 3 | 4 | 5

export interface ReviewReply {
  id: string
  body: string
  createdAt: string
  authorName?: string
}

export interface Review {
  id: string
  rating: ReviewRating
  body: string
  createdAt: string
  authorName?: string
  locationName?: string
  reply?: ReviewReply
  languageHint?: ReviewLanguage
}

export interface ReplyTemplate {
  id: string
  name: string
  body: string
  language: ReviewLanguage
  updatedAt: string
}

export interface ReplyRevision {
  id: string
  reviewId: string
  body: string
  createdAt: string
  authorName?: string
}

export interface ReviewMetrics {
  count: number
  ratingDistribution: Record<ReviewRating, number>
  averageRating: number | null
  responseRate: number
  averageResponseTimeMs: number | null
  medianResponseTimeMs: number | null
  unrepliedCount: number
}

const VALID_DATE = (value: string) => Number.isFinite(Date.parse(value))
const elapsed = (review: Review) => review.reply && VALID_DATE(review.createdAt) && VALID_DATE(review.reply.createdAt)
  ? Math.max(0, Date.parse(review.reply.createdAt) - Date.parse(review.createdAt))
  : null

export function aggregateReviews(reviews: readonly Review[]): ReviewMetrics {
  const distribution: Record<ReviewRating, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const review of reviews) distribution[review.rating]++
  const responseTimes = reviews.map(elapsed).filter((value): value is number => value !== null).sort((a, b) => a - b)
  const replied = reviews.filter((review) => review.reply).length
  const middle = Math.floor(responseTimes.length / 2)
  let median: number | null = null
  if (responseTimes.length % 2) median = responseTimes[middle] ?? null
  else if (responseTimes.length) median = ((responseTimes[middle - 1] ?? 0) + (responseTimes[middle] ?? 0)) / 2
  return {
    count: reviews.length,
    ratingDistribution: distribution,
    averageRating: reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : null,
    responseRate: reviews.length ? replied / reviews.length : 0,
    averageResponseTimeMs: responseTimes.length ? responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length : null,
    medianResponseTimeMs: median,
    unrepliedCount: reviews.length - replied,
  }
}

export type TrendPeriod = 'day' | 'week' | 'month'
export interface ReviewTrend { period: string; metrics: ReviewMetrics }

function periodKey(date: Date, period: TrendPeriod): string {
  if (period === 'day') return date.toISOString().slice(0, 10)
  if (period === 'month') return date.toISOString().slice(0, 7)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

export function reviewsByPeriod(reviews: readonly Review[], period: TrendPeriod): ReviewTrend[] {
  const groups = new Map<string, Review[]>()
  for (const review of reviews) {
    if (!VALID_DATE(review.createdAt)) continue
    const key = periodKey(new Date(review.createdAt), period)
    groups.set(key, [...(groups.get(key) ?? []), review])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => ({ period: key, metrics: aggregateReviews(values) }))
}

const EN_STOP = new Set(['a', 'an', 'and', 'are', 'at', 'for', 'from', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'with'])
const JA_STOP = new Set(['これ', 'それ', 'ため', 'です', 'ます', 'でした', 'ました', 'する', 'ある', 'いる', 'こと', 'の', 'に', 'は', 'を', 'が', 'と', 'で', 'も'])

/** Transparent tokenizer: lowercase Latin word/number runs and Japanese script runs. */
export function tokenizeReview(text: string): string[] {
  const runs = text.normalize('NFKC').toLocaleLowerCase('en-US').match(/[a-z0-9]+(?:'[a-z0-9]+)*|[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]+/gu) ?? []
  return runs.filter((token) => token.length > 1 && !EN_STOP.has(token) && !JA_STOP.has(token))
}

export interface TopicCount { topic: string; count: number }
export function countReviewTopics(reviews: readonly Review[], limit = 20): TopicCount[] {
  const counts = new Map<string, number>()
  for (const review of reviews) for (const token of tokenizeReview(review.body)) counts.set(token, (counts.get(token) ?? 0) + 1)
  return [...counts].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)).slice(0, Math.max(0, limit))
}

/** Conservative script heuristic only; this is not sentiment or model inference. */
export function detectLanguageHint(text: string): ReviewLanguage {
  const ja = (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu) ?? []).length
  const en = (text.match(/[A-Za-z]/g) ?? []).length
  const total = ja + en
  if (total < 4) return 'unknown'
  if (ja / total >= 0.7 && ja >= 3) return 'ja'
  if (en / total >= 0.85 && en >= 6) return 'en'
  return 'unknown'
}

export interface InboxFilter {
  ratings?: readonly ReviewRating[]
  replyStatus?: 'replied' | 'unreplied'
  languages?: readonly ReviewLanguage[]
  query?: string
  from?: string
  to?: string
}
export type InboxSort = 'newest' | 'oldest' | 'rating-high' | 'rating-low'

export function filterReviews(reviews: readonly Review[], filter: InboxFilter): Review[] {
  const query = filter.query?.trim().toLocaleLowerCase('en-US')
  return reviews.filter((review) => {
    const language = review.languageHint ?? detectLanguageHint(review.body)
    return (!filter.ratings?.length || filter.ratings.includes(review.rating))
      && (!filter.replyStatus || (filter.replyStatus === 'replied') === Boolean(review.reply))
      && (!filter.languages?.length || filter.languages.includes(language))
      && (!query || `${review.body} ${review.authorName ?? ''} ${review.locationName ?? ''}`.toLocaleLowerCase('en-US').includes(query))
      && (!filter.from || (VALID_DATE(review.createdAt) && Date.parse(review.createdAt) >= Date.parse(filter.from)))
      && (!filter.to || (VALID_DATE(review.createdAt) && Date.parse(review.createdAt) <= Date.parse(filter.to)))
  })
}

export function sortReviews(reviews: readonly Review[], sort: InboxSort): Review[] {
  const direction = sort === 'oldest' ? 1 : -1
  return [...reviews].sort((a, b) => {
    const primary = sort.startsWith('rating') ? (a.rating - b.rating) * (sort === 'rating-high' ? -1 : 1) : (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * direction
    return primary || a.id.localeCompare(b.id)
  })
}

export interface ReviewCursor { createdAt: string; id: string }
export function encodeReviewCursor(cursor: ReviewCursor): string { return encodeURIComponent(JSON.stringify(cursor)) }
export function decodeReviewCursor(value: string): ReviewCursor | null {
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(value))
    if (typeof parsed === 'object' && parsed !== null && 'id' in parsed && 'createdAt' in parsed && typeof parsed.id === 'string' && typeof parsed.createdAt === 'string' && VALID_DATE(parsed.createdAt)) return parsed as ReviewCursor
  } catch { /* Invalid external cursor. */ }
  return null
}
export function isAfterCursor(review: Review, cursor: ReviewCursor): boolean { return review.createdAt < cursor.createdAt || (review.createdAt === cursor.createdAt && review.id > cursor.id) }

const TEMPLATE_FIELDS = new Set(['authorName', 'locationName', 'rating'])
export interface TemplateResult { value?: string; errors: string[] }
const TEMPLATE_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeTemplateValue = (value: string) => value.replace(/[&<>"']/g, (char) => TEMPLATE_ESCAPES[char] ?? char)
export function interpolateReplyTemplate(body: string, review: Review): TemplateResult {
  const errors: string[] = []
  const value = body.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, field: string) => {
    if (!TEMPLATE_FIELDS.has(field)) { errors.push(`Unsupported template field: ${field}`); return '' }
    return escapeTemplateValue(String(review[field as 'authorName' | 'locationName' | 'rating'] ?? ''))
  })
  return errors.length ? { errors } : { value, errors }
}

export interface RevisionDiff { prefix: string; removed: string; added: string; suffix: string }
export function diffReplyRevisions(before: string, after: string): RevisionDiff {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  let end = 0
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  return { prefix: before.slice(0, start), removed: before.slice(start, before.length - end), added: after.slice(start, after.length - end), suffix: end ? before.slice(-end) : '' }
}

export const GPT_REVIEW_ENVELOPE_SCHEMA = 'kuchitoru-zero.review-reply' as const
export const GPT_REVIEW_ENVELOPE_VERSION = 1 as const
export interface GptReviewItem { reviewId: string; rating: ReviewRating; reviewText: string; languageHint: ReviewLanguage; suggestedReply?: string }
export interface GptReviewEnvelope { schema: typeof GPT_REVIEW_ENVELOPE_SCHEMA; version: typeof GPT_REVIEW_ENVELOPE_VERSION; items: GptReviewItem[] }
export interface ImportError { row: number; field: string; message: string }
export interface ImportResult { envelope?: GptReviewEnvelope; errors: ImportError[] }

/** Includes only explicitly selected review fields; author/location/customer identifiers are excluded. */
export function createGptReviewEnvelope(reviews: readonly Review[]): GptReviewEnvelope {
  return { schema: GPT_REVIEW_ENVELOPE_SCHEMA, version: GPT_REVIEW_ENVELOPE_VERSION, items: reviews.map((review) => ({ reviewId: review.id, rating: review.rating, reviewText: review.body, languageHint: review.languageHint ?? detectLanguageHint(review.body) })) }
}
export function exportGptJson(envelope: GptReviewEnvelope): string { return JSON.stringify(envelope, null, 2) }

function validateItem(value: unknown, row: number, errors: ImportError[]): GptReviewItem | null {
  if (!value || typeof value !== 'object') { errors.push({ row, field: 'item', message: 'Expected an object' }); return null }
  const item = value as Record<string, unknown>
  const output: Partial<GptReviewItem> = {}
  if (typeof item.reviewId !== 'string' || !item.reviewId) errors.push({ row, field: 'reviewId', message: 'Required string' }); else output.reviewId = item.reviewId
  if (!Number.isInteger(item.rating) || Number(item.rating) < 1 || Number(item.rating) > 5) errors.push({ row, field: 'rating', message: 'Expected integer 1-5' }); else output.rating = item.rating as ReviewRating
  if (typeof item.reviewText !== 'string') errors.push({ row, field: 'reviewText', message: 'Required string' }); else output.reviewText = item.reviewText
  if (!['ja', 'en', 'unknown'].includes(String(item.languageHint))) errors.push({ row, field: 'languageHint', message: 'Expected ja, en, or unknown' }); else output.languageHint = item.languageHint as ReviewLanguage
  if (item.suggestedReply !== undefined && typeof item.suggestedReply !== 'string') errors.push({ row, field: 'suggestedReply', message: 'Expected string' }); else if (typeof item.suggestedReply === 'string') output.suggestedReply = item.suggestedReply
  return errors.some((error) => error.row === row) ? null : output as GptReviewItem
}

export function importGptJson(input: string): ImportResult {
  let data: unknown
  try { data = JSON.parse(input) } catch { return { errors: [{ row: 0, field: 'json', message: 'Invalid JSON' }] } }
  if (!data || typeof data !== 'object') return { errors: [{ row: 0, field: 'envelope', message: 'Expected an object' }] }
  const source = data as Record<string, unknown>; const errors: ImportError[] = []
  if (source.schema !== GPT_REVIEW_ENVELOPE_SCHEMA) errors.push({ row: 0, field: 'schema', message: 'Unsupported schema' })
  if (source.version !== GPT_REVIEW_ENVELOPE_VERSION) errors.push({ row: 0, field: 'version', message: 'Unsupported version' })
  if (!Array.isArray(source.items)) errors.push({ row: 0, field: 'items', message: 'Expected an array' })
  const items = Array.isArray(source.items) ? source.items.map((item, index) => validateItem(item, index + 1, errors)).filter((item): item is GptReviewItem => item !== null) : []
  return errors.length ? { errors } : { envelope: { schema: GPT_REVIEW_ENVELOPE_SCHEMA, version: GPT_REVIEW_ENVELOPE_VERSION, items }, errors }
}

const safeCsv = (value: string) => {
  const protectedValue = /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value
  return `"${protectedValue.replace(/"/g, '""')}"`
}
export function exportGptCsv(envelope: GptReviewEnvelope): string {
  const header = ['schema', 'version', 'reviewId', 'rating', 'reviewText', 'languageHint', 'suggestedReply']
  return [header.map(safeCsv).join(','), ...envelope.items.map((item) => [envelope.schema, String(envelope.version), item.reviewId, String(item.rating), item.reviewText, item.languageHint, item.suggestedReply ?? ''].map(safeCsv).join(','))].join('\r\n')
}

function parseCsv(input: string): string[][] | null {
  const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false
  for (let index = 0; index < input.length; index++) {
    const char = input[index]
    if (quoted && char === '"' && input[index + 1] === '"') { field += '"'; index++ }
    else if (char === '"') quoted = !quoted
    else if (!quoted && char === ',') { row.push(field); field = '' }
    else if (!quoted && (char === '\n' || char === '\r')) { if (char === '\r' && input[index + 1] === '\n') index++; row.push(field); rows.push(row); row = []; field = '' }
    else field += char
  }
  if (quoted) return null
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

export function importGptCsv(input: string): ImportResult {
  const rows = parseCsv(input)
  if (!rows) return { errors: [{ row: 0, field: 'csv', message: 'Unclosed quote' }] }
  const expected = ['schema', 'version', 'reviewId', 'rating', 'reviewText', 'languageHint', 'suggestedReply']
  if (!rows.length || rows[0]?.join('\0') !== expected.join('\0')) return { errors: [{ row: 1, field: 'header', message: 'Unexpected CSV header' }] }
  const errors: ImportError[] = []; const items: GptReviewItem[] = []
  rows.slice(1).forEach((cells, index) => {
    const rowNumber = index + 2
    if (cells.length !== expected.length) { errors.push({ row: rowNumber, field: 'row', message: `Expected ${expected.length} columns` }); return }
    if (cells[0] !== GPT_REVIEW_ENVELOPE_SCHEMA) errors.push({ row: rowNumber, field: 'schema', message: 'Unsupported schema' })
    if (cells[1] !== String(GPT_REVIEW_ENVELOPE_VERSION)) errors.push({ row: rowNumber, field: 'version', message: 'Unsupported version' })
    const item = validateItem({ reviewId: cells[2], rating: Number(cells[3]), reviewText: cells[4], languageHint: cells[5], ...(cells[6] ? { suggestedReply: cells[6] } : {}) }, rowNumber, errors)
    if (item) items.push(item)
  })
  return errors.length ? { errors } : { envelope: { schema: GPT_REVIEW_ENVELOPE_SCHEMA, version: GPT_REVIEW_ENVELOPE_VERSION, items }, errors }
}
