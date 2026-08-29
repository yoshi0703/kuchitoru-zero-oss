import { describe, expect, it } from 'vitest'
import { aggregateReviews, countReviewTopics, createGptReviewEnvelope, detectLanguageHint, diffReplyRevisions, exportGptCsv, exportGptJson, filterReviews, importGptCsv, importGptJson, interpolateReplyTemplate, reviewsByPeriod, sortReviews, tokenizeReview, type Review } from './index'

const reviews: Review[] = [
  { id: 'b', rating: 5, body: 'Great food and great service', createdAt: '2026-08-02T00:00:00Z', languageHint: 'en', reply: { id: 'r', body: 'Thanks', createdAt: '2026-08-02T02:00:00Z' } },
  { id: 'a', rating: 1, body: '料理 が おいしい', createdAt: '2026-08-01T00:00:00Z', authorName: '<Customer>' },
]
const englishReview = reviews[0] as Review
const japaneseReview = reviews[1] as Review

describe('review analytics', () => {
  it('handles empty and response-time metrics', () => {
    expect(aggregateReviews([])).toMatchObject({ count: 0, averageRating: null, responseRate: 0, medianResponseTimeMs: null, unrepliedCount: 0 })
    expect(aggregateReviews(reviews)).toMatchObject({ averageRating: 3, responseRate: 0.5, averageResponseTimeMs: 7_200_000, medianResponseTimeMs: 7_200_000, unrepliedCount: 1 })
  })
  it('groups trends deterministically', () => expect(reviewsByPeriod(reviews, 'day').map((trend) => trend.period)).toEqual(['2026-08-01', '2026-08-02']))
  it('tokenizes and counts without opaque inference', () => {
    expect(tokenizeReview('The GREAT food, great service!')).toEqual(['great', 'food', 'great', 'service'])
    expect(countReviewTopics(reviews)[0]).toEqual({ topic: 'great', count: 2 })
  })
  it('keeps ambiguous language unknown', () => {
    expect(detectLanguageHint('ok')).toBe('unknown')
    expect(detectLanguageHint('good 料理')).toBe('unknown')
  })
})

describe('inbox and authoring helpers', () => {
  it('filters and provides stable sorting', () => {
    expect(filterReviews(reviews, { ratings: [1], replyStatus: 'unreplied' }).map((item) => item.id)).toEqual(['a'])
    expect(sortReviews(reviews, 'oldest').map((item) => item.id)).toEqual(['a', 'b'])
    expect(sortReviews(reviews, 'rating-high').map((item) => item.id)).toEqual(['b', 'a'])
  })
  it('validates allowlisted fields and escapes interpolation', () => {
    expect(interpolateReplyTemplate('Hello {{authorName}}', japaneseReview).value).toBe('Hello &lt;Customer&gt;')
    expect(interpolateReplyTemplate('{{email}}', japaneseReview).errors).toHaveLength(1)
  })
  it('produces a compact revision diff', () => expect(diffReplyRevisions('Thank you!', 'Thanks!')).toEqual({ prefix: 'Thank', removed: ' you', added: 's', suffix: '!' }))
})

describe('external GPT workflow formats', () => {
  it('roundtrips a versioned JSON envelope without customer metadata', () => {
    const envelope = createGptReviewEnvelope(reviews)
    expect(envelope.items[1]).not.toHaveProperty('authorName')
    expect(importGptJson(exportGptJson(envelope))).toEqual({ envelope, errors: [] })
  })
  it('protects CSV formulas and roundtrips quoted data', () => {
    const envelope = createGptReviewEnvelope([{ ...englishReview, body: '=IMPORTXML("bad")' }])
    const csv = exportGptCsv(envelope)
    expect(csv).toContain("'=IMPORTXML")
    expect(importGptCsv(csv).envelope?.items[0]?.reviewText).toBe("'=IMPORTXML(\"bad\")")
  })
  it('reports row-level JSON and CSV validation errors', () => {
    const badJson = JSON.stringify({ schema: 'kuchitoru-zero.review-reply', version: 1, items: [{ reviewId: '', rating: 9, reviewText: 2, languageHint: 'xx' }] })
    expect(importGptJson(badJson).errors.every((error) => error.row === 1)).toBe(true)
    const csv = '"schema","version","reviewId","rating","reviewText","languageHint","suggestedReply"\r\n"bad","1","x","5","ok","en",""'
    expect(importGptCsv(csv).errors).toContainEqual({ row: 2, field: 'schema', message: 'Unsupported schema' })
  })
})
