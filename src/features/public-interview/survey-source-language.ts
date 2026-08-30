import type { SurveyConfigV3, SurveyQuestion } from '../../shared/survey-config'

const JAPANESE_SCRIPT_PATTERN = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u

function questionSourceFields(question: SurveyQuestion): string[] {
  const common = [question.label, question.help ?? '']
  if (question.type === 'short_text' || question.type === 'long_text') {
    return [...common, question.placeholder ?? '']
  }
  if (question.type === 'single_choice' || question.type === 'multi_choice') {
    return [...common, ...question.options.map((option) => option.label)]
  }
  return [...common, question.lowLabel, question.highLabel]
}

/** Checks store-authored survey snapshot fields only; identifiers and customer answers are intentionally excluded. */
export function surveySourceContainsJapanese(config: SurveyConfigV3): boolean {
  const sourceFields = [
    config.title,
    config.description,
    ...config.questions.flatMap(questionSourceFields),
  ]
  return sourceFields.some((value) => JAPANESE_SCRIPT_PATTERN.test(value))
}
