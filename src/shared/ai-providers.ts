import type { Locale } from './i18n'

export const AI_PROVIDER_IDS = ['openai', 'gemini', 'deepseek', 'xai', 'anthropic'] as const

export type AiProviderName = (typeof AI_PROVIDER_IDS)[number]

export type ProviderDisclosure = {
  label: string
  keyUrl: string
  keyLabel: string
  policyUrl: string
  policyLabel: string
  notice: string | null
}

export type AiModel = {
  id: string
  label: string
}

export type ProviderModelCatalog = ProviderDisclosure & {
  defaultModel: string
  models: readonly AiModel[]
}

export const AI_PROVIDER_CATALOG: Record<AiProviderName, ProviderModelCatalog> = {
  openai: {
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyLabel: 'OpenAIのAPIキーを取得',
    policyUrl: 'https://openai.com/policies/business-terms/',
    policyLabel: 'OpenAIの規約',
    notice: null,
    defaultModel: 'gpt-5.6-luna',
    models: [
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    ],
  },
  gemini: {
    label: 'Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyLabel: 'GeminiのAPIキーを取得',
    policyUrl: 'https://ai.google.dev/gemini-api/terms',
    policyLabel: 'Gemini APIの規約',
    notice: 'Geminiの無償サービスでは、入力・出力がGoogleの製品改善や人手レビューに使われる場合があります。有償サービスは取扱いが異なります。',
    defaultModel: 'gemini-3.6-flash',
    models: [
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
  },
  deepseek: {
    label: 'DeepSeek',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyLabel: 'DeepSeekのAPIキーを取得',
    policyUrl: 'https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html',
    policyLabel: 'DeepSeekのプライバシーポリシー',
    notice: 'DeepSeekは入力・出力をサービス提供や改善のため処理し、データが中国のサーバーに保存される場合があります。API向けのZero Data Retention保証は確認できません。',
    defaultModel: 'deepseek-v4-flash',
    models: [
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ],
  },
  xai: {
    label: 'Grok (xAI)',
    keyUrl: 'https://console.x.ai/team/default/api-keys',
    keyLabel: 'GrokのAPIキーを取得',
    policyUrl: 'https://docs.x.ai/developers/faq/security',
    policyLabel: 'xAI APIのデータ取扱い',
    notice: 'xAIは明示的な許可なくAPI入出力を学習に使わないとしていますが、通常は監査目的で最大30日保持します。Zero Data RetentionはEnterprise向けです。',
    defaultModel: 'grok-4.5',
    models: [
      { id: 'grok-4.5', label: 'Grok 4.5' },
    ],
  },
  anthropic: {
    label: 'Claude (Anthropic)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyLabel: 'AnthropicのAPIキーを取得',
    policyUrl: 'https://privacy.anthropic.com/en/articles/7996868-how-long-do-you-store-my-organization-s-data',
    policyLabel: 'Anthropic APIのデータ取扱い',
    notice: 'Anthropicの商用APIでは、入力・出力を既定でモデル学習に使用しないとしています。通常のAPIデータ保持期間は30日で、対象契約ではZero Data Retentionを利用できます。',
    defaultModel: 'claude-sonnet-5',
    models: [
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
  },
}

const ENGLISH_PRESENTATION: Record<AiProviderName, Pick<ProviderModelCatalog, 'keyLabel' | 'policyLabel' | 'notice'>> = {
  openai: { keyLabel: 'Get an OpenAI API key', policyLabel: 'OpenAI terms', notice: null },
  gemini: { keyLabel: 'Get a Gemini API key', policyLabel: 'Gemini API terms', notice: 'With Gemini free services, inputs and outputs may be used for Google product improvement and human review. Paid services handle data differently.' },
  deepseek: { keyLabel: 'Get a DeepSeek API key', policyLabel: 'DeepSeek privacy policy', notice: 'DeepSeek processes inputs and outputs to provide and improve its services, and data may be stored on servers in China. No API Zero Data Retention guarantee has been confirmed.' },
  xai: { keyLabel: 'Get a Grok API key', policyLabel: 'xAI API data handling', notice: 'xAI states that API inputs and outputs are not used for training without explicit permission, but they are normally retained for audit purposes for up to 30 days. Zero Data Retention is available for Enterprise.' },
  anthropic: { keyLabel: 'Get an Anthropic API key', policyLabel: 'Anthropic API data handling', notice: 'Anthropic states that commercial API inputs and outputs are not used for model training by default. Standard API retention is 30 days, and eligible agreements can use Zero Data Retention.' },
}

/** Returns localized provider disclosures while preserving provider and model IDs. */
export function aiProviderCatalog(locale: Locale = 'ja'): Record<AiProviderName, ProviderModelCatalog> {
  if (locale === 'ja') return AI_PROVIDER_CATALOG
  const localizedCatalog: Record<AiProviderName, ProviderModelCatalog> = { ...AI_PROVIDER_CATALOG }
  for (const provider of AI_PROVIDER_IDS) {
    const source = AI_PROVIDER_CATALOG[provider]
    const copy = ENGLISH_PRESENTATION[provider]
    localizedCatalog[provider] = {
      ...source,
      keyLabel: copy.keyLabel,
      policyLabel: copy.policyLabel,
      notice: copy.notice,
    }
  }
  return localizedCatalog
}

export function aiProviderLabel(provider: AiProviderName, locale: Locale = 'ja'): string {
  return aiProviderCatalog(locale)[provider].label
}

export function aiModelFor(provider: AiProviderName, model: string | null | undefined, locale: Locale = 'ja'): AiModel {
  const catalog = aiProviderCatalog(locale)[provider]
  const selected = catalog.models.find((candidate) => candidate.id === model)
    ?? catalog.models.find((candidate) => candidate.id === catalog.defaultModel)
    ?? catalog.models[0]
  if (!selected) throw new Error(locale === 'ja' ? `モデルカタログが空です: ${provider}` : `The model catalog is empty: ${provider}`)
  return selected
}
