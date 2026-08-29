export type ReviewAnalysisExportRow = {
  id: string
  created_at: string
  status: string
  rating: number | null
  visit_frequency: string | null
  generation_status: string
  generated_review: string | null
  edited_review: string | null
  generation_provider: string | null
  google_handoff_opened_at: string | null
  completed_at: string | null
  question_answers?: Record<string, string>
}

export type ReviewAnalysisExportInput = {
  storeName?: string | null
  exportedAt: Date
  rows: readonly ReviewAnalysisExportRow[]
}

function normalizeRow(row: ReviewAnalysisExportRow) {
  const finalReview = row.edited_review ?? row.generated_review
  return {
    row_id: row.id,
    answered_at: row.created_at,
    completed_at: row.completed_at,
    status: row.status,
    rating: row.rating,
    visit_frequency: row.visit_frequency,
    generation_status: row.generation_status,
    generation_provider: row.generation_provider,
    generated_review: row.generated_review,
    edited_review: row.edited_review,
    final_review: finalReview,
    final_review_source: row.edited_review !== null ? 'edited' : row.generated_review !== null ? 'generated' : null,
    google_handoff_opened: row.google_handoff_opened_at !== null,
    question_answers: row.question_answers ?? {},
  }
}

/**
 * Creates a data-only JSON file for use with an analysis tool selected by the owner.
 * Prompts and product instructions intentionally do not belong in this export.
 */
export function createReviewAnalysisJson({ storeName, exportedAt, rows }: ReviewAnalysisExportInput): string {
  return `${JSON.stringify({
    format: 'kuchitoru_review_analysis_export',
    schema_version: 1,
    store_name: storeName?.trim() || null,
    exported_at: exportedAt.toISOString(),
    response_count: rows.length,
    reviews: rows.map(normalizeRow),
  }, null, 2)}\n`
}
