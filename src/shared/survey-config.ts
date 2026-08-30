import { z } from 'zod'

const questionSchema = z.object({
  label: z.string().trim().min(1).max(120),
}).strict()

const textQuestionSchema = questionSchema.extend({
  placeholder: z.string().trim().max(160),
}).strict()

const questionsSchema = z.object({
  visitFrequency: questionSchema,
  rating: questionSchema,
  serviceUsed: textQuestionSchema,
  memorablePoints: textQuestionSchema,
  improvementPoints: textQuestionSchema,
}).strict()

export const SURVEY_TEMPLATE_IDS = [
  'restaurant',
  'hair_salon',
  'treatment_clinic',
  'medical_clinic',
  'professional_services',
  'lodging',
  'retail',
  'other',
] as const

export type SurveyTemplateId = (typeof SURVEY_TEMPLATE_IDS)[number]

const surveyConfigV2BaseSchema = z.object({
  version: z.literal(2),
  templateId: z.enum(SURVEY_TEMPLATE_IDS),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(300),
  questions: questionsSchema,
}).strict()

export type SurveyConfigV2 = z.infer<typeof surveyConfigV2BaseSchema>

/** @deprecated Use SurveyConfigV3 for new code. Kept while v2 call sites are migrated. */
export type SurveyConfig = SurveyConfigV2

type SurveyTemplate = {
  id: SurveyTemplateId
  label: string
  description: string
  config: SurveyConfigV2
}

const sharedQuestions = {
  visitFrequency: { label: '来店頻度' },
  rating: { label: '今回の評価' },
  improvementPoints: {
    label: '改善してほしいことや、ほかに伝えたいこと',
    placeholder: '任意でご記入ください',
  },
}

function template(
  id: SurveyTemplateId,
  label: string,
  description: string,
  serviceUsed: { label: string; placeholder: string },
  memorablePoints: { label: string; placeholder: string },
): SurveyTemplate {
  return {
    id,
    label,
    description,
    config: {
      version: 2,
      templateId: id,
      title: 'ご利用について教えてください',
      description: '5問のかんたんアンケートです。回答をもとに口コミ文を作成します。',
      questions: {
        ...sharedQuestions,
        serviceUsed,
        memorablePoints,
      },
    },
  }
}

/**
 * Legacy v2 templates remain readable for persisted configs. New code must use
 * SURVEY_PRESETS, which are only starting points and never validation gates.
 */
export const SURVEY_TEMPLATES: readonly SurveyTemplate[] = [
  template(
    'restaurant',
    '飲食店',
    'レストラン、カフェ、居酒屋など',
    { label: '利用したメニュー・サービス', placeholder: '例：ランチセット、コース料理、テイクアウト' },
    { label: '今回、特に印象に残ったこと', placeholder: '料理、接客、雰囲気など、率直な体験をご記入ください' },
  ),
  template(
    'hair_salon',
    '美容室',
    '美容室、理容室、ネイル、サロンなど',
    { label: '利用したメニュー・サービス', placeholder: '例：カット、カラー、トリートメント' },
    { label: '今回、特に印象に残ったこと', placeholder: '仕上がり、接客、過ごしやすさなど、率直な体験をご記入ください' },
  ),
  template(
    'treatment_clinic',
    '治療院',
    '整体、接骨院、鍼灸院など',
    { label: '利用した施術・サービス', placeholder: '例：整体、鍼灸、カウンセリング' },
    { label: '今回、特に印象に残ったこと', placeholder: '説明、対応、院内の環境など、率直な体験をご記入ください' },
  ),
  template(
    'medical_clinic',
    'クリニック',
    '医院、歯科、各種クリニックなど',
    { label: '利用した診療・サービス', placeholder: '個人を特定できる情報や詳しい病状は入力しないでください' },
    { label: '今回、特に印象に残ったこと', placeholder: '説明、対応、施設の環境など、差し支えない範囲でご記入ください' },
  ),
  template(
    'professional_services',
    '士業',
    '税理士、行政書士、司法書士など',
    { label: '利用した相談・サービス', placeholder: '例：初回相談、手続きのサポート（機密情報は入力しないでください）' },
    { label: '今回、特に印象に残ったこと', placeholder: '説明、対応、相談のしやすさなど、率直な体験をご記入ください' },
  ),
  template(
    'lodging',
    '宿泊施設',
    'ホテル、旅館、民宿など',
    { label: '利用した宿泊プラン・サービス', placeholder: '例：一泊朝食付きプラン、温泉、館内サービス' },
    { label: '今回、特に印象に残ったこと', placeholder: '客室、食事、接客、設備など、率直な体験をご記入ください' },
  ),
  template(
    'retail',
    '小売店',
    '食品、雑貨、アパレルなど',
    { label: '利用した商品・サービス', placeholder: '例：購入した商品、相談、取り寄せ' },
    { label: '今回、特に印象に残ったこと', placeholder: '商品、品ぞろえ、接客など、率直な体験をご記入ください' },
  ),
  template(
    'other',
    'その他',
    '上記に当てはまらない店舗・サービス',
    { label: '利用した商品・サービス', placeholder: '今回利用した内容をご記入ください' },
    { label: '今回、特に印象に残ったこと', placeholder: '良かったこと、気になったことを含め、率直な体験をご記入ください' },
  ),
] as const

export function getSurveyTemplate(templateId: SurveyTemplateId): SurveyTemplate {
  const selected = SURVEY_TEMPLATES.find((candidate) => candidate.id === templateId)
  const fallback = SURVEY_TEMPLATES.find((candidate) => candidate.id === 'other')
  if (!fallback) throw new Error('Default survey template is missing.')
  return selected ?? fallback
}

function hasApprovedQuestions(config: SurveyConfigV2) {
  const approved = questionsSchema.parse(getSurveyTemplate(config.templateId).config.questions)
  return equalJson(config.questions, approved)
}

function equalJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => equalJson(value, right[index]))
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftObject = left as Record<string, unknown>
    const rightObject = right as Record<string, unknown>
    const leftKeys = Object.keys(leftObject).sort()
    const rightKeys = Object.keys(rightObject).sort()
    return equalJson(leftKeys, rightKeys)
      && leftKeys.every((key) => equalJson(leftObject[key], rightObject[key]))
  }
  return false
}

export const PROHIBITED_SURVEY_COPY_PATTERNS = [
  /(?:星|★)[45]|高評価|ポジティブ(?:な)?(?:口コミ|クチコミ|レビュー)|良い(?:口コミ|クチコミ|レビュー)(?:だけ|のみ)?/u,
  /(?:満足|良かった|よかった).{0,24}(?:方|人|場合)?.{0,12}(?:google|グーグル|口コミ|クチコミ|レビュー|投稿)/u,
  /(?:満足|良かった|よかった).{0,20}(?:方|人)?.{0,12}(?:だけ|のみ).{0,20}(?:回答|投稿|口コミ|クチコミ|レビュー)/u,
  /(?:不満|低評価|悪かった|満足.{0,12}(?:できな|いただけな|なかった)).{0,40}(?:回答しない|回答を控|投稿しない|投稿を控|口コミしない|レビューしない|書かない|遠慮)/u,
  /(?:口コミ|クチコミ|レビュー|投稿|回答).{0,30}(?:特典|割引|謝礼|プレゼント|クーポン|ポイント|キャッシュバック|無料券|サービス券)|(?:特典|割引|謝礼|プレゼント|クーポン|ポイント|キャッシュバック|無料券|サービス券).{0,30}(?:口コミ|クチコミ|レビュー|投稿|回答)/u,
  /(?:スタッフ名|担当者名|駅名|地域名|地名|商品名|店名|seo|キーワード|固有名詞).{0,30}(?:必ず|入れて|含めて|書いて|記載)|必ず.{0,30}(?:スタッフ名|担当者名|駅名|地域名|地名|商品名|店名|seo|キーワード|固有名詞)/u,
  /「[^」]{1,40}」.{0,30}(?:入れて|含めて|書いて|記載)/u,
  /(?:google|グーグル).{0,12}(?:口コミ|クチコミ|レビュー)?.{0,20}(?:必須|条件|前提)/u,
] as const

export const PROHIBITED_QUESTION_PATTERNS = [
  /(?:full|legal|real|maiden)name|(?:first|last|family|given)name/iu,
  /(?:phone|mobile|telephone|email|e-mail|street|home|mailing)address|postalcode|zipcode|dateofbirth|birthdate|socialsecurity|ssn/iu,
  /(?:diagnosis|medicalhistory|healthcondition|symptom|prescription|medication|allerg(?:y|ies)|testresult|patientid)/iu,
  /(?:credit|debit)?cardnumber|bankaccount|routingnumber|pin(?:number|code)?|password|passcode|authenticationcode|one-timepassword|otp/iu,
  /(?:お?名前|氏名|フルネーム|本名|ふりがな).{0,12}(?:教えて|ご記入|入力|お書き|ください)/u,
  /(?:電話番号|携帯番号|メールアドレス|連絡先|住所|郵便番号|生年月日|年齢).{0,14}(?:教えて|ご記入|入力|お書き|ください)/u,
  /(?:病名|症状|既往歴|服薬|処方|診断|持病|アレルギー|通院歴|検査結果)/u,
  /(?:会員番号|パスワード|暗証番号|認証コード|ワンタイム|カード番号|口座番号|クレジット)/u,
  /<[a-z/!][^>]*>/iu,
  /javascript:|data:text\/html|&#\d{2,}|&#x[0-9a-f]{2,}/iu,
  /(?:ignore|disregard).{0,20}(?:previous|above|prior).{0,20}instruction/iu,
  /(?:これまでの|上記の|前の).{0,10}(?:指示|命令|ルール).{0,10}(?:無視|忘れ)/u,
] as const

function normalizeSurveyCopy(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\u3000]+/gu, '')
}

export function hasProhibitedSurveyCopy(title: string, description: string): boolean {
  const normalized = normalizeSurveyCopy(`${title}\n${description}`)
  return PROHIBITED_SURVEY_COPY_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function hasProhibitedQuestionCopy(text: string): boolean {
  const normalized = normalizeSurveyCopy(text)
  return PROHIBITED_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized))
}

export const SURVEY_CONFIG_V2_SCHEMA = surveyConfigV2BaseSchema.superRefine((config, context) => {
  if (!hasApprovedQuestions(config)) {
    context.addIssue({
      code: 'custom',
      message: 'Community版では承認済みの業種テンプレートを選択してください。',
      path: ['questions'],
    })
  }
  if (hasProhibitedSurveyCopy(config.title, config.description)) {
    context.addIssue({
      code: 'custom',
      message: '評価の誘導、投稿の選別、特典、特定の語句を求める案内は設定できません。',
      path: ['description'],
    })
  }
})

const legacySurveyConfigSchema = z.object({
  version: z.literal(1),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(300),
  questions: z.object({
    visitFrequency: questionSchema,
    rating: questionSchema,
    serviceUsed: textQuestionSchema,
    positivePoints: textQuestionSchema,
    improvementPoints: textQuestionSchema,
    recommendedFor: textQuestionSchema,
  }).strict(),
}).strict()

function migrateLegacySurveyConfig(value: unknown): unknown {
  const legacy = legacySurveyConfigSchema.safeParse(value)
  if (!legacy.success) return value

  const fallback = getSurveyTemplate('other').config
  return {
    ...fallback,
    title: legacy.data.title,
    description: legacy.data.description,
  }
}

export const SURVEY_QUESTION_TYPES = [
  'short_text',
  'long_text',
  'single_choice',
  'multi_choice',
  'rating_5',
] as const

export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number]
export type SurveyQuestionRole = 'rating' | 'visit_frequency'

export const SURVEY_QUESTION_ID_PATTERN = /^q_[0-9a-f]{12}$/
export const SURVEY_QUESTION_GROUP_ID_PATTERN = /^g_[0-9a-f]{12}$/
export const SURVEY_OPTION_VALUE_PATTERN = /^[a-z0-9_]{1,24}$/

export const SURVEY_LIMITS = {
  questionsMin: 1,
  questionsMax: 12,
  variantsPerGroupMax: 4,
  variantsTotalMax: 24,
  freeTextMax: 6,
  requiredMax: 4,
  optionsMin: 2,
  optionsMax: 8,
  labelMax: 80,
  helpMax: 120,
  placeholderMax: 100,
  optionLabelMax: 30,
  shortTextAnswerMax: 120,
  longTextAnswerMax: 400,
  titleMax: 120,
  descriptionMax: 300,
  configBytesMax: 32_768,
} as const

export type SurveyOption = {
  value: string
  label: string
}

type SurveyQuestionBase = {
  id: string
  label: string
  help?: string | undefined
  required: boolean
  role?: SurveyQuestionRole | undefined
}

export type ShortTextSurveyQuestion = SurveyQuestionBase & {
  type: 'short_text'
  placeholder?: string | undefined
  maxLength: typeof SURVEY_LIMITS.shortTextAnswerMax
}

export type LongTextSurveyQuestion = SurveyQuestionBase & {
  type: 'long_text'
  placeholder?: string | undefined
  maxLength: typeof SURVEY_LIMITS.longTextAnswerMax
}

export type SingleChoiceSurveyQuestion = SurveyQuestionBase & {
  type: 'single_choice'
  options: SurveyOption[]
  allowOther: boolean
}

export type MultiChoiceSurveyQuestion = SurveyQuestionBase & {
  type: 'multi_choice'
  options: SurveyOption[]
  maxSelections: number
}

export type Rating5SurveyQuestion = SurveyQuestionBase & {
  type: 'rating_5'
  lowLabel: string
  highLabel: string
}

export type SurveyQuestion =
  | ShortTextSurveyQuestion
  | LongTextSurveyQuestion
  | SingleChoiceSurveyQuestion
  | MultiChoiceSurveyQuestion
  | Rating5SurveyQuestion

export type SurveyConfigV3 = {
  version: 3
  presetId: string | null
  title: string
  description: string
  questions: SurveyQuestion[]
  revision: number
}

type SurveyQuestionVariantBase = {
  id: string
  label: string
  help?: string | undefined
}

export type ShortTextSurveyQuestionVariant = SurveyQuestionVariantBase & {
  placeholder?: string | undefined
}

export type LongTextSurveyQuestionVariant = SurveyQuestionVariantBase & {
  placeholder?: string | undefined
}

export type SingleChoiceSurveyQuestionVariant = SurveyQuestionVariantBase & {
  options: SurveyOption[]
  allowOther: boolean
}

export type MultiChoiceSurveyQuestionVariant = SurveyQuestionVariantBase & {
  options: SurveyOption[]
  maxSelections: number
}

export type Rating5SurveyQuestionVariant = SurveyQuestionVariantBase & {
  lowLabel: string
  highLabel: string
}

type SurveyQuestionGroupBase = {
  id: string
  required: boolean
  role?: SurveyQuestionRole | undefined
}

export type ShortTextSurveyQuestionGroup = SurveyQuestionGroupBase & {
  type: 'short_text'
  variants: ShortTextSurveyQuestionVariant[]
}

export type LongTextSurveyQuestionGroup = SurveyQuestionGroupBase & {
  type: 'long_text'
  variants: LongTextSurveyQuestionVariant[]
}

export type SingleChoiceSurveyQuestionGroup = SurveyQuestionGroupBase & {
  type: 'single_choice'
  variants: SingleChoiceSurveyQuestionVariant[]
}

export type MultiChoiceSurveyQuestionGroup = SurveyQuestionGroupBase & {
  type: 'multi_choice'
  variants: MultiChoiceSurveyQuestionVariant[]
}

export type Rating5SurveyQuestionGroup = SurveyQuestionGroupBase & {
  type: 'rating_5'
  variants: Rating5SurveyQuestionVariant[]
}

export type SurveyQuestionGroup =
  | ShortTextSurveyQuestionGroup
  | LongTextSurveyQuestionGroup
  | SingleChoiceSurveyQuestionGroup
  | MultiChoiceSurveyQuestionGroup
  | Rating5SurveyQuestionGroup

export type SurveyDefinitionV4 = {
  version: 4
  presetId: string | null
  title: string
  description: string
  questionGroups: SurveyQuestionGroup[]
  revision: number
}

export type SurveyVariantSelection = {
  schemaVersion: 1
  algorithm: 'uniform_v1'
  groups: Record<string, string>
}

export type MaterializedSurveyDefinition = {
  config: SurveyConfigV3
  selection: SurveyVariantSelection
}

const surveyRoleSchema = z.enum(['rating', 'visit_frequency'])
const surveyOptionSchema = z.object({
  value: z.string().regex(SURVEY_OPTION_VALUE_PATTERN),
  label: z.string().trim().min(1).max(SURVEY_LIMITS.optionLabelMax),
}).strict()

const surveyQuestionBaseShape = {
  id: z.string().regex(SURVEY_QUESTION_ID_PATTERN),
  label: z.string().trim().min(1).max(SURVEY_LIMITS.labelMax),
  help: z.string().trim().max(SURVEY_LIMITS.helpMax).optional(),
  required: z.boolean(),
  role: surveyRoleSchema.optional(),
}

const shortTextSurveyQuestionSchema = z.object({
  ...surveyQuestionBaseShape,
  type: z.literal('short_text'),
  placeholder: z.string().trim().max(SURVEY_LIMITS.placeholderMax).optional(),
  maxLength: z.literal(SURVEY_LIMITS.shortTextAnswerMax),
}).strict()

const longTextSurveyQuestionSchema = z.object({
  ...surveyQuestionBaseShape,
  type: z.literal('long_text'),
  placeholder: z.string().trim().max(SURVEY_LIMITS.placeholderMax).optional(),
  maxLength: z.literal(SURVEY_LIMITS.longTextAnswerMax),
}).strict()

const singleChoiceSurveyQuestionSchema = z.object({
  ...surveyQuestionBaseShape,
  type: z.literal('single_choice'),
  options: z.array(surveyOptionSchema).min(SURVEY_LIMITS.optionsMin).max(SURVEY_LIMITS.optionsMax),
  allowOther: z.boolean(),
}).strict()

const multiChoiceSurveyQuestionSchema = z.object({
  ...surveyQuestionBaseShape,
  type: z.literal('multi_choice'),
  options: z.array(surveyOptionSchema).min(SURVEY_LIMITS.optionsMin).max(SURVEY_LIMITS.optionsMax),
  maxSelections: z.number().int().min(1).max(SURVEY_LIMITS.optionsMax),
}).strict()

const rating5SurveyQuestionSchema = z.object({
  ...surveyQuestionBaseShape,
  type: z.literal('rating_5'),
  lowLabel: z.string().trim().max(12),
  highLabel: z.string().trim().max(12),
}).strict()

const surveyQuestionSchema = z.discriminatedUnion('type', [
  shortTextSurveyQuestionSchema,
  longTextSurveyQuestionSchema,
  singleChoiceSurveyQuestionSchema,
  multiChoiceSurveyQuestionSchema,
  rating5SurveyQuestionSchema,
])

const surveyQuestionVariantBaseShape = {
  id: z.string().regex(SURVEY_QUESTION_ID_PATTERN),
  label: z.string().trim().min(1).max(SURVEY_LIMITS.labelMax),
  help: z.string().trim().max(SURVEY_LIMITS.helpMax).optional(),
}

const shortTextSurveyQuestionVariantSchema = z.object({
  ...surveyQuestionVariantBaseShape,
  placeholder: z.string().trim().max(SURVEY_LIMITS.placeholderMax).optional(),
}).strict()

const longTextSurveyQuestionVariantSchema = z.object({
  ...surveyQuestionVariantBaseShape,
  placeholder: z.string().trim().max(SURVEY_LIMITS.placeholderMax).optional(),
}).strict()

const singleChoiceSurveyQuestionVariantSchema = z.object({
  ...surveyQuestionVariantBaseShape,
  options: z.array(surveyOptionSchema).min(SURVEY_LIMITS.optionsMin).max(SURVEY_LIMITS.optionsMax),
  allowOther: z.boolean(),
}).strict()

const multiChoiceSurveyQuestionVariantSchema = z.object({
  ...surveyQuestionVariantBaseShape,
  options: z.array(surveyOptionSchema).min(SURVEY_LIMITS.optionsMin).max(SURVEY_LIMITS.optionsMax),
  maxSelections: z.number().int().min(1).max(SURVEY_LIMITS.optionsMax),
}).strict()

const rating5SurveyQuestionVariantSchema = z.object({
  ...surveyQuestionVariantBaseShape,
  lowLabel: z.string().trim().max(12),
  highLabel: z.string().trim().max(12),
}).strict()

const surveyQuestionGroupBaseShape = {
  id: z.string().regex(SURVEY_QUESTION_GROUP_ID_PATTERN),
  required: z.boolean(),
  role: surveyRoleSchema.optional(),
}

const surveyQuestionGroupSchema = z.discriminatedUnion('type', [
  z.object({
    ...surveyQuestionGroupBaseShape,
    type: z.literal('short_text'),
    variants: z.array(shortTextSurveyQuestionVariantSchema).min(1).max(SURVEY_LIMITS.variantsPerGroupMax),
  }).strict(),
  z.object({
    ...surveyQuestionGroupBaseShape,
    type: z.literal('long_text'),
    variants: z.array(longTextSurveyQuestionVariantSchema).min(1).max(SURVEY_LIMITS.variantsPerGroupMax),
  }).strict(),
  z.object({
    ...surveyQuestionGroupBaseShape,
    type: z.literal('single_choice'),
    variants: z.array(singleChoiceSurveyQuestionVariantSchema).min(1).max(SURVEY_LIMITS.variantsPerGroupMax),
  }).strict(),
  z.object({
    ...surveyQuestionGroupBaseShape,
    type: z.literal('multi_choice'),
    variants: z.array(multiChoiceSurveyQuestionVariantSchema).min(1).max(SURVEY_LIMITS.variantsPerGroupMax),
  }).strict(),
  z.object({
    ...surveyQuestionGroupBaseShape,
    type: z.literal('rating_5'),
    variants: z.array(rating5SurveyQuestionVariantSchema).min(1).max(SURVEY_LIMITS.variantsPerGroupMax),
  }).strict(),
])

function questionTextEntries(question: SurveyQuestion): Array<[string, string]> {
  const entries: Array<[string, string]> = [['label', question.label]]
  if (question.help !== undefined) entries.push(['help', question.help])
  if ('placeholder' in question && question.placeholder !== undefined) {
    entries.push(['placeholder', question.placeholder])
  }
  if ('options' in question) {
    question.options.forEach((option, index) => entries.push([`options.${index}.label`, option.label]))
  }
  if (question.type === 'rating_5') {
    entries.push(['lowLabel', question.lowLabel], ['highLabel', question.highLabel])
  }
  return entries
}

export const SURVEY_CONFIG_V3_SCHEMA = z.object({
  version: z.literal(3),
  presetId: z.string().nullable(),
  title: z.string().trim().min(1).max(SURVEY_LIMITS.titleMax),
  description: z.string().trim().min(1).max(SURVEY_LIMITS.descriptionMax),
  questions: z.array(surveyQuestionSchema)
    .min(SURVEY_LIMITS.questionsMin)
    .max(SURVEY_LIMITS.questionsMax),
  revision: z.number().int().min(1),
}).strict().superRefine((config, context) => {
  if (new TextEncoder().encode(JSON.stringify(config)).length > SURVEY_LIMITS.configBytesMax) {
    context.addIssue({
      code: 'custom',
      message: 'アンケート設定は32KB以内にしてください。',
      path: [],
    })
  }
  const ids = new Set<string>()
  let requiredCount = 0
  let freeTextCount = 0
  let ratingRoleCount = 0
  let visitFrequencyRoleCount = 0

  config.questions.forEach((question, questionIndex) => {
    if (ids.has(question.id)) {
      context.addIssue({ code: 'custom', message: '質問IDが重複しています。', path: ['questions', questionIndex, 'id'] })
    }
    ids.add(question.id)
    if (question.required) requiredCount += 1
    if (question.type === 'short_text' || question.type === 'long_text') freeTextCount += 1

    if (question.role === 'rating') {
      ratingRoleCount += 1
      if (question.type !== 'rating_5') {
        context.addIssue({ code: 'custom', message: '評価として集計できるのは5段階評価だけです。', path: ['questions', questionIndex, 'role'] })
      }
    }
    if (question.role === 'visit_frequency') {
      visitFrequencyRoleCount += 1
      if (question.type !== 'single_choice') {
        context.addIssue({ code: 'custom', message: '来店頻度として集計できるのは単一選択だけです。', path: ['questions', questionIndex, 'role'] })
      }
    }

    if ('options' in question) {
      const values = new Set<string>()
      question.options.forEach((option, optionIndex) => {
        if (values.has(option.value)) {
          context.addIssue({
            code: 'custom',
            message: '選択肢の値が重複しています。',
            path: ['questions', questionIndex, 'options', optionIndex, 'value'],
          })
        }
        values.add(option.value)
      })
      if (question.type === 'multi_choice' && question.maxSelections > question.options.length) {
        context.addIssue({
          code: 'custom',
          message: '複数選択の上限は選択肢数以下にしてください。',
          path: ['questions', questionIndex, 'maxSelections'],
        })
      }
    }

    for (const [fieldPath, text] of questionTextEntries(question)) {
      if (hasProhibitedSurveyCopy(text, '')) {
        context.addIssue({
          code: 'custom',
          message: '評価の誘導、投稿の選別、特典、特定の語句を求める文言は設定できません。',
          path: ['questions', questionIndex, ...fieldPath.split('.')],
        })
      }
      if (hasProhibitedQuestionCopy(text)) {
        context.addIssue({
          code: 'custom',
          message: '個人情報、機微情報、認証情報、または命令を含む設問は設定できません。',
          path: ['questions', questionIndex, ...fieldPath.split('.')],
        })
      }
    }
  })

  if (requiredCount > SURVEY_LIMITS.requiredMax) {
    context.addIssue({ code: 'custom', message: '必須の質問は4問までです。', path: ['questions'] })
  }
  if (freeTextCount > SURVEY_LIMITS.freeTextMax) {
    context.addIssue({ code: 'custom', message: '自由記述の質問は6問までです。', path: ['questions'] })
  }
  if (ratingRoleCount > 1) {
    context.addIssue({ code: 'custom', message: '評価として集計する質問は1問までです。', path: ['questions'] })
  }
  if (visitFrequencyRoleCount > 1) {
    context.addIssue({ code: 'custom', message: '来店頻度として集計する質問は1問までです。', path: ['questions'] })
  }

  for (const [field, text] of [['title', config.title], ['description', config.description]] as const) {
    if (hasProhibitedSurveyCopy(text, '')) {
      context.addIssue({
        code: 'custom',
        message: '評価の誘導、投稿の選別、特典、特定の語句を求める案内は設定できません。',
        path: [field],
      })
    }
    if (hasProhibitedQuestionCopy(text)) {
      context.addIssue({
        code: 'custom',
        message: '個人情報、機微情報、認証情報、または命令を含む文言は設定できません。',
        path: [field],
      })
    }
  }
})

function materializeQuestion(
  group: SurveyQuestionGroup,
  variant: SurveyQuestionGroup['variants'][number],
): SurveyQuestion {
  const common = {
    ...variant,
    type: group.type,
    required: group.required,
    ...(group.role === undefined ? {} : { role: group.role }),
  }
  if (group.type === 'short_text') {
    return { ...common, type: group.type, maxLength: SURVEY_LIMITS.shortTextAnswerMax } as ShortTextSurveyQuestion
  }
  if (group.type === 'long_text') {
    return { ...common, type: group.type, maxLength: SURVEY_LIMITS.longTextAnswerMax } as LongTextSurveyQuestion
  }
  return common as SurveyQuestion
}

export const SURVEY_DEFINITION_V4_SCHEMA = z.object({
  version: z.literal(4),
  presetId: z.string().nullable(),
  title: z.string().trim().min(1).max(SURVEY_LIMITS.titleMax),
  description: z.string().trim().min(1).max(SURVEY_LIMITS.descriptionMax),
  questionGroups: z.array(surveyQuestionGroupSchema)
    .min(SURVEY_LIMITS.questionsMin)
    .max(SURVEY_LIMITS.questionsMax),
  revision: z.number().int().min(1),
}).strict().superRefine((definition, context) => {
  if (new TextEncoder().encode(JSON.stringify(definition)).length > SURVEY_LIMITS.configBytesMax) {
    context.addIssue({ code: 'custom', message: 'アンケート設定は32KB以内にしてください。', path: [] })
  }

  const groupIds = new Set<string>()
  const variantIds = new Set<string>()
  let variantCount = 0
  let requiredCount = 0
  let freeTextCount = 0
  let ratingRoleCount = 0
  let visitFrequencyRoleCount = 0

  definition.questionGroups.forEach((group, groupIndex) => {
    if (groupIds.has(group.id)) {
      context.addIssue({ code: 'custom', message: '設問グループIDが重複しています。', path: ['questionGroups', groupIndex, 'id'] })
    }
    groupIds.add(group.id)
    variantCount += group.variants.length
    if (group.required) requiredCount += 1
    if (group.type === 'short_text' || group.type === 'long_text') freeTextCount += 1

    if (group.role !== undefined && group.variants.length !== 1) {
      context.addIssue({
        code: 'custom',
        message: '評価・来店頻度として集計する設問は固定質問にしてください。',
        path: ['questionGroups', groupIndex, 'variants'],
      })
    }
    if (group.role === 'rating') {
      ratingRoleCount += 1
      if (group.type !== 'rating_5') {
        context.addIssue({ code: 'custom', message: '評価として集計できるのは5段階評価だけです。', path: ['questionGroups', groupIndex, 'role'] })
      }
    }
    if (group.role === 'visit_frequency') {
      visitFrequencyRoleCount += 1
      if (group.type !== 'single_choice') {
        context.addIssue({ code: 'custom', message: '来店頻度として集計できるのは単一選択だけです。', path: ['questionGroups', groupIndex, 'role'] })
      }
    }

    group.variants.forEach((variant, variantIndex) => {
      const variantPath = ['questionGroups', groupIndex, 'variants', variantIndex] as const
      if (variantIds.has(variant.id)) {
        context.addIssue({ code: 'custom', message: '質問パターンIDが重複しています。', path: [...variantPath, 'id'] })
      }
      variantIds.add(variant.id)

      const question = materializeQuestion(group as SurveyQuestionGroup, variant)
      if ('options' in question) {
        const values = new Set<string>()
        question.options.forEach((option, optionIndex) => {
          if (values.has(option.value)) {
            context.addIssue({
              code: 'custom',
              message: '選択肢の値が重複しています。',
              path: [...variantPath, 'options', optionIndex, 'value'],
            })
          }
          values.add(option.value)
        })
        if (question.type === 'multi_choice' && question.maxSelections > question.options.length) {
          context.addIssue({
            code: 'custom',
            message: '複数選択の上限は選択肢数以下にしてください。',
            path: [...variantPath, 'maxSelections'],
          })
        }
      }

      for (const [fieldPath, text] of questionTextEntries(question)) {
        if (hasProhibitedSurveyCopy(text, '')) {
          context.addIssue({
            code: 'custom',
            message: '評価の誘導、投稿の選別、特典、特定の語句を求める文言は設定できません。',
            path: [...variantPath, ...fieldPath.split('.')],
          })
        }
        if (hasProhibitedQuestionCopy(text)) {
          context.addIssue({
            code: 'custom',
            message: '個人情報、機微情報、認証情報、または命令を含む設問は設定できません。',
            path: [...variantPath, ...fieldPath.split('.')],
          })
        }
      }
    })
  })

  if (variantCount > SURVEY_LIMITS.variantsTotalMax) {
    context.addIssue({ code: 'custom', message: '質問パターンはアンケート全体で24件までです。', path: ['questionGroups'] })
  }
  if (requiredCount > SURVEY_LIMITS.requiredMax) {
    context.addIssue({ code: 'custom', message: '必須の質問は4問までです。', path: ['questionGroups'] })
  }
  if (freeTextCount > SURVEY_LIMITS.freeTextMax) {
    context.addIssue({ code: 'custom', message: '自由記述の質問は6問までです。', path: ['questionGroups'] })
  }
  if (ratingRoleCount > 1) {
    context.addIssue({ code: 'custom', message: '評価として集計する質問は1問までです。', path: ['questionGroups'] })
  }
  if (visitFrequencyRoleCount > 1) {
    context.addIssue({ code: 'custom', message: '来店頻度として集計する質問は1問までです。', path: ['questionGroups'] })
  }

  for (const [field, text] of [['title', definition.title], ['description', definition.description]] as const) {
    if (hasProhibitedSurveyCopy(text, '')) {
      context.addIssue({
        code: 'custom',
        message: '評価の誘導、投稿の選別、特典、特定の語句を求める案内は設定できません。',
        path: [field],
      })
    }
    if (hasProhibitedQuestionCopy(text)) {
      context.addIssue({
        code: 'custom',
        message: '個人情報、機微情報、認証情報、または命令を含む文言は設定できません。',
        path: [field],
      })
    }
  }
})

const UPCAST_QUESTION_IDS = {
  visitFrequency: 'q_000000000001',
  rating: 'q_000000000002',
  serviceUsed: 'q_000000000003',
  memorablePoints: 'q_000000000004',
  improvementPoints: 'q_000000000005',
} as const

export function upcastV2ToV3(config: SurveyConfigV2): SurveyConfigV3 {
  return {
    version: 3,
    presetId: config.templateId,
    title: config.title,
    description: config.description,
    questions: [
      {
        id: UPCAST_QUESTION_IDS.visitFrequency,
        type: 'single_choice',
        label: config.questions.visitFrequency.label,
        required: false,
        role: 'visit_frequency',
        options: [
          { value: 'first', label: '初めて' },
          { value: 'occasional', label: 'ときどき' },
          { value: 'regular', label: 'よく利用する' },
          { value: 'unknown', label: '回答しない' },
        ],
        allowOther: false,
      },
      {
        id: UPCAST_QUESTION_IDS.rating,
        type: 'rating_5',
        label: config.questions.rating.label,
        required: false,
        role: 'rating',
        lowLabel: '1',
        highLabel: '5',
      },
      {
        id: UPCAST_QUESTION_IDS.serviceUsed,
        type: 'short_text',
        label: config.questions.serviceUsed.label,
        placeholder: config.questions.serviceUsed.placeholder,
        required: true,
        maxLength: SURVEY_LIMITS.shortTextAnswerMax,
      },
      {
        id: UPCAST_QUESTION_IDS.memorablePoints,
        type: 'long_text',
        label: config.questions.memorablePoints.label,
        placeholder: config.questions.memorablePoints.placeholder,
        required: true,
        maxLength: SURVEY_LIMITS.longTextAnswerMax,
      },
      {
        id: UPCAST_QUESTION_IDS.improvementPoints,
        type: 'long_text',
        label: config.questions.improvementPoints.label,
        placeholder: config.questions.improvementPoints.placeholder,
        required: false,
        maxLength: SURVEY_LIMITS.longTextAnswerMax,
      },
    ],
    revision: 1,
  }
}

function questionToVariant(question: SurveyQuestion): SurveyQuestionGroup['variants'][number] {
  const common = {
    id: question.id,
    label: question.label,
    ...(question.help === undefined ? {} : { help: question.help }),
  }
  switch (question.type) {
    case 'short_text':
    case 'long_text':
      return {
        ...common,
        ...(question.placeholder === undefined ? {} : { placeholder: question.placeholder }),
      }
    case 'single_choice':
      return { ...common, options: structuredClone(question.options), allowOther: question.allowOther }
    case 'multi_choice':
      return { ...common, options: structuredClone(question.options), maxSelections: question.maxSelections }
    case 'rating_5':
      return { ...common, lowLabel: question.lowLabel, highLabel: question.highLabel }
  }
}

export function upcastV3ToV4(config: SurveyConfigV3): SurveyDefinitionV4 {
  const questionGroups = config.questions.map((question): SurveyQuestionGroup => {
    const common = {
      id: `g_${question.id.slice(2)}`,
      required: question.required,
      ...(question.role === undefined ? {} : { role: question.role }),
    }
    const variant = questionToVariant(question)
    switch (question.type) {
      case 'short_text':
        return { ...common, type: question.type, variants: [variant as ShortTextSurveyQuestionVariant] }
      case 'long_text':
        return { ...common, type: question.type, variants: [variant as LongTextSurveyQuestionVariant] }
      case 'single_choice':
        return { ...common, type: question.type, variants: [variant as SingleChoiceSurveyQuestionVariant] }
      case 'multi_choice':
        return { ...common, type: question.type, variants: [variant as MultiChoiceSurveyQuestionVariant] }
      case 'rating_5':
        return { ...common, type: question.type, variants: [variant as Rating5SurveyQuestionVariant] }
    }
  })

  return {
    version: 4,
    presetId: config.presetId,
    title: config.title,
    description: config.description,
    questionGroups,
    revision: config.revision,
  }
}

export function upcastV2ToV4(config: SurveyConfigV2): SurveyDefinitionV4 {
  return upcastV3ToV4(upcastV2ToV3(config))
}

export function materializeSurveyDefinition(
  definition: SurveyDefinitionV4,
  random: () => number = surveyCryptoRandom,
): MaterializedSurveyDefinition {
  const parsed = SURVEY_DEFINITION_V4_SCHEMA.parse(definition)
  const groups: Record<string, string> = {}
  const questions = parsed.questionGroups.map((group) => {
    const randomValue = random()
    if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
      throw new RangeError('random must return a finite number greater than or equal to 0 and less than 1.')
    }
    const variantIndex = Math.floor(randomValue * group.variants.length)
    const variant = group.variants[variantIndex]
    if (!variant) throw new Error('Survey question group has no selectable variant.')
    groups[group.id] = variant.id
    return materializeQuestion(group, variant)
  })

  const config = SURVEY_CONFIG_V3_SCHEMA.parse({
    version: 3,
    presetId: parsed.presetId,
    title: parsed.title,
    description: parsed.description,
    questions,
    revision: parsed.revision,
  })

  return {
    config,
    selection: { schemaVersion: 1, algorithm: 'uniform_v1', groups },
  }
}

function surveyCryptoRandom(): number {
  const values = new Uint32Array(1)
  crypto.getRandomValues(values)
  return (values[0] ?? 0) / 0x1_0000_0000
}

function placeholderId(index: number): string {
  return `q_${index.toString(16).padStart(12, '0')}`
}

const deepDiveQuestions: SurveyQuestion[] = [
  {
    id: placeholderId(1),
    type: 'single_choice',
    label: '今回のご利用は何回目ですか',
    required: false,
    role: 'visit_frequency',
    options: [
      { value: 'first', label: '初めて' },
      { value: 'two_three', label: '2〜3回目' },
      { value: 'regular', label: 'よく利用している' },
      { value: 'no_answer', label: '答えない' },
    ],
    allowOther: false,
  },
  {
    id: placeholderId(2),
    type: 'rating_5',
    label: '今回の体験を5段階でいうと',
    required: false,
    role: 'rating',
    lowLabel: '物足りない',
    highLabel: 'とても良い',
  },
  {
    id: placeholderId(3),
    type: 'single_choice',
    label: '来る前に、少し気にしていたことはありましたか',
    required: false,
    options: [
      { value: 'first_time_anxiety', label: '初めてで不安だった' },
      { value: 'price_concern', label: '料金が気になっていた' },
      { value: 'fit_uncertain', label: '自分に合うか分からなかった' },
      { value: 'none', label: '特になかった' },
    ],
    allowOther: true,
  },
  {
    id: placeholderId(4),
    type: 'short_text',
    label: '今回利用したメニュー・サービスを教えてください',
    placeholder: '例：骨盤矯正、カット、ランチセット',
    required: true,
    maxLength: SURVEY_LIMITS.shortTextAnswerMax,
  },
  {
    id: placeholderId(5),
    type: 'long_text',
    label: '今回いちばん印象に残った場面を、そのときの様子がわかるように教えてください',
    help: 'うまく書けなくて大丈夫です。思い出したことをそのまま書いてください。',
    placeholder: '例：施術の前に、どこがどう歪んでいるかを模型で見せながら説明してくれた',
    required: true,
    maxLength: SURVEY_LIMITS.longTextAnswerMax,
  },
  {
    id: placeholderId(6),
    type: 'long_text',
    label: 'それは、あなたにとってどんなふうに良かった（残念だった）ですか',
    placeholder: '例：何をされるか分からない不安がなくなった',
    required: false,
    maxLength: SURVEY_LIMITS.longTextAnswerMax,
  },
  {
    id: placeholderId(7),
    type: 'short_text',
    label: 'どんな人にすすめたいですか。あえて言うなら気になった点も教えてください',
    placeholder: '例：整体が初めてで不安な人。予約は少し取りにくい',
    required: false,
    maxLength: SURVEY_LIMITS.shortTextAnswerMax,
  },
]

export const SURVEY_PRESET_IDS = [
  'deep_dive_7',
  'quick_3',
  'restaurant',
  'hair_salon',
  'treatment_clinic',
  'medical_clinic',
  'professional_services',
  'lodging',
  'retail',
  'blank',
] as const

export type SurveyPresetId = (typeof SURVEY_PRESET_IDS)[number]

export type SurveyPreset = {
  id: SurveyPresetId
  label: string
  description: string
  config: SurveyConfigV3
}

function presetConfig(presetId: SurveyPresetId, questions: SurveyQuestion[]): SurveyConfigV3 {
  return {
    version: 3,
    presetId,
    title: 'ご利用について教えてください',
    description: `${questions.length}問のかんたんなアンケートです。ご回答をもとに口コミ文の下書きを作成します。`,
    questions: structuredClone(questions),
    revision: 1,
  }
}

function industryPreset(templateId: Exclude<SurveyTemplateId, 'other'>): SurveyConfigV3 {
  const legacy = getSurveyTemplate(templateId)
  const questions = structuredClone(deepDiveQuestions)
  const serviceQuestion = questions[3]
  const memorableQuestion = questions[4]
  if (serviceQuestion?.type === 'short_text') {
    serviceQuestion.label = legacy.config.questions.serviceUsed.label
    serviceQuestion.placeholder = legacy.config.questions.serviceUsed.placeholder
  }
  if (memorableQuestion?.type === 'long_text') {
    memorableQuestion.label = legacy.config.questions.memorablePoints.label
    memorableQuestion.placeholder = legacy.config.questions.memorablePoints.placeholder
  }
  return presetConfig(templateId, questions)
}

export const SURVEY_PRESETS: readonly SurveyPreset[] = [
  { id: 'deep_dive_7', label: '深掘り7問', description: '具体的な場面と感じたことを引き出す既定の構成', config: presetConfig('deep_dive_7', deepDiveQuestions) },
  { id: 'quick_3', label: 'さくっと3問', description: '回答の負担を最小限にした構成', config: presetConfig('quick_3', [deepDiveQuestions[3], deepDiveQuestions[4], deepDiveQuestions[1]].filter((question): question is SurveyQuestion => question !== undefined)) },
  { id: 'restaurant', label: '飲食店', description: getSurveyTemplate('restaurant').description, config: industryPreset('restaurant') },
  { id: 'hair_salon', label: '美容室', description: getSurveyTemplate('hair_salon').description, config: industryPreset('hair_salon') },
  { id: 'treatment_clinic', label: '治療院', description: getSurveyTemplate('treatment_clinic').description, config: industryPreset('treatment_clinic') },
  { id: 'medical_clinic', label: 'クリニック', description: getSurveyTemplate('medical_clinic').description, config: industryPreset('medical_clinic') },
  { id: 'professional_services', label: '士業', description: getSurveyTemplate('professional_services').description, config: industryPreset('professional_services') },
  { id: 'lodging', label: '宿泊', description: getSurveyTemplate('lodging').description, config: industryPreset('lodging') },
  { id: 'retail', label: '小売', description: getSurveyTemplate('retail').description, config: industryPreset('retail') },
  {
    id: 'blank',
    label: '白紙から作る',
    description: '質問を1問ずつ自由に作る構成',
    config: presetConfig('blank', [{
      id: placeholderId(1),
      type: 'short_text',
      label: '質問文を入力してください',
      required: false,
      maxLength: SURVEY_LIMITS.shortTextAnswerMax,
    }]),
  },
] as const

for (const preset of SURVEY_PRESETS) SURVEY_CONFIG_V3_SCHEMA.parse(preset.config)

export function getSurveyPreset(presetId: SurveyPresetId): SurveyPreset {
  const selected = SURVEY_PRESETS.find((candidate) => candidate.id === presetId)
  const fallback = SURVEY_PRESETS.find((candidate) => candidate.id === 'deep_dive_7')
  if (!fallback) throw new Error('Default survey preset is missing.')
  return selected ?? fallback
}

function upcastCurrentSurveyConfig(value: unknown): unknown {
  const current = SURVEY_CONFIG_V2_SCHEMA.safeParse(value)
  return current.success ? upcastV2ToV3(current.data) : value
}

function upcastSurveyDefinition(value: unknown): unknown {
  const migrated = migrateLegacySurveyConfig(value)
  const v2 = SURVEY_CONFIG_V2_SCHEMA.safeParse(migrated)
  if (v2.success) return upcastV2ToV4(v2.data)
  const v3 = SURVEY_CONFIG_V3_SCHEMA.safeParse(migrated)
  if (v3.success) return upcastV3ToV4(v3.data)
  return migrated
}

/** Accepts v3 configs and safely upcasts persisted v1/v2 copy. */
export const SURVEY_CONFIG_SCHEMA = z.preprocess(
  (value) => upcastCurrentSurveyConfig(migrateLegacySurveyConfig(value)),
  SURVEY_CONFIG_V3_SCHEMA,
)

/** Accepts v4 definitions and safely upcasts persisted v1/v2/v3 configs. */
export const SURVEY_DEFINITION_SCHEMA = z.preprocess(
  upcastSurveyDefinition,
  SURVEY_DEFINITION_V4_SCHEMA,
)

export const DEFAULT_SURVEY_CONFIG: SurveyConfigV3 = structuredClone(
  getSurveyPreset('deep_dive_7').config,
)

/** Product-authored copy for a brand-new draft. Never apply this to persisted data. */
export function getLocalizedDefaultSurveyConfig(locale: 'ja' | 'en'): SurveyConfigV3 {
  const config = structuredClone(DEFAULT_SURVEY_CONFIG)
  if (locale === 'ja') return config
  config.title = 'Tell us about your visit'
  config.description = 'This is a short 7-question survey. We will use your answers to draft a review.'
  const copy = [
    { label: 'How many times have you visited?', options: ['This was my first time', '2–3 times', 'I visit regularly', 'Prefer not to answer'] },
    { label: 'How would you rate this experience?', lowLabel: 'Poor', highLabel: 'Excellent' },
    { label: 'Was there anything you were concerned about before your visit?', options: ['Nervous about my first visit', 'Concerned about the price', 'Unsure it would suit me', 'Nothing in particular'] },
    { label: 'What menu item or service did you use?', placeholder: 'Example: treatment, haircut, or lunch set' },
    { label: 'What moment stood out most? Please describe what happened.', help: 'It does not need to be polished. Write what you remember in your own words.', placeholder: 'Example: Before the treatment, they used a model to explain the issue clearly.' },
    { label: 'What made that good (or disappointing) for you?', placeholder: 'Example: I no longer felt anxious about what would happen.' },
    { label: 'Who would you recommend this to? You may also mention any concerns.', placeholder: 'Example: Someone nervous about their first treatment. Appointments can be hard to book.' },
  ] as const
  config.questions.forEach((question, index) => {
    const localized = copy[index]
    if (!localized) return
    question.label = localized.label
    if ('placeholder' in question && 'placeholder' in localized) question.placeholder = localized.placeholder
    if ('help' in localized) question.help = localized.help
    if ('options' in question && 'options' in localized) question.options.forEach((option, optionIndex) => { option.label = localized.options[optionIndex] ?? option.label })
    if ('lowLabel' in question && 'lowLabel' in localized) {
      question.lowLabel = localized.lowLabel
      question.highLabel = localized.highLabel
    }
  })
  return config
}

type EnglishPresetMetadata = Readonly<{ label: string; description: string }>

const ENGLISH_PRESET_METADATA: Readonly<Record<SurveyPresetId, EnglishPresetMetadata>> = {
  deep_dive_7: { label: 'In-depth: 7 questions', description: 'The standard format for drawing out specific moments and impressions' },
  quick_3: { label: 'Quick: 3 questions', description: 'A short format that minimizes the effort required to respond' },
  restaurant: { label: 'Restaurant', description: 'Restaurants, cafés, bars, and similar businesses' },
  hair_salon: { label: 'Hair salon', description: 'Hair, barber, nail, and beauty salons' },
  treatment_clinic: { label: 'Treatment clinic', description: 'Bodywork, acupuncture, chiropractic, and similar clinics' },
  medical_clinic: { label: 'Medical clinic', description: 'Medical, dental, and other healthcare clinics' },
  professional_services: { label: 'Professional services', description: 'Tax, legal, administrative, and other professional services' },
  lodging: { label: 'Lodging', description: 'Hotels, inns, guesthouses, and similar accommodations' },
  retail: { label: 'Retail', description: 'Food, household goods, apparel, and other retailers' },
  blank: { label: 'Start from blank', description: 'Build a survey freely, one question at a time' },
}

type EnglishQuestionCopy = Readonly<{
  label: string
  help?: string
  placeholder?: string
  options?: readonly string[]
  lowLabel?: string
  highLabel?: string
}>

const ENGLISH_DEEP_DIVE_QUESTION_COPY: Readonly<Record<string, EnglishQuestionCopy>> = {
  [placeholderId(1)]: { label: 'How many times have you visited?', options: ['This was my first time', '2–3 times', 'I visit regularly', 'Prefer not to answer'] },
  [placeholderId(2)]: { label: 'How would you rate this experience?', lowLabel: 'Poor', highLabel: 'Excellent' },
  [placeholderId(3)]: { label: 'Was there anything you were concerned about before your visit?', options: ['Nervous about my first visit', 'Concerned about the price', 'Unsure it would suit me', 'Nothing in particular'] },
  [placeholderId(4)]: { label: 'What menu item or service did you use?', placeholder: 'Example: treatment, haircut, or lunch set' },
  [placeholderId(5)]: { label: 'What moment stood out most? Please describe what happened.', help: 'It does not need to be polished. Write what you remember in your own words.', placeholder: 'Example: Before the treatment, they used a model to explain the issue clearly.' },
  [placeholderId(6)]: { label: 'What made that good (or disappointing) for you?', placeholder: 'Example: I no longer felt anxious about what would happen.' },
  [placeholderId(7)]: { label: 'Who would you recommend this to? You may also mention any concerns.', placeholder: 'Example: Someone nervous about their first treatment. Appointments can be hard to book.' },
}

const ENGLISH_INDUSTRY_QUESTION_COPY: Readonly<Partial<Record<SurveyPresetId, Readonly<Record<string, EnglishQuestionCopy>>>>> = {
  restaurant: {
    [placeholderId(4)]: { label: 'What menu item or service did you use?', placeholder: 'Example: lunch set, course meal, or takeout' },
    [placeholderId(5)]: { label: 'What stood out most during this visit?', help: 'It does not need to be polished. Write what you remember in your own words.', placeholder: 'Tell us candidly about the food, service, atmosphere, or anything else that stood out.' },
  },
  hair_salon: {
    [placeholderId(4)]: { label: 'What treatment or service did you receive?', placeholder: 'Example: cut, color, or conditioning treatment' },
    [placeholderId(5)]: { label: 'What stood out most during this visit?', help: 'It does not need to be polished. Write what you remember in your own words.', placeholder: 'Tell us candidly about the result, service, comfort, or anything else that stood out.' },
  },
  treatment_clinic: {
    [placeholderId(4)]: { label: 'What treatment or service did you receive?', placeholder: 'Example: bodywork, acupuncture, or consultation' },
    [placeholderId(5)]: { label: 'What stood out most during this visit?', help: 'It does not need to be polished. Write what you remember in your own words.', placeholder: 'Tell us candidly about the explanation, care, clinic environment, or anything else that stood out.' },
  },
  medical_clinic: {
    [placeholderId(4)]: { label: 'What type of care or service did you receive?', placeholder: 'Please do not include identifying information or detailed medical conditions.' },
    [placeholderId(5)]: { label: 'What stood out most during this visit?', help: 'It does not need to be polished. Write only what you are comfortable sharing.', placeholder: 'Within your comfort level, tell us about the explanation, service, or facility.' },
  },
  professional_services: {
    [placeholderId(4)]: { label: 'What consultation or service did you use?', placeholder: 'Example: initial consultation or filing support. Do not include confidential information.' },
    [placeholderId(5)]: { label: 'What stood out most about the service?', help: 'It does not need to be polished. Write what you remember in your own words.', placeholder: 'Tell us about the explanation, support, and ease of consultation.' },
  },
  lodging: {
    [placeholderId(4)]: { label: 'What accommodation plan or service did you use?', placeholder: 'Example: one-night stay with breakfast, hot spring, or hotel service' },
    [placeholderId(5)]: { label: 'What stood out most during your stay?', help: 'It does not need to be polished. Write what you remember in your own words.', placeholder: 'Tell us candidly about the room, meals, service, facilities, or anything else that stood out.' },
  },
  retail: {
    [placeholderId(4)]: { label: 'What product or service did you use?', placeholder: 'Example: a purchased item, consultation, or special order' },
    [placeholderId(5)]: { label: 'What stood out most during this visit?', help: 'It does not need to be polished. Write what you remember in your own words.', placeholder: 'Tell us candidly about the products, selection, service, or anything else that stood out.' },
  },
  blank: {
    [placeholderId(1)]: { label: 'Enter your question' },
  },
}

function overlayEnglishQuestionCopy(question: SurveyQuestion, copy: EnglishQuestionCopy): void {
  question.label = copy.label
  if ('help' in copy) question.help = copy.help
  if ('placeholder' in question && copy.placeholder !== undefined) question.placeholder = copy.placeholder
  if ('options' in question && copy.options) {
    question.options.forEach((option, index) => { option.label = copy.options?.[index] ?? option.label })
  }
  if ('lowLabel' in question && copy.lowLabel !== undefined && copy.highLabel !== undefined) {
    question.lowLabel = copy.lowLabel
    question.highLabel = copy.highLabel
  }
}

/** Localizes known product presets by overlaying copy only. Unknown runtime data is returned unchanged. */
export function getLocalizedSurveyPresets(
  locale: 'ja' | 'en',
  source: readonly SurveyPreset[] = SURVEY_PRESETS,
): SurveyPreset[] {
  if (locale === 'ja') return structuredClone([...source])
  return source.map((remotePreset) => {
    const known = SURVEY_PRESETS.find((preset) => preset.id === remotePreset.id)
    if (!known) return structuredClone(remotePreset)
    const metadata = ENGLISH_PRESET_METADATA[known.id]
    const config = structuredClone(remotePreset.config)
    config.title = 'Tell us about your visit'
    config.description = `This is a short ${config.questions.length}-question survey. We will use the answers to draft a review.`
    const industryCopy = ENGLISH_INDUSTRY_QUESTION_COPY[known.id]
    config.questions.forEach((question) => {
      const copy = industryCopy?.[question.id] ?? ENGLISH_DEEP_DIVE_QUESTION_COPY[question.id]
      if (copy) overlayEnglishQuestionCopy(question, copy)
    })
    return { id: known.id, ...metadata, config }
  })
}
