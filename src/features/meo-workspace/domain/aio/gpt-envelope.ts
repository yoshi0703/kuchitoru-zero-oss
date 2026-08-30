import { canonicalizeAddress, canonicalizeName, canonicalizePhone, canonicalizeUrl } from './canonicalize'
import type { CanonicalNap, GptAnalysisEnvelope, GptSuggestion, ListingCitation, ManualAiAnswerObservation } from './types'

export function createGptAnalysisEnvelope(input: {
  exportedAt: string
  canonicalNap: CanonicalNap
  citations: readonly ListingCitation[]
  observations?: readonly ManualAiAnswerObservation[]
}): GptAnalysisEnvelope {
  return { kind: 'kuchitoru-zero.aio-analysis', version: 1, exportedAt: input.exportedAt, canonicalNap: input.canonicalNap, citations: input.citations, observations: input.observations ?? [] }
}

export const exportGptAnalysisEnvelope = (envelope: GptAnalysisEnvelope): string => JSON.stringify(envelope, null, 2)

export function importGptAnalysisEnvelope(json: string): GptAnalysisEnvelope {
  const value: unknown = JSON.parse(json)
  if (!value || typeof value !== 'object') throw new Error('Invalid GPT analysis envelope')
  const envelope = value as Partial<GptAnalysisEnvelope>
  if (envelope.kind !== 'kuchitoru-zero.aio-analysis' || envelope.version !== 1 || !envelope.canonicalNap || !Array.isArray(envelope.citations) || !Array.isArray(envelope.observations)) {
    throw new Error('Unsupported or malformed GPT analysis envelope')
  }
  return envelope as GptAnalysisEnvelope
}

const canonicalizers = { name: canonicalizeName, address: canonicalizeAddress, phone: canonicalizePhone, url: canonicalizeUrl }

export function reconcileGptSuggestions(envelope: GptAnalysisEnvelope, suggestions: readonly GptSuggestion[]): readonly GptSuggestion[] {
  const citationIds = new Set(envelope.citations.map(({ id }) => id))
  const seen = new Set<string>()
  return [...suggestions]
    .filter((suggestion) => {
      if (!suggestion.id.trim() || seen.has(suggestion.id) || !citationIds.has(suggestion.citationId) || !suggestion.rationale.trim()) return false
      const canonicalizer = canonicalizers[suggestion.field]
      if (!canonicalizer || !canonicalizer(suggestion.proposedValue).valid) return false
      seen.add(suggestion.id)
      return true
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}
