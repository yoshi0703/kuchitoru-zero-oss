import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
import { AnimatePresence, motion, type HTMLMotionProps } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import { ApiError } from '../../shared/api/http'
import { useI18n, type Locale } from '../../shared/i18n'
import {
  DEFAULT_SURVEY_CONFIG,
  getLocalizedDefaultSurveyConfig,
  getLocalizedSurveyPresets,
  materializeSurveyDefinition,
  SURVEY_DEFINITION_V4_SCHEMA,
  SURVEY_LIMITS,
  SURVEY_PRESETS,
  upcastV3ToV4,
  type SurveyConfigV3,
  type SurveyDefinitionV4,
  type SurveyOption,
  type SurveyPresetId,
  type SurveyQuestion,
  type SurveyQuestionGroup,
  type SurveyQuestionRole,
  type SurveyQuestionType,
} from '../../shared/survey-config'
import { Badge, Button, EmptyState, LoadingState, Notice, PageTitle, Panel, Switch } from '../../shared/ui/ui'
import { CustomQuestionField } from '../public-interview/CustomQuestionField'
import { getOwnerStore } from './owner-api'
import { getSurveyConfig, getSurveyPresets, saveSurveyConfig } from './survey-config-api'
import { ownerStorePath, useActiveStoreId } from './store-scope'

type LocalCopy = Readonly<Record<Locale, string>>
const localize = (locale: Locale, ja: string, en: string) => ({ ja, en } satisfies LocalCopy)[locale]

const ENGLISH_VALIDATION_MESSAGES: Readonly<Record<string, string>> = {
  'アンケート設定は32KB以内にしてください。': 'Survey settings must be 32 KB or less.',
  '設問グループIDが重複しています。': 'Question group IDs must be unique.',
  '評価・来店頻度として集計する設問は固定質問にしてください。': 'Rating and visit-frequency metrics must use a fixed question.',
  '評価として集計できるのは5段階評価だけです。': 'Only a 5-point rating can be used as the rating metric.',
  '来店頻度として集計できるのは単一選択だけです。': 'Only a single-choice question can be used as the visit-frequency metric.',
  '質問パターンIDが重複しています。': 'Question variant IDs must be unique.',
  '選択肢の値が重複しています。': 'Option values must be unique.',
  '複数選択の上限は選択肢数以下にしてください。': 'The selection limit cannot exceed the number of options.',
  '評価の誘導、投稿の選別、特典、特定の語句を求める文言は設定できません。': 'Review gating, incentives, and required promotional wording are not allowed.',
  '個人情報、機微情報、認証情報、または命令を含む設問は設定できません。': 'Questions must not request personal, sensitive, authentication, or instructional content.',
  '質問パターンはアンケート全体で24件までです。': 'A survey can contain up to 24 question variants.',
  '必須の質問は4問までです。': 'Up to 4 questions can be required.',
  '自由記述の質問は6問までです。': 'A survey can contain up to 6 free-text questions.',
  '評価として集計する質問は1問までです。': 'Only one question can be used as the rating metric.',
  '来店頻度として集計する質問は1問までです。': 'Only one question can be used as the visit-frequency metric.',
  '評価の誘導、投稿の選別、特典、特定の語句を求める案内は設定できません。': 'Review gating, incentives, and required promotional wording are not allowed.',
  '個人情報、機微情報、認証情報、または命令を含む文言は設定できません。': 'Personal, sensitive, authentication, or instructional content is not allowed.',
}

function validationMessage(locale: Locale, message: string): string {
  return locale === 'ja' ? message : ENGLISH_VALIDATION_MESSAGES[message] ?? 'Check this field and try again.'
}

function saveErrorMessage(locale: Locale, caught: unknown): string {
  if (locale === 'ja') return caught instanceof Error ? caught.message : 'アンケートを保存できませんでした。'
  if (caught instanceof ApiError && caught.code === 'REVISION_CONFLICT') return 'This survey was updated elsewhere. Reload it and try again.'
  if (caught instanceof ApiError && (caught.code === 'STORE_NOT_FOUND' || caught.status === 404)) return 'The store could not be found.'
  return 'Could not save the survey. Please try again.'
}

const questionTypeLabels = (locale: Locale): Record<SurveyQuestionType, string> => ({
  short_text: localize(locale, '短い文章', 'Short text'),
  long_text: localize(locale, '長い文章', 'Long text'),
  single_choice: localize(locale, '選択肢から1つ', 'Single choice'),
  multi_choice: localize(locale, '複数選択', 'Multiple choice'),
  rating_5: localize(locale, '5段階評価', '5-point rating'),
})

const addQuestionChoices = (locale: Locale): Array<{
  key: SurveyQuestionType | 'yes_no'
  label: string
  description: string
}> => [
  { key: 'short_text', label: localize(locale, '短い文章', 'Short text'), description: localize(locale, '1行の自由記述（120文字まで）', 'One-line response (up to 120 characters)') },
  { key: 'long_text', label: localize(locale, '長い文章', 'Long text'), description: localize(locale, '複数行の自由記述（400文字まで）', 'Multi-line response (up to 400 characters)') },
  { key: 'single_choice', label: localize(locale, '選択肢から1つ', 'Single choice'), description: localize(locale, 'ラジオボタン', 'Radio buttons') },
  { key: 'multi_choice', label: localize(locale, '複数選択', 'Multiple choice'), description: localize(locale, 'チェックボックス', 'Checkboxes') },
  { key: 'rating_5', label: localize(locale, '5段階評価', '5-point rating'), description: localize(locale, '1〜5のボタン', 'Buttons from 1 to 5') },
  { key: 'yes_no', label: localize(locale, 'はい / いいえ', 'Yes / No'), description: localize(locale, '「選択肢から1つ」の2択プリセット', 'A two-option single-choice preset') },
]

type SurveyMotionSectionProps = Omit<HTMLMotionProps<'section'>, 'children'> & {
  children?: ReactNode
}

function SurveyMotionSection(props: SurveyMotionSectionProps) {
  if (import.meta.env.MODE !== 'test') return <motion.section {...props} />
  const { children, layout, initial, animate, exit, transition, ...domProps } = props
  void layout
  void initial
  void animate
  void exit
  void transition
  return <section {...(domProps as unknown as ComponentProps<'section'>)}>{children}</section>
}

type SurveyMotionDivProps = Omit<HTMLMotionProps<'div'>, 'children'> & {
  children?: ReactNode
}

function SurveyMotionDiv(props: SurveyMotionDivProps) {
  if (import.meta.env.MODE !== 'test') return <motion.div {...props} />
  const { children, layout, initial, animate, exit, transition, ...domProps } = props
  void layout
  void initial
  void animate
  void exit
  void transition
  return <div {...(domProps as unknown as ComponentProps<'div'>)}>{children}</div>
}

type SurveyVariant = SurveyQuestionGroup['variants'][number]

function temporaryQuestionId(): string {
  return `q_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
}

function temporaryGroupId(): string {
  return `g_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
}

function defaultOptions(locale: Locale): SurveyOption[] {
  return [
    { value: 'option_1', label: localize(locale, '選択肢 1', 'Option 1') },
    { value: 'option_2', label: localize(locale, '選択肢 2', 'Option 2') },
  ]
}

function createQuestion(type: SurveyQuestionType | 'yes_no', locale: Locale): SurveyQuestion {
  const common = { id: temporaryQuestionId(), label: localize(locale, '新しい質問', 'New question'), required: false }
  if (type === 'short_text') return { ...common, type, maxLength: 120 }
  if (type === 'long_text') return { ...common, type, maxLength: 400 }
  if (type === 'rating_5') return { ...common, type, lowLabel: localize(locale, '物足りない', 'Poor'), highLabel: localize(locale, 'とても良い', 'Excellent') }
  if (type === 'multi_choice') return { ...common, type, options: defaultOptions(locale), maxSelections: 2 }
  return {
    ...common,
    type: 'single_choice',
    options: type === 'yes_no'
      ? [{ value: 'yes', label: localize(locale, 'はい', 'Yes') }, { value: 'no', label: localize(locale, 'いいえ', 'No') }]
      : defaultOptions(locale),
    allowOther: false,
  }
}

function groupFromQuestion(question: SurveyQuestion): SurveyQuestionGroup {
  const definition = upcastV3ToV4({
    ...structuredClone(DEFAULT_SURVEY_CONFIG),
    presetId: null,
    questions: [question],
  })
  const group = definition.questionGroups[0]
  if (!group) throw new Error('Question group could not be created.')
  return { ...group, id: temporaryGroupId() }
}

function convertGroupType(group: SurveyQuestionGroup, type: SurveyQuestionType, locale: Locale): SurveyQuestionGroup {
  const common = {
    id: group.id,
    required: group.required,
    ...((group.role === 'rating' && type === 'rating_5') || (group.role === 'visit_frequency' && type === 'single_choice')
      ? { role: group.role }
      : {}),
  }
  const baseVariant = (variant: SurveyVariant) => ({
    id: variant.id,
    label: variant.label,
    ...(variant.help === undefined ? {} : { help: variant.help }),
  })
  if (type === 'short_text' || type === 'long_text') {
    const variants = group.variants.map((variant) => ({
      ...baseVariant(variant),
      ...('placeholder' in variant && variant.placeholder ? { placeholder: variant.placeholder } : {}),
    }))
    return { ...common, type, variants } as SurveyQuestionGroup
  }
  if (type === 'single_choice') {
    const variants = group.variants.map((variant) => ({
      ...baseVariant(variant),
      options: 'options' in variant ? structuredClone(variant.options) : defaultOptions(locale),
      allowOther: 'allowOther' in variant ? variant.allowOther : false,
    }))
    return { ...common, type, variants } as SurveyQuestionGroup
  }
  if (type === 'multi_choice') {
    const variants = group.variants.map((variant) => {
      const options = 'options' in variant ? structuredClone(variant.options) : defaultOptions(locale)
      return {
        ...baseVariant(variant),
        options,
        maxSelections: 'maxSelections' in variant ? Math.min(variant.maxSelections, options.length) : Math.min(2, options.length),
      }
    })
    return { ...common, type, variants } as SurveyQuestionGroup
  }
  return {
    ...common,
    type: 'rating_5',
    variants: group.variants.map((variant) => ({
      ...baseVariant(variant),
      lowLabel: 'lowLabel' in variant ? variant.lowLabel : localize(locale, '物足りない', 'Poor'),
      highLabel: 'highLabel' in variant ? variant.highLabel : localize(locale, 'とても良い', 'Excellent'),
    })),
  }
}

function replaceVariant(group: SurveyQuestionGroup, index: number, variant: SurveyVariant): SurveyQuestionGroup {
  const next = structuredClone(group)
  ;(next.variants as SurveyVariant[])[index] = variant
  return next
}

function withTemporaryIds(config: SurveyConfigV3, revision: number): SurveyDefinitionV4 {
  const definition = structuredClone(upcastV3ToV4({ ...structuredClone(config), revision }))
  definition.questionGroups.forEach((group) => {
    group.id = temporaryGroupId()
    group.variants.forEach((variant) => { variant.id = temporaryQuestionId() })
  })
  return definition
}

function CharacterCount({ value, max, locale }: { value: string; max: number; locale: Locale }) {
  return <span className="survey-editor__count" aria-live="polite">{value.length} / {max} {localize(locale, '文字', 'characters')}</span>
}

const SURVEY_SWIPE_MIN_DISTANCE = 48

function beginHorizontalSwipe(event: React.TouchEvent<HTMLElement>, enabled = true) {
  if (!enabled || event.touches.length !== 1) return
  const touch = event.touches[0]
  if (!touch) return
  event.currentTarget.dataset.swipeStartX = String(touch.clientX)
  event.currentTarget.dataset.swipeStartY = String(touch.clientY)
}

function finishHorizontalSwipe(
  event: React.TouchEvent<HTMLElement>,
  onSwipe: (direction: -1 | 1) => void,
) {
  const startX = Number(event.currentTarget.dataset.swipeStartX)
  const startY = Number(event.currentTarget.dataset.swipeStartY)
  delete event.currentTarget.dataset.swipeStartX
  delete event.currentTarget.dataset.swipeStartY
  const touch = event.changedTouches[0]
  if (!touch || !Number.isFinite(startX) || !Number.isFinite(startY)) return
  const deltaX = touch.clientX - startX
  const deltaY = touch.clientY - startY
  if (Math.abs(deltaX) < SURVEY_SWIPE_MIN_DISTANCE || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return
  event.preventDefault()
  onSwipe(deltaX < 0 ? 1 : -1)
}

function SurveyPreview({
  config,
  headingRef,
  combination,
  onReroll,
  locale,
}: {
  config: SurveyConfigV3
  headingRef: React.RefObject<HTMLHeadingElement | null>
  combination: string
  onReroll: (direction?: -1 | 1) => void
  locale: Locale
}) {
  const tr = (ja: string, en: string) => localize(locale, ja, en)
  return (
    <aside id="survey-preview" className="survey-preview" aria-label={tr('アンケートのプレビュー', 'Survey preview')}>
      <div className="survey-preview__controls">
        <div><strong>{tr('表示パターン', 'Display pattern')}</strong><span>{combination || tr('すべて固定', 'All fixed')}</span></div>
        <Button type="button" variant="secondary" onClick={() => onReroll(1)}>{tr('別パターンで表示', 'Show another pattern')}</Button>
      </div>
      <div
        className="survey-preview__device survey-swipe-surface"
        role="region"
        aria-label={tr('iPhone 17風のスマートフォン画面', 'iPhone 17-style phone screen')}
        onTouchStart={beginHorizontalSwipe}
        onTouchEnd={(event) => finishHorizontalSwipe(event, onReroll)}
      >
        <div className="survey-preview__screen">
          <div className="survey-preview__dynamic-island" aria-hidden="true" />
          <div className="survey-preview__screen-content">
            <h2 ref={headingRef} tabIndex={-1}>{config.title || tr('アンケートの見出し', 'Survey heading')}</h2>
            <p>{config.description || tr('アンケートの説明', 'Survey description')}</p>
            <div className="survey-preview__questions">
              {config.questions.map((question, index) => (
                <div key={question.id} className="survey-preview__question">
                  <span className="survey-preview__number">{index + 1}</span>
                  <CustomQuestionField locale={locale} question={question} idPrefix="survey-preview" preview />
                </div>
              ))}
            </div>
          </div>
          <div className="survey-preview__home-indicator" aria-hidden="true" />
        </div>
      </div>
    </aside>
  )
}

function roleHelp(
  locale: Locale,
  role: SurveyQuestionRole,
  group: SurveyQuestionGroup,
  groups: SurveyQuestionGroup[],
): { disabled: boolean; text: string } {
  const tr = (ja: string, en: string) => localize(locale, ja, en)
  const requiredType = role === 'rating' ? 'rating_5' : 'single_choice'
  if (group.type !== requiredType) {
    return {
      disabled: true,
      text: role === 'rating'
        ? tr('5段階評価の設問だけを「評価」として集計できます。', 'Only 5-point rating questions can be used as the rating metric.')
        : tr('選択肢から1つの設問だけを「来店頻度」として集計できます。', 'Only single-choice questions can be used as the visit-frequency metric.'),
    }
  }
  if (group.variants.length > 1) {
    return { disabled: true, text: tr('集計基準を固定するため、複数パターンの設問には設定できません。', 'Questions with multiple variants cannot be metrics because reporting criteria must remain fixed.') }
  }
  const owner = groups.find((candidate) => candidate.role === role && candidate.id !== group.id)
  if (owner) {
    return { disabled: true, text: locale === 'ja' ? `すでに「${owner.variants[0]?.label ?? '別の設問'}」で使用しています。` : `Already used by “${owner.variants[0]?.label ?? 'another question'}”.` }
  }
  return {
    disabled: false,
    text: role === 'rating'
      ? tr('月次集計の評価として使います。回答は任意にできます。', 'Use this for monthly rating reports. The answer may remain optional.')
      : tr('月次集計の来店頻度として使います。', 'Use this for monthly visit-frequency reports.'),
  }
}

function definitionFromStored(config: SurveyConfigV3 | SurveyDefinitionV4): SurveyDefinitionV4 {
  return config.version === 4 ? structuredClone(config) : upcastV3ToV4(config)
}

function materializePreview(definition: SurveyDefinitionV4, variantIndexes: number[]): SurveyConfigV3 {
  let groupIndex = 0
  return materializeSurveyDefinition(definition, () => {
    const group = definition.questionGroups[groupIndex]
    const variantIndex = variantIndexes[groupIndex] ?? 0
    groupIndex += 1
    return group ? Math.min(0.999999, (variantIndex + 0.01) / group.variants.length) : 0
  }).config
}

export function SurveySettingsPage() {
  const storeId = useActiveStoreId()
  return <SurveySettingsPageForStore key={storeId} storeId={storeId} />
}

function SurveySettingsPageForStore({ storeId }: { storeId: string }) {
  const { locale, text } = useI18n()
  const t = (copy: LocalCopy) => text(copy)
  const tr = (ja: string, en: string) => t({ ja, en })
  const QUESTION_TYPE_LABELS = questionTypeLabels(locale)
  const ADD_QUESTION_CHOICES = addQuestionChoices(locale)
  const queryClient = useQueryClient()
  const previewHeadingRef = useRef<HTMLHeadingElement>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [showPresetPicker, setShowPresetPicker] = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState<SurveyPresetId>('deep_dive_7')
  const [pendingPresetId, setPendingPresetId] = useState<SurveyPresetId | null>(null)
  const [moveAnnouncement, setMoveAnnouncement] = useState('')
  const [activeVariants, setActiveVariants] = useState<Record<string, string>>({})
  const [previewVariantIndexes, setPreviewVariantIndexes] = useState<number[]>([])
  const storeQuery = useQuery({ queryKey: ['owner-store', storeId], queryFn: () => getOwnerStore(storeId) })
  const query = useQuery({ queryKey: ['survey-config', storeId], queryFn: () => getSurveyConfig(storeId) })
  const presetsQuery = useQuery({ queryKey: ['survey-presets'], queryFn: getSurveyPresets })
  const form = useForm<SurveyDefinitionV4>({
    defaultValues: upcastV3ToV4(getLocalizedDefaultSurveyConfig(locale)),
    mode: 'onChange',
    resolver: zodResolver(SURVEY_DEFINITION_V4_SCHEMA),
  })
  const draft = useWatch({ control: form.control }) as SurveyDefinitionV4

  useEffect(() => {
    if (!query.data) return
    const definition = definitionFromStored(query.data as SurveyConfigV3 | SurveyDefinitionV4)
    form.reset(definition)
  }, [form, query.data])

  const validation = useMemo(() => SURVEY_DEFINITION_V4_SCHEMA.safeParse(draft), [draft])
  const fieldErrors = useMemo(() => {
    const errors = new Map<string, string>()
    if (!validation.success) {
      validation.error.issues.forEach((issue) => {
        const key = issue.path.join('.')
        if (!errors.has(key)) errors.set(key, validationMessage(locale, issue.message))
      })
    }
    return errors
  }, [locale, validation])

  const mutation = useMutation({
    mutationFn: async (input: SurveyDefinitionV4): Promise<SurveyDefinitionV4> => {
      const saved = await saveSurveyConfig(storeId, input)
      return definitionFromStored(saved)
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(['survey-config', storeId], saved)
      form.reset(saved)
      setMessage({ tone: 'success', text: tr('アンケート設定を保存しました。公開ページにも反映されます。', 'Survey settings saved and published to the public page.') })
    },
    onError: (caught) => {
      setMessage({ tone: 'error', text: saveErrorMessage(locale, caught) })
    },
  })

  const groups = draft.questionGroups ?? []
  const presets = useMemo(
    () => getLocalizedSurveyPresets(locale, presetsQuery.data ?? SURVEY_PRESETS),
    [locale, presetsQuery.data],
  )
  const totalVariants = groups.reduce((total, group) => total + group.variants.length, 0)

  const preview = useMemo(() => {
    const definition = validation.success ? validation.data : upcastV3ToV4(getLocalizedDefaultSurveyConfig(locale))
    return materializePreview(definition, previewVariantIndexes)
  }, [locale, previewVariantIndexes, validation])

  const previewCombination = groups.flatMap((group, index) => group.variants.length > 1
    ? [`Q${index + 1}：${String.fromCharCode(65 + (previewVariantIndexes[index] ?? 0) % group.variants.length)}`]
    : []).join(' / ')

  const updateGroups = (next: SurveyQuestionGroup[]) => {
    form.setValue('questionGroups', next, { shouldDirty: true, shouldTouch: true, shouldValidate: true })
    setMessage(null)
  }

  const updateGroup = (index: number, group: SurveyQuestionGroup) => {
    const next = structuredClone(groups)
    next[index] = group
    updateGroups(next)
  }

  const activeVariantIndex = (group: SurveyQuestionGroup) => {
    const selectedId = activeVariants[group.id]
    const index = group.variants.findIndex((variant) => variant.id === selectedId)
    return index >= 0 ? index : 0
  }

  const focusCard = (id: string, variantId?: string) => {
    window.setTimeout(() => {
      const target = document.getElementById(variantId ? `survey-question-label-${variantId}` : `survey-question-card-${id}`)
      target?.focus()
    }, 0)
  }

  const moveGroup = (index: number, direction: -1 | 1) => {
    const destination = index + direction
    if (destination < 0 || destination >= groups.length) return
    const next = structuredClone(groups)
    const [moved] = next.splice(index, 1)
    if (!moved) return
    next.splice(destination, 0, moved)
    updateGroups(next)
    setPreviewVariantIndexes((current) => {
      const updated = [...current]
      const [selection] = updated.splice(index, 1)
      updated.splice(destination, 0, selection ?? 0)
      return updated
    })
    setMoveAnnouncement(tr(`${destination + 1}番目に移動しました`, `Moved to position ${destination + 1}`))
    focusCard(moved.id)
  }

  const addVariant = (groupIndex: number) => {
    const group = groups[groupIndex]
    if (!group || group.role || group.variants.length >= SURVEY_LIMITS.variantsPerGroupMax || totalVariants >= SURVEY_LIMITS.variantsTotalMax) return
    const selected = group.variants[activeVariantIndex(group)]
    if (!selected) return
    const clone = { ...structuredClone(selected), id: temporaryQuestionId() } as SurveyVariant
    const nextGroup = structuredClone(group)
    ;(nextGroup.variants as SurveyVariant[]).push(clone)
    updateGroup(groupIndex, nextGroup)
    setActiveVariants((current) => ({ ...current, [group.id]: clone.id }))
    setExpandedId(group.id)
    focusCard(group.id, clone.id)
  }

  const deleteVariant = (groupIndex: number, variantIndex: number) => {
    const group = groups[groupIndex]
    if (!group || group.variants.length <= 1) return
    const nextGroup = structuredClone(group)
    nextGroup.variants.splice(variantIndex, 1)
    const nextActive = nextGroup.variants[Math.max(0, variantIndex - 1)]
    updateGroup(groupIndex, nextGroup)
    setActiveVariants((current) => ({ ...current, [group.id]: nextActive?.id ?? '' }))
  }

  const deleteGroup = (index: number) => {
    if (groups.length <= SURVEY_LIMITS.questionsMin) return
    updateGroups(groups.filter((_, candidateIndex) => candidateIndex !== index))
    setPreviewVariantIndexes((current) => current.filter((_, candidateIndex) => candidateIndex !== index))
    setDeleteConfirmId(null)
    setExpandedId(null)
  }

  const addGroup = (type: SurveyQuestionType | 'yes_no') => {
    if (groups.length >= SURVEY_LIMITS.questionsMax) return
    const group = groupFromQuestion(createQuestion(type, locale))
    updateGroups([...groups, group])
    setPreviewVariantIndexes((current) => [...current, 0])
    setShowAddMenu(false)
    setExpandedId(group.id)
    const first = group.variants[0]
    if (first) focusCard(group.id, first.id)
  }

  const setRole = (index: number, role: SurveyQuestionRole, enabled: boolean) => {
    const current = groups[index]
    if (!current) return
    const group = structuredClone(current)
    if (enabled) group.role = role
    else delete group.role
    updateGroup(index, group)
  }

  const applyPreset = (presetId: SurveyPresetId) => {
    const preset = presets.find((candidate) => candidate.id === presetId)
    if (!preset) return
    const next = withTemporaryIds(preset.config, draft.revision)
    form.reset(next, { keepDefaultValues: true })
    form.setValue('questionGroups', next.questionGroups, { shouldDirty: true, shouldValidate: true })
    form.setValue('title', next.title, { shouldDirty: true, shouldValidate: true })
    form.setValue('description', next.description, { shouldDirty: true, shouldValidate: true })
    form.setValue('presetId', next.presetId, { shouldDirty: true, shouldValidate: true })
    setPreviewVariantIndexes(next.questionGroups.map(() => 0))
    setPendingPresetId(null)
    setShowPresetPicker(false)
    setExpandedId(null)
    setMessage({ tone: 'warning', text: tr('プリセットを編集欄へ反映しました。内容を確認してから保存してください。', 'The preset was applied. Review it before saving.') })
  }

  const rerollPreview = (direction: -1 | 1 = 1) => {
    setPreviewVariantIndexes((current) => groups.map((group, index) => (
      group.variants.length > 1
        ? ((current[index] ?? 0) + direction + group.variants.length) % group.variants.length
        : 0
    )))
  }

  const store = storeQuery.data
  const surveyReportsMissingStore = query.isError
    && query.error instanceof ApiError
    && (query.error.status === 404 || query.error.code === 'STORE_NOT_FOUND')

  if (store === null || surveyReportsMissingStore) {
    return (
      <div className="owner-page">
        <PageTitle title={tr('アンケート編集', 'Edit survey')} />
        <EmptyState
          title={tr('先に店舗情報を登録してください', 'Add store information first')}
          action={<Link className="button button--primary" to={ownerStorePath(storeId, '/store')}>{tr('店舗情報を登録する', 'Add store information')}</Link>}
        />
      </div>
    )
  }
  if (query.isLoading || storeQuery.isLoading || store === undefined) return <LoadingState label={tr('アンケート設定を読み込んでいます', 'Loading survey settings')} />
  if (query.isError || storeQuery.isError) {
    return (
      <div className="owner-page">
        <PageTitle title={tr('アンケート編集', 'Edit survey')} />
        <Notice tone="error">{tr('アンケート設定を読み込めませんでした。', 'Could not load survey settings.')}</Notice>
        <Button variant="secondary" onClick={() => void query.refetch()}>{tr('もう一度読み込む', 'Try again')}</Button>
      </div>
    )
  }

  const invalidQuestionNumbers = validation.success
    ? []
    : [...new Set(validation.error.issues
      .filter((issue) => issue.path[0] === 'questionGroups' && typeof issue.path[1] === 'number')
      .map((issue) => (issue.path[1] as number) + 1))]

  return (
    <div className="owner-page survey-settings-page">
      <PageTitle title={tr('アンケート編集', 'Edit survey')} />
      <div className="survey-editor-layout">
        <div className="survey-editor-main">
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          {form.formState.isDirty && store.status === 'published' ? (
            <Notice tone="warning">{tr('公開中のアンケートを変更します。すでに回答済みの内容は、そのときの質問文のまま保存されています。', 'You are changing a published survey. Existing responses retain the exact question text shown when they were submitted.')}</Notice>
          ) : null}
          {!validation.success ? (
            <Notice tone="error">
              {invalidQuestionNumbers.length > 0
                ? locale === 'ja' ? `${invalidQuestionNumbers.join('、')}番目の質問を確認してください。` : `Check questions ${invalidQuestionNumbers.join(', ')}.`
                : tr('見出しと説明を確認してください。', 'Check the heading and description.')}
            </Notice>
          ) : null}
          <form
            id="survey-config-form"
            className="survey-editor-form"
            onSubmit={form.handleSubmit(async (values) => {
              setMessage(null)
              await mutation.mutateAsync(values).catch(() => undefined)
            }, () => setMessage({ tone: 'error', text: tr('入力内容を確認してください。', 'Check your entries.') }))}
          >
            <input type="hidden" {...form.register('version', { valueAsNumber: true })} />
            <input type="hidden" {...form.register('revision', { valueAsNumber: true })} />

            <Panel className="survey-editor-section survey-editor-section--intro">
              <div className="survey-editor-section__heading"><div><span>{tr('はじめに', 'Introduction')}</span><h2>{tr('見出しと説明', 'Heading and description')}</h2></div></div>
              <label>
                {tr('アンケートの見出し', 'Survey heading')}
                <input maxLength={SURVEY_LIMITS.titleMax} {...form.register('title')} />
                <CharacterCount locale={locale} value={draft.title ?? ''} max={SURVEY_LIMITS.titleMax} />
              </label>
              {fieldErrors.get('title') ? <span className="field-error">{fieldErrors.get('title')}</span> : null}
              <label>
                {tr('アンケートの説明', 'Survey description')}
                <textarea rows={3} maxLength={SURVEY_LIMITS.descriptionMax} {...form.register('description')} />
                <CharacterCount locale={locale} value={draft.description ?? ''} max={SURVEY_LIMITS.descriptionMax} />
              </label>
              {fieldErrors.get('description') ? <span className="field-error">{fieldErrors.get('description')}</span> : null}
            </Panel>

            <Panel className="survey-editor-section survey-editor-section--preset">
              <div className="survey-editor-section__heading">
                <div><span>{tr('出発点', 'Starting point')}</span><h2>{tr('プリセット', 'Preset')}</h2></div>
                <Button type="button" variant="secondary" onClick={() => setShowPresetPicker((value) => !value)}>{tr('プリセットから作り直す', 'Start over from a preset')}</Button>
              </div>
              {showPresetPicker ? (
                <div className="survey-preset-picker">
                  <label>{tr('プリセット', 'Preset')}
                    <select value={selectedPresetId} onChange={(event) => setSelectedPresetId(event.target.value as SurveyPresetId)}>
                      {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                    </select>
                  </label>
                  <p className="field-help">{presets.find((preset) => preset.id === selectedPresetId)?.description}</p>
                  <Button type="button" onClick={() => setPendingPresetId(selectedPresetId)}>{tr('このプリセットを使う', 'Use this preset')}</Button>
                </div>
              ) : null}
              {pendingPresetId ? (
                <Notice tone="warning">
                  <p>{tr('現在の質問を、選んだプリセットの質問へ置き換えます。未保存の編集内容は戻せません。', 'This replaces the current questions with the selected preset. Unsaved edits cannot be restored.')}</p>
                  <div className="button-group">
                    <Button type="button" onClick={() => applyPreset(pendingPresetId)}>{tr('置き換える', 'Replace')}</Button>
                    <Button type="button" variant="secondary" onClick={() => setPendingPresetId(null)}>{tr('やめる', 'Cancel')}</Button>
                  </div>
                </Notice>
              ) : null}
            </Panel>

            <div className="survey-question-list">
              {groups.map((group, index) => {
                const expanded = expandedId === group.id
                const variantIndex = activeVariantIndex(group)
                const variant = group.variants[variantIndex] ?? group.variants[0]
                if (!variant) return null
                const ratingRole = roleHelp(locale, 'rating', group, groups)
                const frequencyRole = roleHelp(locale, 'visit_frequency', group, groups)
                const addVariantDisabled = Boolean(group.role)
                  || group.variants.length >= SURVEY_LIMITS.variantsPerGroupMax
                  || totalVariants >= SURVEY_LIMITS.variantsTotalMax
                const shiftVariant = (direction: -1 | 1) => {
                  const candidate = group.variants[variantIndex + direction]
                  if (candidate) setActiveVariants((current) => ({ ...current, [group.id]: candidate.id }))
                }
                return (
                  <SurveyMotionSection
                    key={group.id}
                    id={`survey-question-card-${group.id}`}
                    tabIndex={-1}
                    layout={import.meta.env.MODE === 'test' ? false : 'position'}
                    initial={false}
                    transition={{ layout: { type: 'spring', stiffness: 340, damping: 32 } }}
                    aria-label={tr(`${index + 1}番目の設問`, `Question ${index + 1}`)}
                    className={!expanded ? 'survey-swipe-surface' : undefined}
                    onTouchStart={(event) => beginHorizontalSwipe(
                      event,
                      !expanded || Boolean((event.target as Element).closest('.survey-question-card__summary')),
                    )}
                    onTouchEnd={(event) => finishHorizontalSwipe(event, shiftVariant)}
                  >
                  <Panel className={expanded ? 'survey-question-card survey-question-card--expanded' : 'survey-question-card'}>
                    <div className="survey-question-card__summary">
                      <GripVertical aria-hidden="true" />
                      <button
                        type="button"
                        className="survey-question-card__toggle"
                        aria-expanded={expanded}
                        aria-controls={`survey-question-editor-${group.id}`}
                        onClick={() => setExpandedId(expanded ? null : group.id)}
                      >
                        <span>{index + 1}. {variant.label || tr('質問文を入力してください', 'Enter question text')}</span>
                        {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                      </button>
                      <Badge>{QUESTION_TYPE_LABELS[group.type]}</Badge>
                      {group.required ? <Badge>{tr('必須', 'Required')}</Badge> : null}
                    </div>

                    <div className="survey-variant-toolbar" aria-label={tr(`${index + 1}番目の設問の質問パターン`, `Variants for question ${index + 1}`)}>
                      <div className="survey-variant-toolbar__heading">
                        <strong>Q{index + 1}</strong><span>{tr(`${group.variants.length}パターン`, `${group.variants.length} variants`)}</span>
                      </div>
                      <div className="survey-variant-tabs" role="tablist" aria-label={tr(`Q${index + 1}のパターン`, `Variants for Q${index + 1}`)}>
                        {group.variants.map((candidate, candidateIndex) => (
                          <button
                            key={candidate.id}
                            type="button"
                            role="tab"
                            aria-selected={candidateIndex === variantIndex}
                            aria-label={tr(`パターン${String.fromCharCode(65 + candidateIndex)}`, `Variant ${String.fromCharCode(65 + candidateIndex)}`)}
                            onClick={() => setActiveVariants((current) => ({ ...current, [group.id]: candidate.id }))}
                          >{String.fromCharCode(65 + candidateIndex)}</button>
                        ))}
                      </div>
                      <div className="survey-variant-toolbar__actions">
                        <Button
                          type="button"
                          variant="quiet"
                          aria-label={tr('前の質問パターン', 'Previous question variant')}
                          disabled={variantIndex === 0}
                          onClick={() => shiftVariant(-1)}
                        ><ArrowLeft aria-hidden="true" /></Button>
                        <Button
                          type="button"
                          variant="quiet"
                          aria-label={tr('次の質問パターン', 'Next question variant')}
                          disabled={variantIndex === group.variants.length - 1}
                          onClick={() => shiftVariant(1)}
                        ><ArrowRight aria-hidden="true" /></Button>
                        <Button
                          type="button"
                          variant="quiet"
                          aria-label={tr('質問パターンを追加', 'Add question variant')}
                          title={group.role ? tr('評価・来店頻度の設問は固定です', 'Rating and visit-frequency questions are fixed') : tr('現在のパターンを複製', 'Duplicate current variant')}
                          disabled={addVariantDisabled}
                          onClick={() => addVariant(index)}
                        ><Plus aria-hidden="true" /></Button>
                        <Button
                          type="button"
                          variant="quiet"
                          aria-label={tr('現在の質問パターンを削除', 'Delete current question variant')}
                          disabled={group.variants.length <= 1}
                          onClick={() => deleteVariant(index, variantIndex)}
                        ><Trash2 aria-hidden="true" /></Button>
                      </div>
                    </div>

                    <AnimatePresence initial={false} mode={import.meta.env.MODE === 'test' ? 'sync' : 'wait'}>
                      {expanded ? (
                      <SurveyMotionDiv
                        key={`survey-question-editor-${group.id}`}
                        id={`survey-question-editor-${group.id}`}
                        className="survey-question-card__editor"
                        initial={import.meta.env.MODE === 'test' ? false : { height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        {...(import.meta.env.MODE === 'test' ? {} : { exit: { height: 0, opacity: 0 } })}
                        transition={import.meta.env.MODE === 'test' ? { duration: 0 } : {
                          height: { type: 'spring', stiffness: 280, damping: 30 },
                          opacity: { duration: 0.16 },
                        }}
                        style={{ overflow: 'hidden' }}
                      >
                        <div className="survey-question-card__topline">
                          <label htmlFor={`survey-question-label-${variant.id}`}>
                            {tr('質問文', 'Question text')}
                            <input
                              id={`survey-question-label-${variant.id}`}
                              value={variant.label}
                              maxLength={SURVEY_LIMITS.labelMax}
                              onChange={(event) => updateGroup(index, replaceVariant(group, variantIndex, { ...variant, label: event.target.value } as SurveyVariant))}
                            />
                            <CharacterCount locale={locale} value={variant.label} max={SURVEY_LIMITS.labelMax} />
                          </label>
                          <label>{tr('回答の形式', 'Answer format')}
                            <select value={group.type} onChange={(event) => updateGroup(index, convertGroupType(group, event.target.value as SurveyQuestionType, locale))}>
                              {Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                          </label>
                        </div>
                        <section className="survey-question-card__settings survey-question-card__settings--common" aria-label={tr(`Q${index + 1}の共通設定`, `Common settings for Q${index + 1}`)}>
                          <h3>{tr('集計と詳細', 'Reporting and details')}</h3>
                          <details className="survey-question-card__advanced-settings">
                            <summary>
                              <span>{tr('詳細設定', 'Advanced settings')}</span>
                              {group.role ? <span className="survey-question-card__advanced-status">{group.role === 'rating' ? tr('評価として集計中', 'Used as rating') : tr('来店頻度として集計中', 'Used as visit frequency')}</span> : null}
                              <ChevronDown aria-hidden="true" />
                            </summary>
                            <div className="survey-question-card__advanced-content">
                              <div className="survey-question-card__switch-row">
                                <div><strong>{tr('この設問を「評価」として集計に使う', 'Use this question as the rating metric')}</strong><p id={`${group.id}-rating-role-help`} className="field-help">{ratingRole.text}</p></div>
                                <Switch aria-describedby={`${group.id}-rating-role-help`} checked={group.role === 'rating'} label={tr(`${index + 1}番目の質問を評価として使う`, `Use question ${index + 1} as rating`)} disabled={ratingRole.disabled} onClick={() => setRole(index, 'rating', group.role !== 'rating')} />
                              </div>
                              <div className="survey-question-card__switch-row">
                                <div><strong>{tr('この設問を「来店頻度」として集計に使う', 'Use this question as the visit-frequency metric')}</strong><p id={`${group.id}-frequency-role-help`} className="field-help">{frequencyRole.text}</p></div>
                                <Switch aria-describedby={`${group.id}-frequency-role-help`} checked={group.role === 'visit_frequency'} label={tr(`${index + 1}番目の質問を来店頻度として使う`, `Use question ${index + 1} as visit frequency`)} disabled={frequencyRole.disabled} onClick={() => setRole(index, 'visit_frequency', group.role !== 'visit_frequency')} />
                              </div>
                            </div>
                          </details>
                        </section>

                        <section className="survey-question-card__settings survey-question-card__settings--variant" aria-label={tr(`Q${index + 1}パターン${String.fromCharCode(65 + variantIndex)}の設定`, `Settings for Q${index + 1} variant ${String.fromCharCode(65 + variantIndex)}`)}>
                          <div className="survey-question-card__settings-heading">
                            <h3>{tr(`パターン${String.fromCharCode(65 + variantIndex)}`, `Variant ${String.fromCharCode(65 + variantIndex)}`)}</h3>
                            <span>{variantIndex + 1} / {group.variants.length}</span>
                          </div>
                          {fieldErrors.get(`questionGroups.${index}.variants.${variantIndex}.label`) ? <span className="field-error">{fieldErrors.get(`questionGroups.${index}.variants.${variantIndex}.label`)}</span> : null}

                          <label>{tr('補足説明（任意）', 'Help text (optional)')}
                            <input
                              value={variant.help ?? ''}
                              maxLength={SURVEY_LIMITS.helpMax}
                              onChange={(event) => {
                                const next = structuredClone(variant) as SurveyVariant
                                if (event.target.value) next.help = event.target.value
                                else delete next.help
                                updateGroup(index, replaceVariant(group, variantIndex, next))
                              }}
                            />
                            <CharacterCount locale={locale} value={variant.help ?? ''} max={SURVEY_LIMITS.helpMax} />
                          </label>

                          {'placeholder' in variant ? (
                            <label>{tr('入力例（任意）', 'Example (optional)')}
                              <input
                                value={variant.placeholder ?? ''}
                                maxLength={SURVEY_LIMITS.placeholderMax}
                                onChange={(event) => {
                                  const next = structuredClone(variant)
                                  if (event.target.value) next.placeholder = event.target.value
                                  else delete next.placeholder
                                  updateGroup(index, replaceVariant(group, variantIndex, next))
                                }}
                              />
                              <CharacterCount locale={locale} value={variant.placeholder ?? ''} max={SURVEY_LIMITS.placeholderMax} />
                            </label>
                          ) : null}

                          {'options' in variant ? (
                            <div className="survey-option-editor">
                              <strong>{tr('選択肢', 'Options')}</strong>
                              {variant.options.map((option, optionIndex) => (
                                <div key={`${variant.id}-${optionIndex}`} className="survey-option-editor__row">
                                  <span>{optionIndex + 1}</span>
                                  <input
                                    aria-label={tr(`${index + 1}番目の質問の選択肢${optionIndex + 1}`, `Option ${optionIndex + 1} for question ${index + 1}`)}
                                    value={option.label}
                                    maxLength={SURVEY_LIMITS.optionLabelMax}
                                    onChange={(event) => {
                                      const next = structuredClone(variant)
                                      const nextOption = next.options[optionIndex]
                                      if (!nextOption) return
                                      nextOption.label = event.target.value
                                      updateGroup(index, replaceVariant(group, variantIndex, next))
                                    }}
                                  />
                                  <Button type="button" variant="quiet" aria-label={tr(`選択肢${optionIndex + 1}を削除`, `Delete option ${optionIndex + 1}`)} disabled={variant.options.length <= SURVEY_LIMITS.optionsMin} onClick={() => {
                                    const next = structuredClone(variant)
                                    next.options.splice(optionIndex, 1)
                                    if ('maxSelections' in next) next.maxSelections = Math.min(next.maxSelections, next.options.length)
                                    updateGroup(index, replaceVariant(group, variantIndex, next))
                                  }}><Trash2 aria-hidden="true" /></Button>
                                </div>
                              ))}
                              <Button type="button" variant="secondary" disabled={variant.options.length >= SURVEY_LIMITS.optionsMax} onClick={() => {
                                const next = structuredClone(variant)
                                const number = next.options.length + 1
                                next.options.push({ value: `option_${number}`, label: tr(`選択肢 ${number}`, `Option ${number}`) })
                                updateGroup(index, replaceVariant(group, variantIndex, next))
                              }}><Plus aria-hidden="true" />{tr('選択肢を追加', 'Add option')}</Button>
                              {'allowOther' in variant ? (
                                <label className="survey-option-editor__check">
                                  <input type="checkbox" checked={variant.allowOther} onChange={() => updateGroup(index, replaceVariant(group, variantIndex, { ...variant, allowOther: !variant.allowOther }))} />
                                  {tr('「その他」の自由入力を許可する', 'Allow a free-text “Other” option')}
                                </label>
                              ) : (
                                <label>{tr('複数選択の上限', 'Maximum selections')}
                                  <select value={variant.maxSelections} onChange={(event) => updateGroup(index, replaceVariant(group, variantIndex, { ...variant, maxSelections: Number(event.target.value) }))}>
                                    {variant.options.map((_, optionIndex) => <option key={optionIndex + 1} value={optionIndex + 1}>{optionIndex + 1}</option>)}
                                  </select>
                                </label>
                              )}
                            </div>
                          ) : null}

                          {'lowLabel' in variant ? (
                            <div className="survey-rating-labels">
                              <label>{tr('左端のラベル', 'Left label')}<input value={variant.lowLabel} maxLength={12} onChange={(event) => updateGroup(index, replaceVariant(group, variantIndex, { ...variant, lowLabel: event.target.value }))} /></label>
                              <label>{tr('右端のラベル', 'Right label')}<input value={variant.highLabel} maxLength={12} onChange={(event) => updateGroup(index, replaceVariant(group, variantIndex, { ...variant, highLabel: event.target.value }))} /></label>
                            </div>
                          ) : null}
                        </section>
                      </SurveyMotionDiv>
                      ) : null}
                    </AnimatePresence>

                    <div className="survey-question-card__actions" aria-label={tr(`${index + 1}番目の設問の操作`, `Actions for question ${index + 1}`)}>
                      <Button type="button" variant="quiet" aria-label={tr('上へ移動', 'Move up')} disabled={index === 0} onClick={() => moveGroup(index, -1)}><ArrowUp aria-hidden="true" /></Button>
                      <Button type="button" variant="quiet" aria-label={tr('下へ移動', 'Move down')} disabled={index === groups.length - 1} onClick={() => moveGroup(index, 1)}><ArrowDown aria-hidden="true" /></Button>
                      <Button type="button" variant="quiet" aria-label={tr('質問を削除', 'Delete question')} disabled={groups.length <= SURVEY_LIMITS.questionsMin} onClick={() => setDeleteConfirmId(group.id)}><Trash2 aria-hidden="true" /></Button>
                      <span className="survey-question-card__actions-separator" aria-hidden="true" />
                      <span className="survey-question-card__required-label">{tr('必須', 'Required')}</span>
                      <Switch checked={group.required} label={tr(`${index + 1}番目の質問を必須にする`, `Require question ${index + 1}`)} onClick={() => updateGroup(index, { ...group, required: !group.required })} />
                    </div>

                    {deleteConfirmId === group.id ? (
                      <Notice tone="error">
                        <p>{tr(`${index + 1}番目の設問を削除します。保存前でも、この編集内容は元に戻せません。`, `Delete question ${index + 1}? This edit cannot be undone, even before saving.`)}</p>
                        <div className="button-group">
                          <Button type="button" variant="danger" onClick={() => deleteGroup(index)}>{tr('削除する', 'Delete')}</Button>
                          <Button type="button" variant="secondary" onClick={() => setDeleteConfirmId(null)}>{tr('やめる', 'Cancel')}</Button>
                        </div>
                      </Notice>
                    ) : null}
                  </Panel>
                  </SurveyMotionSection>
                )
              })}
            </div>

            <div className="survey-add-question">
              <Button type="button" variant="secondary" disabled={groups.length >= SURVEY_LIMITS.questionsMax} onClick={() => setShowAddMenu((value) => !value)}>
                <Plus aria-hidden="true" />{tr('質問を追加', 'Add question')}
              </Button>
              {groups.length >= SURVEY_LIMITS.questionsMax ? <p className="field-help">{tr('質問は12問までです。', 'You can add up to 12 questions.')}</p> : null}
              {showAddMenu ? (
                <div className="survey-add-question__menu" role="menu" aria-label={tr('追加する質問の形式', 'Question type to add')}>
                  {ADD_QUESTION_CHOICES.map((choice) => (
                    <button key={choice.key} type="button" role="menuitem" onClick={() => addGroup(choice.key)}>
                      <strong>{choice.label}</strong><span>{choice.description}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="survey-editor-form__actions">
              <span aria-live="polite">{form.formState.isDirty ? tr('未保存の変更があります。', 'You have unsaved changes.') : tr('すべて保存されています。', 'All changes are saved.')}</span>
              <Button type="submit" busy={mutation.isPending} disabled={!form.formState.isDirty}><Save aria-hidden="true" />{tr('保存する', 'Save')}</Button>
            </div>
            <span className="sr-only" aria-live="polite">{moveAnnouncement}</span>
          </form>
        </div>
        <div className="survey-editor-preview-column">
          <SurveyPreview config={preview} headingRef={previewHeadingRef} combination={previewCombination} onReroll={rerollPreview} locale={locale} />
        </div>
      </div>
    </div>
  )
}
