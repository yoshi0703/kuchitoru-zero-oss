export interface CanonicalField {
  original: string
  canonical: string
  valid: boolean
}

export interface CanonicalNap {
  name: CanonicalField
  address: CanonicalField
  phone: CanonicalField
  url: CanonicalField
}

export const MANUAL_CITATION_SOURCES = [
  'google-business-profile',
  'apple-business-connect',
  'yahoo-line-place',
  'bing-places',
  'major-directory',
  'other',
] as const

export type CitationSource = (typeof MANUAL_CITATION_SOURCES)[number]

export interface ListingCitation {
  id: string
  source: CitationSource
  sourceLabel: string
  listingUrl?: string
  observedAt: string
  nap: CanonicalNap
  evidenceIds: readonly string[]
  note?: string
}

export interface ManualAiAnswerObservation {
  id: string
  provider: string
  query: string
  answer: string
  observedAt: string
  citedUrls: readonly string[]
  evidenceIds: readonly string[]
}

export interface Evidence {
  id: string
  kind: 'url' | 'screenshot' | 'note'
  label: string
  value: string
  capturedAt: string
}

export interface FieldComparison {
  field: keyof CanonicalNap
  canonicalValue: string
  listingValue: string
  matches: boolean
  explanation: string
}

export interface CitationDiagnostic {
  citationId: string
  comparisons: readonly FieldComparison[]
  ageDays: number | null
  score: number
  issues: readonly string[]
}

export interface AioDiagnostics {
  score: number
  disclaimer: string
  sourceScore: number
  recencyScore: number
  completenessScore: number
  citations: readonly CitationDiagnostic[]
  checklist: readonly string[]
}

export interface JsonLdSnapshot {
  version: 1
  generatedAt: string
  schemaType: string
  jsonLd: Readonly<Record<string, unknown>>
  serialized: string
}

export interface GptSuggestion {
  id: string
  citationId: string
  field: keyof CanonicalNap
  proposedValue: string
  rationale: string
}

export interface GptAnalysisEnvelope {
  kind: 'kuchitoru-zero.aio-analysis'
  version: 1
  exportedAt: string
  canonicalNap: CanonicalNap
  citations: readonly ListingCitation[]
  observations: readonly ManualAiAnswerObservation[]
}
