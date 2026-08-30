import { describe, expect, it } from 'vitest'
import {
  assertPublishConfirmation, countUnicodeCharacters, createPostPreview, createPostRevision,
  dedupeMedia, exportPostCsv, mediaFingerprint, normalizeAndValidatePost, normalizeHashtags,
  normalizeInstagramImport, validateManualPublishEvidence, validateMedia, type GbpPostDraft,
  type MediaMetadata,
} from './index'

const image = (overrides: Partial<MediaMetadata> = {}): MediaMetadata => ({ id: 'm1', fileName: 'photo.jpg', mimeType: 'image/jpeg', byteSize: 20_000, width: 800, height: 600, lastModified: 1, source: 'upload', sourceUrl: null, altText: null, ...overrides })
const validInput = { summary: '新メニューです', ctaType: 'NONE', media: [image()] }
const draft = (): GbpPostDraft => {
  const result = normalizeAndValidatePost({ ...validInput, kind: 'UPDATE' }).draft
  if (!result) throw new Error('Valid test draft was unexpectedly rejected.')
  return result
}

describe('post normalization', () => {
  it.each([
    ['UPDATE', {}],
    ['EVENT', { title: '夏祭り', startsAt: '2026-08-13T10:00:00Z', endsAt: '2026-08-13T12:00:00Z' }],
    ['OFFER', { title: '割引', startsAt: '2026-08-13T10:00:00Z', endsAt: '2026-08-14T10:00:00Z', couponCode: 'SAVE10', redeemUrl: 'https://example.com/redeem#x' }],
  ])('validates %s drafts', (kind, extra) => expect(normalizeAndValidatePost({ ...validInput, kind, ...extra })).toMatchObject({ issues: [], draft: { kind } }))

  it('validates CTA URLs and event time order', () => {
    expect(normalizeAndValidatePost({ ...validInput, kind: 'UPDATE', ctaType: 'BOOK', ctaUrl: 'javascript:alert(1)' }).issues.map((issue) => issue.path)).toContain('cta.url')
    expect(normalizeAndValidatePost({ ...validInput, kind: 'EVENT', title: 'x', startsAt: '2026-08-14', endsAt: '2026-08-13' }).issues.map((issue) => issue.path)).toContain('timeWindow')
  })

  it('counts grapheme clusters rather than UTF-16 code units', () => expect(countUnicodeCharacters('👨‍👩‍👧‍👦é🇯🇵')).toBe(3))
  it('normalizes, filters, limits, and deduplicates hashtags safely', () => expect(normalizeHashtags('#Cafe cafe bad-tag 日本語')).toEqual(['Cafe', '日本語']))
})

describe('media', () => {
  it('deduplicates from metadata without file reads', () => {
    expect(mediaFingerprint(image())).toBe(mediaFingerprint(image({ id: 'other' })))
    expect(dedupeMedia([image(), image({ id: 'other' })])).toHaveLength(1)
  })
  it('enforces image type, size, and dimension constraints', () => expect(validateMedia([image({ mimeType: 'image/gif', byteSize: 1, width: 100 })]).map((issue) => issue.code)).toEqual(['mime_type', 'byte_size', 'dimensions']))
})

describe('revision confirmation', () => {
  it('invalidates confirmation whenever the preview revision changes', () => {
    const first = createPostRevision(draft(), null, '2026-08-13T00:00:00Z')
    const preview = createPostPreview(first)
    expect(() => assertPublishConfirmation(preview, first, { confirmed: true, previewRevisionNumber: first.number, previewRevisionFingerprint: first.fingerprint, confirmedAt: '2026-08-13T00:01:00Z' })).not.toThrow()
    const changed = createPostRevision({ ...draft(), summary: 'changed' }, first, '2026-08-13T00:02:00Z')
    expect(() => assertPublishConfirmation(preview, changed, { confirmed: true, previewRevisionNumber: first.number, previewRevisionFingerprint: first.fingerprint, confirmedAt: '2026-08-13T00:03:00Z' })).toThrow(/exact current preview/)
  })
  it('requires confirmed=true', () => { const revision = createPostRevision(draft(), null, '2026-08-13T00:00:00Z'); expect(() => assertPublishConfirmation(createPostPreview(revision), revision, { confirmed: false, previewRevisionNumber: revision.number, previewRevisionFingerprint: revision.fingerprint, confirmedAt: '2026-08-13T00:01:00Z' })).toThrow() })
})

describe('imports, evidence, and exports', () => {
  it('normalizes Instagram only into review-required optional input', () => expect(normalizeInstagramImport({ caption: '  Lunch! #Food #ランチ ', media: [image()] })).toMatchObject({ summary: 'Lunch!', hashtags: ['Food', 'ランチ'], media: [{ source: 'instagram' }], requiresReview: true, automaticPosting: false }))
  it('enforces manual publish readback evidence invariants', () => {
    const revision = createPostRevision(draft(), null, '2026-08-13T00:00:00Z')
    const evidence = { revisionNumber: revision.number, revisionFingerprint: revision.fingerprint, providerPostId: 'locations/1/localPosts/2', providerPostUrl: 'https://business.google.com/post/2', publishedAt: '2026-08-13T00:01:00Z', recordedAt: '2026-08-13T00:02:00Z', recordedBy: 'owner-1', method: 'manual' as const }
    expect(validateManualPublishEvidence(evidence, revision)).toEqual([])
    expect(validateManualPublishEvidence({ ...evidence, revisionNumber: 99, providerPostId: '', recordedAt: '2026-08-12' }, revision).map((issue) => issue.path)).toEqual(['revision', 'providerPostId', 'timestamps'])
  })
  it('guards CSV cells against spreadsheet formulas', () => { const revision = createPostRevision({ ...draft(), summary: '=IMPORTXML()' }, null, '2026-08-13T00:00:00Z'); expect(exportPostCsv([revision])).toContain("'=IMPORTXML()") })
})
