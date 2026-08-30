import { describe, expect, it } from 'vitest'
import {
  buildLocalBusinessJsonLd,
  canonicalizeAddress,
  canonicalizeNap,
  canonicalizePhone,
  canonicalizeUrl,
  createGptAnalysisEnvelope,
  diagnoseAioReadiness,
  exportGptAnalysisEnvelope,
  importGptAnalysisEnvelope,
  reconcileGptSuggestions,
} from './index'
import type { ListingCitation } from './types'

const baseNap = canonicalizeNap({
  name: '株式会社 クチトル',
  address: '〒100-0001 東京都千代田区千代田1丁目1番1号',
  phone: '03-1234-5678',
  url: 'https://EXAMPLE.com/shop/',
})

const citation = (overrides: Partial<ListingCitation> = {}): ListingCitation => ({
  id: 'apple',
  source: 'apple-business-connect',
  sourceLabel: 'Apple Business Connect（手動確認）',
  observedAt: '2026-08-01T00:00:00.000Z',
  nap: baseNap,
  evidenceIds: [],
  ...overrides,
})

describe('NAP canonicalization', () => {
  it('preserves originals and normalizes Japanese address and international phone notation', () => {
    const address = canonicalizeAddress('〒１００－０００１　東京都千代田区千代田１丁目１番地１号')
    expect(address.original).toContain('〒')
    expect(address.canonical).toBe('東京都千代田区千代田1-1-1')
    expect(canonicalizePhone('+81 (3) 1234-5678')).toMatchObject({ canonical: '0312345678', valid: true })
  })

  it('normalizes stable URLs and rejects non-http protocols', () => {
    expect(canonicalizeUrl('HTTPS://Example.COM/path/?b=2&a=1#top').canonical).toBe('https://example.com/path?a=1&b=2')
    expect(canonicalizeUrl('javascript:alert(1)').valid).toBe(false)
  })
})

describe('citation diagnostics', () => {
  it('provides transparent mismatch explanations', () => {
    const changed = canonicalizeNap({ name: '別店舗', address: baseNap.address.original, phone: '06-9999-9999', url: baseNap.url.original })
    const result = diagnoseAioReadiness(baseNap, [citation({ nap: changed })], new Date('2026-08-12T00:00:00Z'))
    expect(result.citations[0]?.score).toBe(50)
    expect(result.checklist.join('\n')).toContain('name: 正規化後の値が不一致')
    expect(result.disclaimer).toContain('保証しません')
  })

  it('penalizes missing and stale manually observed sources', () => {
    const missing = diagnoseAioReadiness(baseNap, [], new Date('2026-08-12T00:00:00Z'))
    expect(missing.score).toBe(0)
    expect(missing.checklist).toContain('手動で掲載元を確認し、引用台帳に追加してください。')
    const stale = diagnoseAioReadiness(baseNap, [citation({ observedAt: '2025-01-01T00:00:00Z' })], new Date('2026-08-12T00:00:00Z'))
    expect(stale.recencyScore).toBe(0)
    expect(stale.checklist.join('\n')).toContain('経過しています')
  })

  it('localizes human copy without changing diagnostic calculations or source data', () => {
    const changed = canonicalizeNap({ name: 'Mixed 株式会社', address: baseNap.address.original, phone: '06-9999-9999', url: baseNap.url.original })
    const ja = diagnoseAioReadiness(baseNap, [citation({ sourceLabel: 'Directory 東京 / Tokyo', nap: changed })], new Date('2026-08-12T00:00:00Z'))
    const en = diagnoseAioReadiness(baseNap, [citation({ sourceLabel: 'Directory 東京 / Tokyo', nap: changed })], new Date('2026-08-12T00:00:00Z'), 'en')
    expect(en).toMatchObject({ score: ja.score, sourceScore: ja.sourceScore, recencyScore: ja.recencyScore, completenessScore: ja.completenessScore })
    expect(en.citations[0]).toMatchObject({ citationId: ja.citations[0]?.citationId, score: ja.citations[0]?.score, ageDays: ja.citations[0]?.ageDays })
    expect(en.checklist.join('\n')).toContain('normalized values do not match')
    expect(en.disclaimer).toContain('does not guarantee')
    expect(ja.checklist.join('\n')).toContain('正規化後の値が不一致')
  })
})

describe('LocalBusiness JSON-LD', () => {
  it('is valid, stable, and safe in a script element', () => {
    const first = buildLocalBusinessJsonLd({ nap: baseNap, description: '</script><script>alert(1)</script>' }, '2026-08-12T00:00:00Z')
    const second = buildLocalBusinessJsonLd({ nap: baseNap, description: '</script><script>alert(1)</script>' }, '2026-08-12T00:00:00Z')
    expect(first.serialized).toBe(second.serialized)
    expect(first.serialized).not.toContain('</script>')
    expect(JSON.parse(first.serialized)).toEqual(first.jsonLd)
  })

  it('falls back from unsupported types and omits invalid fields', () => {
    const invalid = canonicalizeNap({ name: '', address: '', phone: '123', url: 'ftp://example.com' })
    const snapshot = buildLocalBusinessJsonLd({ nap: invalid, schemaType: 'Organization', imageUrl: 'javascript:bad' }, '2026-08-12T00:00:00Z')
    expect(snapshot.schemaType).toBe('LocalBusiness')
    expect(snapshot.jsonLd).toEqual({ '@context': 'https://schema.org', '@type': 'LocalBusiness' })
  })
})

describe('external GPT envelope', () => {
  it('roundtrips the versioned envelope without making a model call', () => {
    const envelope = createGptAnalysisEnvelope({ exportedAt: '2026-08-12T00:00:00Z', canonicalNap: baseNap, citations: [citation()] })
    expect(importGptAnalysisEnvelope(exportGptAnalysisEnvelope(envelope))).toEqual(envelope)
    expect(() => importGptAnalysisEnvelope('{"version":2}')).toThrow('Unsupported')
  })

  it('deterministically rejects invalid, duplicate, and unknown-target suggestions', () => {
    const envelope = createGptAnalysisEnvelope({ exportedAt: '2026-08-12T00:00:00Z', canonicalNap: baseNap, citations: [citation()] })
    const accepted = reconcileGptSuggestions(envelope, [
      { id: 'b', citationId: 'apple', field: 'phone', proposedValue: 'not-phone', rationale: 'invalid' },
      { id: 'a', citationId: 'apple', field: 'phone', proposedValue: '03-1111-2222', rationale: '台帳との整合' },
      { id: 'a', citationId: 'apple', field: 'phone', proposedValue: '03-9999-9999', rationale: 'duplicate' },
      { id: 'c', citationId: 'unknown', field: 'name', proposedValue: '店舗', rationale: 'unknown' },
    ])
    expect(accepted.map(({ id }) => id)).toEqual(['a'])
  })
})
