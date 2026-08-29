import type { SurveyQuestion } from '../../shared/survey-config'
import type { Locale } from '../../shared/i18n'
import { getPublicInterviewCopy } from './copy'

export type SurveyAnswerValue = string | string[] | number

type CustomQuestionFieldProps = {
  question: SurveyQuestion
  value?: SurveyAnswerValue
  onChange?: (value: SurveyAnswerValue | undefined) => void
  error?: string
  idPrefix?: string
  preview?: boolean
  locale?: Locale
}

function QuestionHeading({ question, locale }: { question: SurveyQuestion; locale: Locale }) {
  const copy = getPublicInterviewCopy(locale)
  return (
    <>
      <span>{question.label}</span>
      <em className={question.required ? 'custom-question__required' : 'custom-question__optional'}>
        {question.required ? copy.required : copy.optional}
      </em>
    </>
  )
}

export function CustomQuestionField({
  question,
  value,
  onChange,
  error,
  idPrefix = 'survey-question',
  preview = false,
  locale = 'ja',
}: CustomQuestionFieldProps) {
  const copy = getPublicInterviewCopy(locale)
  const inputId = `${idPrefix}-${question.id}`
  const helpId = question.help ? `${inputId}-help` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined

  if (question.type === 'short_text' || question.type === 'long_text') {
    const textValue = typeof value === 'string' ? value : ''
    const Input = question.type === 'long_text' ? 'textarea' : 'input'
    return (
      <div className="custom-question">
        <label htmlFor={inputId}>
          <QuestionHeading question={question} locale={locale} />
        </label>
        {question.help ? <p id={helpId} className="field-help">{question.help}</p> : null}
        <Input
          id={inputId}
          {...(question.type === 'long_text' ? { rows: 4 } : { type: 'text' })}
          value={textValue}
          placeholder={question.placeholder}
          maxLength={question.maxLength}
          required={question.required}
          readOnly={preview}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange?.(event.target.value || undefined)}
        />
        <span className="custom-question__count" aria-live="polite">
          {textValue.length} / {question.maxLength} {copy.characters}
        </span>
        {error ? <span id={errorId} className="field-error">{error}</span> : null}
      </div>
    )
  }

  if (question.type === 'rating_5') {
    return (
      <fieldset className="custom-question" aria-describedby={describedBy}>
        <legend><QuestionHeading question={question} locale={locale} /></legend>
        {question.help ? <p id={helpId} className="field-help">{question.help}</p> : null}
        <div className="custom-question__rating">
          <span>{question.lowLabel}</span>
          {[1, 2, 3, 4, 5].map((rating) => (
            <button
              key={rating}
              type="button"
              data-testid={`rating-${rating}`}
              className={value === rating ? 'is-selected' : undefined}
              aria-pressed={value === rating}
              disabled={preview}
              onClick={() => onChange?.(value === rating ? undefined : rating)}
            >
              {rating}
            </button>
          ))}
          <span>{question.highLabel}</span>
        </div>
        {error ? <span id={errorId} className="field-error">{error}</span> : null}
      </fieldset>
    )
  }

  const selectedValues = Array.isArray(value) ? value : []
  const selectedValue = typeof value === 'string' ? value : ''
  const otherValue = question.type === 'single_choice' && selectedValue.startsWith('other:')
    ? selectedValue.slice('other:'.length)
    : ''

  return (
    <fieldset
      className="custom-question"
      aria-required={question.required}
      aria-describedby={describedBy}
    >
      <legend><QuestionHeading question={question} locale={locale} /></legend>
      {question.help ? <p id={helpId} className="field-help">{question.help}</p> : null}
      <div className="custom-question__choices">
        {question.options.map((option, optionIndex) => {
          const checked = question.type === 'single_choice'
            ? selectedValue === option.value
            : selectedValues.includes(option.value)
          return (
            <label key={option.value}>
              <input
                type={question.type === 'single_choice' ? 'radio' : 'checkbox'}
                name={question.type === 'single_choice' ? inputId : undefined}
                value={option.value}
                checked={checked}
                required={question.type === 'single_choice' && question.required && optionIndex === 0}
                disabled={preview}
                onChange={(event) => {
                  if (question.type === 'single_choice') {
                    onChange?.(event.target.checked ? option.value : undefined)
                    return
                  }
                  const next = event.target.checked
                    ? [...selectedValues, option.value].slice(0, question.maxSelections)
                    : selectedValues.filter((candidate) => candidate !== option.value)
                  onChange?.(next.length > 0 ? next : undefined)
                }}
              />
              <span>{option.label}</span>
            </label>
          )
        })}
        {question.type === 'single_choice' && question.allowOther ? (
          <label>
            <input
              type="radio"
              name={inputId}
              checked={selectedValue.startsWith('other:')}
              disabled={preview}
              onChange={(event) => onChange?.(event.target.checked ? 'other:' : undefined)}
            />
            <span>{copy.other}</span>
          </label>
        ) : null}
      </div>
      {question.type === 'single_choice' && question.allowOther && selectedValue.startsWith('other:') ? (
        <input
          type="text"
          aria-label={`${question.label}${copy.otherAnswer}`}
          value={otherValue}
          maxLength={54}
          readOnly={preview}
          onChange={(event) => onChange?.(`other:${event.target.value}`)}
        />
      ) : null}
      {question.type === 'multi_choice' ? (
        <p className="field-help">{copy.maxSelections(question.maxSelections)}</p>
      ) : null}
      {error ? <span id={errorId} className="field-error">{error}</span> : null}
    </fieldset>
  )
}
