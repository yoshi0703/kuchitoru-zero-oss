import { describe, expect, it } from 'vitest'
import { DEFAULT_SURVEY_CONFIG, type SurveyConfigV3, type SurveyQuestion } from '../../shared/survey-config'
import { surveySourceContainsJapanese } from './survey-source-language'

function englishQuestion(question: SurveyQuestion): SurveyQuestion {
  const result = structuredClone(question)
  result.label = 'English question'
  if (result.help !== undefined) result.help = 'English help'
  if (result.type === 'short_text' || result.type === 'long_text') {
    if (result.placeholder !== undefined) result.placeholder = 'English placeholder'
  } else if (result.type === 'single_choice' || result.type === 'multi_choice') {
    result.options = result.options.map((option, index) => ({ ...option, label: `Option ${index + 1}` }))
  } else {
    result.lowLabel = 'Low'
    result.highLabel = 'High'
  }
  return result
}

function englishSurveyConfig(): SurveyConfigV3 {
  return {
    ...DEFAULT_SURVEY_CONFIG,
    title: 'Tell us about your visit',
    description: 'A short survey about your experience.',
    questions: DEFAULT_SURVEY_CONFIG.questions.map(englishQuestion),
  }
}

describe('surveySourceContainsJapanese', () => {
  it('finds Japanese only in store-authored survey source fields', () => {
    expect(surveySourceContainsJapanese(DEFAULT_SURVEY_CONFIG)).toBe(true)
    expect(surveySourceContainsJapanese(englishSurveyConfig())).toBe(false)
  })
})
