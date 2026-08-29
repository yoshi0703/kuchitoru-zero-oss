import {
  SURVEY_CONFIG_V3_SCHEMA,
  type SurveyConfigV3,
  type SurveyQuestion,
} from '../../shared/survey-config'
import type { Locale } from '../../shared/i18n'

export type StoredSurveyAnswer = {
  type: string
  value: string | string[] | number
}

export type StructuredSurveyAnswers = {
  schemaVersion: 3
  answers: Record<string, StoredSurveyAnswer>
}

export type SurveyRevisionSnapshot = {
  revision: number
  config: SurveyConfigV3
}

export type SurveyAnswerSource = {
  survey_revision: number | null
  rating: number | null
  visit_frequency: string | null
  structured_answers_json: unknown
  resolved_survey_config_json?: unknown
}

export type SurveyAnswerPair = {
  id: string
  label: string
  answer: string
  missing: boolean
}

export type SurveyAnswerColumn = {
  id: string
  label: string
  header: string
}

const LEGACY_IDS = {
  visitFrequency: 'legacy_visit_frequency',
  rating: 'legacy_rating',
  serviceUsed: 'legacy_service_used',
  memorablePoints: 'legacy_memorable_points',
  improvementPoints: 'legacy_improvement_points',
} as const

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && !Array.isArray(value) && typeof value === 'object'
    ? value as Record<string, unknown>
    : null
}

function structuredV3(value: unknown): StructuredSurveyAnswers | null {
  const object = record(value)
  const answers = record(object?.answers)
  if (object?.schemaVersion !== 3 || answers === null) return null
  return { schemaVersion: 3, answers: answers as Record<string, StoredSurveyAnswer> }
}

const localized = (locale: Locale, ja: string, en: string) => locale === 'ja' ? ja : en

function displayAnswer(question: SurveyQuestion, answer: StoredSurveyAnswer | undefined, locale: Locale): Pick<SurveyAnswerPair, 'answer' | 'missing'> {
  const missing = () => ({ answer: localized(locale, '未回答', 'Not answered'), missing: true })
  if (!answer || answer.type !== question.type) return missing()
  if (question.type === 'rating_5') {
    return typeof answer.value === 'number' ? { answer: String(answer.value), missing: false } : missing()
  }
  if (question.type === 'short_text' || question.type === 'long_text') {
    return typeof answer.value === 'string' && answer.value !== '' ? { answer: answer.value, missing: false } : missing()
  }
  const labels = new Map(question.options.map((option) => [option.value, option.label]))
  if (question.type === 'single_choice') {
    if (typeof answer.value !== 'string') return missing()
    return { answer: answer.value.startsWith('other:') ? answer.value.slice('other:'.length) : labels.get(answer.value) ?? answer.value, missing: false }
  }
  if (!Array.isArray(answer.value) || answer.value.length === 0) return missing()
  return { answer: answer.value.map((value) => labels.get(value) ?? value).join(localized(locale, '、', ', ')), missing: false }
}

function legacyAnswerPairs(source: SurveyAnswerSource, locale: Locale): SurveyAnswerPair[] {
  const labels = locale === 'ja' ? {
    visitFrequency: '来店頻度', rating: '今回の評価', serviceUsed: '利用した商品・サービス',
    memorablePoints: '今回、特に印象に残ったこと', improvementPoints: '改善してほしいことや、ほかに伝えたいこと',
  } : {
    visitFrequency: 'Visit frequency', rating: 'Rating', serviceUsed: 'Product or service used',
    memorablePoints: 'What stood out most', improvementPoints: 'What could be improved or anything else to share',
  }
  const unanswered = localized(locale, '未回答', 'Not answered')
  const answers = record(source.structured_answers_json) ?? {}
  const pair = (id: string, label: string, value: unknown): SurveyAnswerPair => typeof value === 'string' && value !== ''
    ? { id, label, answer: value, missing: false }
    : { id, label, answer: unanswered, missing: true }
  return [
    pair(LEGACY_IDS.visitFrequency, labels.visitFrequency, source.visit_frequency),
    source.rating === null ? pair(LEGACY_IDS.rating, labels.rating, null) : { id: LEGACY_IDS.rating, label: labels.rating, answer: String(source.rating), missing: false },
    pair(LEGACY_IDS.serviceUsed, labels.serviceUsed, answers.serviceUsed),
    pair(LEGACY_IDS.memorablePoints, labels.memorablePoints, typeof answers.memorablePoints === 'string' ? answers.memorablePoints : answers.positivePoints),
    pair(LEGACY_IDS.improvementPoints, labels.improvementPoints, answers.improvementPoints),
  ]
}

export function parseSurveyRevisionSnapshots(value: unknown): SurveyRevisionSnapshot[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const object = record(entry)
    const revision = object?.revision
    const parsed = SURVEY_CONFIG_V3_SCHEMA.safeParse(object?.config)
    return Number.isInteger(revision) && parsed.success
      ? [{ revision: revision as number, config: parsed.data }]
      : []
  })
}

export function surveyAnswerPairs(
  source: SurveyAnswerSource,
  snapshots: readonly SurveyRevisionSnapshot[],
  locale: Locale,
): SurveyAnswerPair[] {
  if (source.survey_revision === null) return legacyAnswerPairs(source, locale)
  const resolved = SURVEY_CONFIG_V3_SCHEMA.safeParse(source.resolved_survey_config_json)
  const config = resolved.success
    ? resolved.data
    : snapshots.find((snapshot) => snapshot.revision === source.survey_revision)?.config
  const structured = structuredV3(source.structured_answers_json)
  if (!config) {
    return Object.entries(structured?.answers ?? {}).map(([id, answer]) => ({
      id,
      label: id,
      answer: Array.isArray(answer.value) ? answer.value.join(localized(locale, '、', ', ')) : String(answer.value),
      missing: false,
    }))
  }
  return config.questions.map((question) => ({
    id: question.id,
    label: question.label,
    ...displayAnswer(question, structured?.answers[question.id], locale),
  }))
}

export function surveyAnswerColumns(
  rows: readonly SurveyAnswerSource[],
  snapshots: readonly SurveyRevisionSnapshot[],
  locale: Locale,
): SurveyAnswerColumn[] {
  const revisions = [...new Set(rows.flatMap((row) => row.survey_revision === null ? [] : [row.survey_revision]))]
    .sort((left, right) => right - left)
  const ids = new Set<string>()
  const columns: Array<{ id: string; label: string }> = []
  const append = (id: string, label: string) => {
    if (ids.has(id)) return
    ids.add(id)
    columns.push({ id, label })
  }

  for (const revision of revisions) {
    const config = snapshots.find((snapshot) => snapshot.revision === revision)?.config
    config?.questions.forEach((question) => append(question.id, question.label))
  }
  for (const row of rows) {
    surveyAnswerPairs(row, snapshots, locale).forEach((pair) => append(pair.id, pair.label))
  }

  const labelCounts = new Map<string, number>()
  return columns.map((column) => {
    const occurrence = (labelCounts.get(column.label) ?? 0) + 1
    labelCounts.set(column.label, occurrence)
    return { ...column, header: occurrence === 1 ? column.label : `${column.label} (${occurrence})` }
  })
}

export function surveyAnswerValues(
  row: SurveyAnswerSource,
  snapshots: readonly SurveyRevisionSnapshot[],
  columns: readonly SurveyAnswerColumn[],
  locale: Locale,
): Record<string, string> {
  const answers = new Map(surveyAnswerPairs(row, snapshots, locale).map((pair) => [pair.id, pair]))
  return Object.fromEntries(columns.map((column) => [column.header, answers.get(column.id)?.missing ? '' : answers.get(column.id)?.answer ?? '']))
}
