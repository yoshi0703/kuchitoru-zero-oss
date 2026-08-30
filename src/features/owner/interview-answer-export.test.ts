import { describe, expect, it } from 'vitest'
import { surveyAnswerColumns, surveyAnswerPairs, surveyAnswerValues, type SurveyRevisionSnapshot } from './interview-answer-export'

const snapshots: SurveyRevisionSnapshot[] = [
  {
    revision: 1,
    config: {
      version: 3, presetId: null, title: '旧', description: '旧設定', revision: 1,
      questions: [
        { id: 'q_000000000001', type: 'short_text', label: '同じ設問', required: false, maxLength: 120 },
        { id: 'q_000000000009', type: 'long_text', label: '旧設問', required: false, maxLength: 400 },
      ],
    },
  },
  {
    revision: 2,
    config: {
      version: 3, presetId: null, title: '新', description: '新設定', revision: 2,
      questions: [
        { id: 'q_000000000001', type: 'short_text', label: '同じ設問', required: false, maxLength: 120 },
        { id: 'q_000000000002', type: 'multi_choice', label: '同じ設問', required: false, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], maxSelections: 2 },
      ],
    },
  },
]

const newest = {
  survey_revision: 2,
  rating: null,
  visit_frequency: null,
  structured_answers_json: { schemaVersion: 3, answers: {
    q_000000000001: { type: 'short_text', value: '回答1' },
    q_000000000002: { type: 'multi_choice', value: ['a', 'b'] },
  } },
}

describe('survey answer history and export', () => {
  it('uses the latest revision first, appends old-only ids, and disambiguates duplicate labels', () => {
    const old = {
      survey_revision: 1,
      rating: null,
      visit_frequency: null,
      structured_answers_json: { schemaVersion: 3, answers: {
        q_000000000009: { type: 'long_text', value: '旧回答' },
      } },
    }
    const columns = surveyAnswerColumns([old, newest], snapshots, 'ja')
    expect(columns.map((column) => column.id)).toEqual(['q_000000000001', 'q_000000000002', 'q_000000000009'])
    expect(columns.map((column) => column.header)).toEqual(['同じ設問', '同じ設問 (2)', '旧設問'])
    expect(surveyAnswerValues(newest, snapshots, columns, 'ja')).toEqual({
      同じ設問: '回答1',
      '同じ設問 (2)': 'A、B',
      旧設問: '',
    })
  })

  it('shows legacy null-revision rows with the fixed five v2 questions', () => {
    const pairs = surveyAnswerPairs({
      survey_revision: null,
      rating: 3,
      visit_frequency: 'first',
      structured_answers_json: { serviceUsed: 'ランチ', positivePoints: '湯気が見えた', improvementPoints: '' },
    }, snapshots, 'ja')
    expect(pairs).toHaveLength(5)
    expect(pairs.map((pair) => pair.answer)).toEqual(['first', '3', 'ランチ', '湯気が見えた', '未回答'])
  })

  it('uses each session resolved config when variants differ within one revision', () => {
    const configA = {
      version: 3 as const, presetId: null, title: '質問', description: '説明', revision: 3,
      questions: [{ id: 'q_0000000000a1', type: 'long_text' as const, label: '印象に残った場面', required: false, maxLength: 400 as const }],
    }
    const configB = {
      version: 3 as const, presetId: null, title: '質問', description: '説明', revision: 3,
      questions: [{ id: 'q_0000000000b1', type: 'long_text' as const, label: '期待以上だったこと', required: false, maxLength: 400 as const }],
    }
    const rowA = {
      survey_revision: 3, rating: null, visit_frequency: null,
      resolved_survey_config_json: configA,
      structured_answers_json: { schemaVersion: 3, answers: { q_0000000000a1: { type: 'long_text', value: '丁寧な説明' } } },
    }
    const rowB = {
      survey_revision: 3, rating: null, visit_frequency: null,
      resolved_survey_config_json: configB,
      structured_answers_json: { schemaVersion: 3, answers: { q_0000000000b1: { type: 'long_text', value: '仕上がり' } } },
    }
    const columns = surveyAnswerColumns([rowA, rowB], [], 'ja')
    expect(columns.map((column) => column.id)).toEqual(['q_0000000000a1', 'q_0000000000b1'])
    expect(surveyAnswerValues(rowA, [], columns, 'ja')).toEqual({ 印象に残った場面: '丁寧な説明', 期待以上だったこと: '' })
    expect(surveyAnswerValues(rowB, [], columns, 'ja')).toEqual({ 印象に残った場面: '', 期待以上だったこと: '仕上がり' })
  })

  it('localizes English chrome without translating persisted Japanese source data', () => {
    const pairs = surveyAnswerPairs(newest, snapshots, 'en')
    expect(pairs.map(({ label, answer }) => ({ label, answer }))).toEqual([
      { label: '同じ設問', answer: '回答1' },
      { label: '同じ設問', answer: 'A, B' },
    ])
    const japaneseOptions = {
      ...newest,
      resolved_survey_config_json: {
        ...snapshots[1]?.config,
        questions: [{ id: 'q_000000000002', type: 'multi_choice', label: '日本語の設問', required: false, options: [{ value: 'a', label: '赤' }, { value: 'b', label: '青' }], maxSelections: 2 }],
      },
    }
    expect(surveyAnswerPairs(japaneseOptions, snapshots, 'en')[0]).toMatchObject({ label: '日本語の設問', answer: '赤, 青' })
    expect(surveyAnswerPairs({
      survey_revision: 2, rating: null, visit_frequency: null,
      structured_answers_json: { schemaVersion: 3, answers: {} },
    }, snapshots, 'en').map((pair) => pair.answer)).toEqual(['Not answered', 'Not answered'])

    const legacy = surveyAnswerPairs({
      survey_revision: null, rating: null, visit_frequency: '初めて',
      structured_answers_json: { serviceUsed: 'ランチ', memorablePoints: '未回答', improvementPoints: '' },
    }, snapshots, 'en')
    expect(legacy.map((pair) => pair.label)).toEqual([
      'Visit frequency', 'Rating', 'Product or service used', 'What stood out most', 'What could be improved or anything else to share',
    ])
    expect(legacy.map((pair) => pair.answer)).toEqual(['初めて', 'Not answered', 'ランチ', '未回答', 'Not answered'])
    const columns = surveyAnswerColumns([legacySource], snapshots, 'en')
    expect(surveyAnswerValues(legacySource, snapshots, columns, 'en')['What stood out most']).toBe('未回答')
    expect(surveyAnswerPairs({ ...newest, survey_revision: 99 }, [], 'en')[1]?.answer).toBe('a, b')
  })
})

const legacySource = {
  survey_revision: null, rating: null, visit_frequency: '初めて',
  structured_answers_json: { serviceUsed: 'ランチ', memorablePoints: '未回答', improvementPoints: '' },
}
