export const GBP_POST_KINDS = ['UPDATE', 'EVENT', 'OFFER'] as const
export type GbpPostKind = (typeof GBP_POST_KINDS)[number]

export const GBP_CTA_TYPES = ['NONE', 'BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL'] as const
export type GbpCtaType = (typeof GBP_CTA_TYPES)[number]

export type PostCta = { type: GbpCtaType; url: string | null }
export type PostTimeWindow = { startsAt: string; endsAt: string }
export type MediaMetadata = {
  id: string
  fileName: string
  mimeType: string
  byteSize: number
  width: number
  height: number
  lastModified: number | null
  source: 'upload' | 'instagram'
  sourceUrl: string | null
  altText: string | null
}

type BasePostDraft = {
  kind: GbpPostKind
  summary: string
  hashtags: string[]
  cta: PostCta
  media: MediaMetadata[]
}
export type UpdatePostDraft = BasePostDraft & { kind: 'UPDATE'; title: null; timeWindow: null; offer: null }
export type EventPostDraft = BasePostDraft & { kind: 'EVENT'; title: string; timeWindow: PostTimeWindow; offer: null }
export type OfferPostDraft = BasePostDraft & {
  kind: 'OFFER'
  title: string
  timeWindow: PostTimeWindow
  offer: { couponCode: string | null; redeemUrl: string | null; terms: string | null }
}
export type GbpPostDraft = UpdatePostDraft | EventPostDraft | OfferPostDraft

export type PostFormInput = {
  kind?: unknown
  summary?: unknown
  title?: unknown
  hashtags?: unknown
  ctaType?: unknown
  ctaUrl?: unknown
  startsAt?: unknown
  endsAt?: unknown
  couponCode?: unknown
  redeemUrl?: unknown
  terms?: unknown
  media?: unknown
}
export type ValidationIssue = { path: string; code: string; message: string }
export type ValidationResult = { draft: GbpPostDraft | null; issues: ValidationIssue[] }
export type PostRevision = { number: number; fingerprint: string; draft: GbpPostDraft; createdAt: string }
export type PostPreview = { revisionNumber: number; revisionFingerprint: string; renderedText: string; media: MediaMetadata[] }
export type PublishConfirmation = { confirmed: boolean; previewRevisionNumber: number; previewRevisionFingerprint: string; confirmedAt: string }
export type PublishReadbackEvidence = {
  revisionNumber: number
  revisionFingerprint: string
  providerPostId: string
  providerPostUrl: string | null
  publishedAt: string
  recordedAt: string
  recordedBy: string
  method: 'manual'
}

const text = (value: unknown): string => typeof value === 'string' ? value.normalize('NFC').trim() : ''
const nullableText = (value: unknown): string | null => text(value) || null
export const countUnicodeCharacters = (value: string): number =>
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length

export function normalizeHashtags(value: unknown): string[] {
  const candidates = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,、]+/u) : []
  const seen = new Set<string>()
  const result: string[] = []
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const tag = candidate.normalize('NFKC').trim().replace(/^#+/u, '')
    if (!tag || countUnicodeCharacters(tag) > 50 || !/^[\p{L}\p{N}\p{M}_]+$/u.test(tag)) continue
    const key = tag.toLocaleLowerCase()
    if (!seen.has(key)) { seen.add(key); result.push(tag) }
    if (result.length === 10) break
  }
  return result
}

export function normalizeWebUrl(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    url.hash = ''
    return url.toString()
  } catch { return null }
}

export function mediaFingerprint(media: Pick<MediaMetadata, 'fileName' | 'mimeType' | 'byteSize' | 'width' | 'height' | 'lastModified'>): string {
  return [media.fileName.normalize('NFC').toLocaleLowerCase(), media.mimeType.toLowerCase(), media.byteSize, media.width, media.height, media.lastModified ?? ''].join('|')
}

export function dedupeMedia(media: readonly MediaMetadata[]): MediaMetadata[] {
  const seen = new Set<string>()
  return media.filter((item) => { const key = mediaFingerprint(item); if (seen.has(key)) return false; seen.add(key); return true })
}

export function validateMedia(media: readonly MediaMetadata[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (media.length > 10) issues.push({ path: 'media', code: 'too_many', message: 'Media is limited to 10 images.' })
  media.forEach((item, index) => {
    const path = `media.${index}`
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(item.mimeType.toLowerCase())) issues.push({ path, code: 'mime_type', message: 'Use JPEG, PNG, or WebP.' })
    if (!Number.isInteger(item.byteSize) || item.byteSize < 10_240 || item.byteSize > 10_000_000) issues.push({ path, code: 'byte_size', message: 'Image size must be between 10 KB and 10 MB.' })
    if (!Number.isInteger(item.width) || !Number.isInteger(item.height) || item.width < 250 || item.height < 250 || item.width > 10_000 || item.height > 10_000) issues.push({ path, code: 'dimensions', message: 'Image dimensions must be between 250 and 10,000 pixels.' })
  })
  return issues
}

const validIso = (value: string): boolean => value !== '' && Number.isFinite(Date.parse(value))
const isKind = (value: string): value is GbpPostKind => (GBP_POST_KINDS as readonly string[]).includes(value)
const isCta = (value: string): value is GbpCtaType => (GBP_CTA_TYPES as readonly string[]).includes(value)

export function normalizeAndValidatePost(input: PostFormInput): ValidationResult {
  const issues: ValidationIssue[] = []
  const kindValue = text(input.kind).toUpperCase()
  if (!isKind(kindValue)) issues.push({ path: 'kind', code: 'invalid', message: 'Select a supported post kind.' })
  const kind: GbpPostKind = isKind(kindValue) ? kindValue : 'UPDATE'
  const summary = text(input.summary)
  if (!summary) issues.push({ path: 'summary', code: 'required', message: 'Summary is required.' })
  else if (countUnicodeCharacters(summary) > 1500) issues.push({ path: 'summary', code: 'too_long', message: 'Summary must be 1,500 characters or fewer.' })
  const title = nullableText(input.title)
  if (kind !== 'UPDATE' && !title) issues.push({ path: 'title', code: 'required', message: 'Title is required for events and offers.' })
  if (title && countUnicodeCharacters(title) > 58) issues.push({ path: 'title', code: 'too_long', message: 'Title must be 58 characters or fewer.' })
  const ctaValue = text(input.ctaType).toUpperCase() || 'NONE'
  if (!isCta(ctaValue)) issues.push({ path: 'cta.type', code: 'invalid', message: 'Select a supported call to action.' })
  const ctaType: GbpCtaType = isCta(ctaValue) ? ctaValue : 'NONE'
  const ctaUrl = normalizeWebUrl(input.ctaUrl)
  if (ctaType !== 'NONE' && ctaType !== 'CALL' && !ctaUrl) issues.push({ path: 'cta.url', code: 'required', message: 'A valid HTTP(S) URL is required for this call to action.' })
  if ((ctaType === 'NONE' || ctaType === 'CALL') && text(input.ctaUrl)) issues.push({ path: 'cta.url', code: 'not_allowed', message: 'This call to action does not accept a URL.' })
  const startsAt = text(input.startsAt); const endsAt = text(input.endsAt)
  if (kind !== 'UPDATE' && (!validIso(startsAt) || !validIso(endsAt) || Date.parse(endsAt) <= Date.parse(startsAt))) issues.push({ path: 'timeWindow', code: 'invalid', message: 'A valid end time after the start time is required.' })
  const rawMedia = Array.isArray(input.media) ? input.media.filter((item): item is MediaMetadata => item !== null && typeof item === 'object') : []
  const media = dedupeMedia(rawMedia)
  issues.push(...validateMedia(media))
  const base = { kind, summary, hashtags: normalizeHashtags(input.hashtags), cta: { type: ctaType, url: ctaUrl }, media }
  let draft: GbpPostDraft
  if (kind === 'UPDATE') draft = { ...base, kind, title: null, timeWindow: null, offer: null }
  else if (kind === 'EVENT') draft = { ...base, kind, title: title ?? '', timeWindow: { startsAt, endsAt }, offer: null }
  else {
    const redeemRaw = text(input.redeemUrl); const redeemUrl = normalizeWebUrl(redeemRaw)
    if (redeemRaw && !redeemUrl) issues.push({ path: 'offer.redeemUrl', code: 'invalid_url', message: 'Redemption URL must be HTTP(S).' })
    draft = { ...base, kind, title: title ?? '', timeWindow: { startsAt, endsAt }, offer: { couponCode: nullableText(input.couponCode), redeemUrl, terms: nullableText(input.terms) } }
  }
  return { draft: issues.length ? null : draft, issues }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`
  return JSON.stringify(value)
}
function stableFingerprint(value: unknown): string {
  let hash = 2166136261
  for (const char of canonical(value)) { hash ^= char.codePointAt(0) ?? 0; hash = Math.imul(hash, 16777619) }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}
export function createPostRevision(draft: GbpPostDraft, previous: PostRevision | null, createdAt: string): PostRevision {
  if (!validIso(createdAt)) throw new Error('createdAt must be an ISO-compatible date.')
  const copy = structuredClone(draft); const fingerprint = stableFingerprint(copy)
  if (previous?.fingerprint === fingerprint) return previous
  return Object.freeze({ number: (previous?.number ?? 0) + 1, fingerprint, draft: copy, createdAt })
}
export const revisionsMatch = (left: PostRevision, right: PostRevision): boolean => left.fingerprint === right.fingerprint

export function createPostPreview(revision: PostRevision): PostPreview {
  const draft = revision.draft
  return { revisionNumber: revision.number, revisionFingerprint: revision.fingerprint, renderedText: [draft.title, draft.summary, draft.hashtags.map((tag) => `#${tag}`).join(' ')].filter(Boolean).join('\n\n'), media: structuredClone(draft.media) }
}
export function assertPublishConfirmation(preview: PostPreview, revision: PostRevision, confirmation: PublishConfirmation): void {
  if (!confirmation.confirmed || confirmation.previewRevisionNumber !== preview.revisionNumber || confirmation.previewRevisionFingerprint !== preview.revisionFingerprint || preview.revisionNumber !== revision.number || preview.revisionFingerprint !== revision.fingerprint || !validIso(confirmation.confirmedAt)) throw new Error('Publish confirmation does not match the exact current preview revision.')
}

export function validateManualPublishEvidence(evidence: PublishReadbackEvidence, revision: PostRevision): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (evidence.method !== 'manual') issues.push({ path: 'method', code: 'invalid', message: 'Only manual publish records are supported.' })
  if (evidence.revisionNumber !== revision.number || evidence.revisionFingerprint !== revision.fingerprint) issues.push({ path: 'revision', code: 'mismatch', message: 'Evidence must reference the exact published revision.' })
  if (!text(evidence.providerPostId)) issues.push({ path: 'providerPostId', code: 'required', message: 'Provider post ID is required.' })
  if (evidence.providerPostUrl !== null && !normalizeWebUrl(evidence.providerPostUrl)) issues.push({ path: 'providerPostUrl', code: 'invalid_url', message: 'Provider post URL must be HTTP(S).' })
  if (!validIso(evidence.publishedAt) || !validIso(evidence.recordedAt) || Date.parse(evidence.recordedAt) < Date.parse(evidence.publishedAt)) issues.push({ path: 'timestamps', code: 'invalid', message: 'Recorded time must be at or after the publish time.' })
  if (!text(evidence.recordedBy)) issues.push({ path: 'recordedBy', code: 'required', message: 'The recording actor is required.' })
  return issues
}

export type InstagramImportInput = { caption?: unknown; media?: unknown }
export type InstagramImportResult = { summary: string; hashtags: string[]; media: MediaMetadata[]; requiresReview: true; automaticPosting: false }
export function normalizeInstagramImport(input: InstagramImportInput): InstagramImportResult {
  const caption = text(input.caption)
  const hashtags = normalizeHashtags([...caption.matchAll(/(?:^|\s)#([\p{L}\p{N}\p{M}_]+)/gu)].map((match) => match[1]))
  const summary = caption.replace(/(?:^|\s)#[\p{L}\p{N}\p{M}_]+/gu, ' ').replace(/\s+/gu, ' ').trim()
  const media = Array.isArray(input.media) ? dedupeMedia(input.media.filter((item): item is MediaMetadata => item !== null && typeof item === 'object').map((item) => ({ ...item, source: 'instagram' as const }))) : []
  return { summary, hashtags, media, requiresReview: true, automaticPosting: false }
}

export function exportPostJson(revision: PostRevision): string { return `${JSON.stringify({ format: 'kuchitoru_zero_gbp_post', schemaVersion: 1, revision }, null, 2)}\n` }
const csvCell = (value: unknown): string => { const raw = String(value ?? ''); const safe = /^[=+\-@\t\r]/u.test(raw.trimStart()) ? `'${raw}` : raw; return `"${safe.replaceAll('"', '""')}"` }
export function exportPostCsv(revisions: readonly PostRevision[]): string {
  const rows = [['revision', 'fingerprint', 'kind', 'title', 'summary', 'hashtags'], ...revisions.map((item) => [item.number, item.fingerprint, item.draft.kind, item.draft.title, item.draft.summary, item.draft.hashtags.join(' ')])]
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}
