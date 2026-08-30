import { appError } from "./http.ts";
import type { JsonObject } from "./types.ts";

export const SURVEY_TEMPLATE_IDS = [
  "restaurant",
  "hair_salon",
  "treatment_clinic",
  "medical_clinic",
  "professional_services",
  "lodging",
  "retail",
  "other",
] as const;

export type SurveyTemplateId = typeof SURVEY_TEMPLATE_IDS[number];

export interface SurveyConfig extends JsonObject {
  version: 2;
  templateId: SurveyTemplateId;
  title: string;
  description: string;
  questions: {
    visitFrequency: { label: string };
    rating: { label: string };
    serviceUsed: { label: string; placeholder: string };
    memorablePoints: { label: string; placeholder: string };
    improvementPoints: { label: string; placeholder: string };
  };
}

type TextQuestion = { label: string; placeholder: string };

const SERVICE_QUESTION: Record<SurveyTemplateId, TextQuestion> = {
  restaurant: {
    label: "利用したメニュー・サービス",
    placeholder: "例：ランチセット、コース料理、テイクアウト",
  },
  hair_salon: {
    label: "利用したメニュー・サービス",
    placeholder: "例：カット、カラー、トリートメント",
  },
  treatment_clinic: {
    label: "利用した施術・サービス",
    placeholder: "例：整体、鍼灸、カウンセリング",
  },
  medical_clinic: {
    label: "利用した診療・サービス",
    placeholder: "個人を特定できる情報や詳しい病状は入力しないでください",
  },
  professional_services: {
    label: "利用した相談・サービス",
    placeholder:
      "例：初回相談、手続きのサポート（機密情報は入力しないでください）",
  },
  lodging: {
    label: "利用した宿泊プラン・サービス",
    placeholder: "例：一泊朝食付きプラン、温泉、館内サービス",
  },
  retail: {
    label: "利用した商品・サービス",
    placeholder: "例：購入した商品、相談、取り寄せ",
  },
  other: {
    label: "利用した商品・サービス",
    placeholder: "今回利用した内容をご記入ください",
  },
};

const MEMORABLE_QUESTION: Record<SurveyTemplateId, TextQuestion> = {
  restaurant: {
    label: "今回、特に印象に残ったこと",
    placeholder: "料理、接客、雰囲気など、率直な体験をご記入ください",
  },
  hair_salon: {
    label: "今回、特に印象に残ったこと",
    placeholder: "仕上がり、接客、過ごしやすさなど、率直な体験をご記入ください",
  },
  treatment_clinic: {
    label: "今回、特に印象に残ったこと",
    placeholder: "説明、対応、院内の環境など、率直な体験をご記入ください",
  },
  medical_clinic: {
    label: "今回、特に印象に残ったこと",
    placeholder: "説明、対応、施設の環境など、差し支えない範囲でご記入ください",
  },
  professional_services: {
    label: "今回、特に印象に残ったこと",
    placeholder: "説明、対応、相談のしやすさなど、率直な体験をご記入ください",
  },
  lodging: {
    label: "今回、特に印象に残ったこと",
    placeholder: "客室、食事、接客、設備など、率直な体験をご記入ください",
  },
  retail: {
    label: "今回、特に印象に残ったこと",
    placeholder: "商品、品ぞろえ、接客など、率直な体験をご記入ください",
  },
  other: {
    label: "今回、特に印象に残ったこと",
    placeholder:
      "良かったこと、気になったことを含め、率直な体験をご記入ください",
  },
};

export function canonicalSurveyConfig(
  templateId: SurveyTemplateId,
  title: string,
  description: string,
): SurveyConfig {
  return {
    version: 2,
    templateId,
    title,
    description,
    questions: {
      visitFrequency: { label: "来店頻度" },
      rating: { label: "今回の評価" },
      improvementPoints: {
        label: "改善してほしいことや、ほかに伝えたいこと",
        placeholder: "任意でご記入ください",
      },
      serviceUsed: { ...SERVICE_QUESTION[templateId] },
      memorablePoints: { ...MEMORABLE_QUESTION[templateId] },
    },
  };
}

export const DEFAULT_SURVEY_CONFIG = canonicalSurveyConfig(
  "other",
  "ご利用について教えてください",
  "5問のかんたんアンケートです。回答をもとに口コミ文を作成します。",
);

function exactObject(
  value: unknown,
  keys: readonly string[],
): JsonObject | null {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  const object = value as JsonObject;
  const actual = Object.keys(object);
  return actual.length === keys.length &&
      actual.every((key) => keys.includes(key))
    ? object
    : null;
}

function text(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= min && normalized.length <= max
    ? normalized
    : null;
}

function templateId(value: unknown): SurveyTemplateId | null {
  return typeof value === "string" &&
      (SURVEY_TEMPLATE_IDS as readonly string[]).includes(value)
    ? value as SurveyTemplateId
    : null;
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
] as const;

export function hasProhibitedSurveyCopy(
  title: string,
  description: string,
): boolean {
  const normalized = `${title}\n${description}`
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]+/gu, "");
  return PROHIBITED_SURVEY_COPY_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  );
}

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => equalJson(value, right[index]));
  }
  if (
    left === null || right === null || typeof left !== "object" ||
    typeof right !== "object"
  ) return false;
  const leftObject = left as JsonObject;
  const rightObject = right as JsonObject;
  const leftKeys = Object.keys(leftObject).sort();
  const rightKeys = Object.keys(rightObject).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) =>
      key === rightKeys[index] && equalJson(leftObject[key], rightObject[key])
    );
}

export function normalizeSurveyConfig(value: unknown): SurveyConfig | null {
  const root = exactObject(value, [
    "version",
    "templateId",
    "title",
    "description",
    "questions",
  ]);
  if (!root || root.version !== 2) return null;
  const selectedTemplate = templateId(root.templateId);
  const title = text(root.title, 1, 120);
  const description = text(root.description, 1, 300);
  if (
    !selectedTemplate || title === null || description === null ||
    hasProhibitedSurveyCopy(title, description)
  ) return null;

  const canonical = canonicalSurveyConfig(selectedTemplate, title, description);
  return equalJson(root, canonical) ? canonical : null;
}

export function requireSurveyConfig(value: unknown): SurveyConfig {
  const config = normalizeSurveyConfig(value);
  if (!config) {
    throw appError(
      "INVALID_SURVEY_CONFIG",
      "承認済みテンプレートからアンケートを選択してください。",
      400,
    );
  }
  return config;
}

export function storedSurveyConfig(value: unknown): SurveyConfig {
  return normalizeSurveyConfig(value) ?? structuredClone(DEFAULT_SURVEY_CONFIG);
}

export const SURVEY_QUESTION_TYPES = [
  "short_text",
  "long_text",
  "single_choice",
  "multi_choice",
  "rating_5",
] as const;

export type SurveyQuestionType = typeof SURVEY_QUESTION_TYPES[number];
export type SurveyQuestionRole = "rating" | "visit_frequency";

export const SURVEY_QUESTION_ID_PATTERN = /^q_[0-9a-f]{12}$/;
export const SURVEY_OPTION_VALUE_PATTERN = /^[a-z0-9_]{1,24}$/;

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
} as const;

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
] as const;

export function hasProhibitedQuestionCopy(value: string): boolean {
  const normalized = value.normalize("NFKC").toLowerCase().replace(
    /[\s\u3000]+/gu,
    "",
  );
  return PROHIBITED_QUESTION_PATTERNS.some((pattern) =>
    pattern.test(normalized)
  );
}

export interface SurveyOption extends JsonObject {
  value: string;
  label: string;
}

interface SurveyQuestionBase extends JsonObject {
  id: string;
  type: SurveyQuestionType;
  label: string;
  help?: string;
  required: boolean;
  role?: SurveyQuestionRole;
}

export interface ShortTextSurveyQuestion extends SurveyQuestionBase {
  type: "short_text";
  placeholder?: string;
  maxLength: 120;
}

export interface LongTextSurveyQuestion extends SurveyQuestionBase {
  type: "long_text";
  placeholder?: string;
  maxLength: 400;
}

export interface SingleChoiceSurveyQuestion extends SurveyQuestionBase {
  type: "single_choice";
  options: SurveyOption[];
  allowOther: boolean;
}

export interface MultiChoiceSurveyQuestion extends SurveyQuestionBase {
  type: "multi_choice";
  options: SurveyOption[];
  maxSelections: number;
}

export interface Rating5SurveyQuestion extends SurveyQuestionBase {
  type: "rating_5";
  lowLabel: string;
  highLabel: string;
}

export type SurveyQuestion =
  | ShortTextSurveyQuestion
  | LongTextSurveyQuestion
  | SingleChoiceSurveyQuestion
  | MultiChoiceSurveyQuestion
  | Rating5SurveyQuestion;

export interface SurveyConfigV3 extends JsonObject {
  version: 3;
  presetId: string | null;
  title: string;
  description: string;
  questions: SurveyQuestion[];
  revision: number;
}

export const SURVEY_GROUP_ID_PATTERN = /^g_[0-9a-f]{12}$/;

export interface SurveyQuestionGroup extends JsonObject {
  id: string;
  type: SurveyQuestion["type"];
  required: boolean;
  role?: "rating" | "visit_frequency";
  variants: JsonObject[];
}

export interface SurveyDefinitionV4 extends JsonObject {
  version: 4;
  presetId: string | null;
  title: string;
  description: string;
  questionGroups: SurveyQuestionGroup[];
  revision: number;
}

export interface SurveyVariantSelection extends JsonObject {
  schemaVersion: 1;
  algorithm: "uniform_v1";
  groups: JsonObject;
}

function exactOptionalObject(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): JsonObject | null {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  const object = value as JsonObject;
  const allowed = [...requiredKeys, ...optionalKeys];
  const actual = Object.keys(object);
  return requiredKeys.every((key) => key in object) &&
      actual.every((key) => allowed.includes(key))
    ? object
    : null;
}

function normalizedOptionalText(
  value: unknown,
  max: number,
): string | undefined | null {
  if (value === undefined) return undefined;
  return text(value, 0, max);
}

function safeQuestionCopy(value: string): boolean {
  return !hasProhibitedSurveyCopy(value, "") &&
    !hasProhibitedQuestionCopy(value);
}

function normalizeSurveyOption(value: unknown): SurveyOption | null {
  const object = exactObject(value, ["value", "label"]);
  if (!object) return null;
  const optionValue = text(object.value, 1, 24);
  const label = text(object.label, 1, SURVEY_LIMITS.optionLabelMax);
  if (
    optionValue === null || !SURVEY_OPTION_VALUE_PATTERN.test(optionValue) ||
    label === null || !safeQuestionCopy(label)
  ) return null;
  return { value: optionValue, label };
}

function normalizeSurveyQuestion(value: unknown): SurveyQuestion | null {
  const candidate = value as JsonObject | null;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }
  const questionType = candidate.type;
  if (
    typeof questionType !== "string" ||
    !(SURVEY_QUESTION_TYPES as readonly string[]).includes(questionType)
  ) return null;
  const normalizedType = questionType as SurveyQuestionType;

  const typeKeys: Record<SurveyQuestionType, readonly string[]> = {
    short_text: ["maxLength"],
    long_text: ["maxLength"],
    single_choice: ["options", "allowOther"],
    multi_choice: ["options", "maxSelections"],
    rating_5: ["lowLabel", "highLabel"],
  };
  const optionalTypeKeys = normalizedType === "short_text" ||
      normalizedType === "long_text"
    ? ["placeholder"]
    : [];
  const object = exactOptionalObject(
    candidate,
    ["id", "type", "label", "required", ...typeKeys[normalizedType]],
    ["help", "role", ...optionalTypeKeys],
  );
  if (!object) return null;

  const id = text(object.id, 1, 14);
  const label = text(object.label, 1, SURVEY_LIMITS.labelMax);
  const help = normalizedOptionalText(object.help, SURVEY_LIMITS.helpMax);
  let role: SurveyQuestionRole | undefined;
  if (object.role !== undefined) {
    if (object.role !== "rating" && object.role !== "visit_frequency") {
      return null;
    }
    role = object.role;
  }
  if (
    id === null || !SURVEY_QUESTION_ID_PATTERN.test(id) || label === null ||
    help === null || typeof object.required !== "boolean" ||
    !safeQuestionCopy(label) ||
    (help !== undefined && !safeQuestionCopy(help))
  ) return null;

  const common = {
    id,
    label,
    ...(help === undefined ? {} : { help }),
    required: object.required,
    ...(role === undefined ? {} : { role }),
  };

  if (normalizedType === "short_text" || normalizedType === "long_text") {
    const expectedMax = normalizedType === "short_text"
      ? SURVEY_LIMITS.shortTextAnswerMax
      : SURVEY_LIMITS.longTextAnswerMax;
    const placeholder = normalizedOptionalText(
      object.placeholder,
      SURVEY_LIMITS.placeholderMax,
    );
    if (
      object.maxLength !== expectedMax || placeholder === null ||
      (placeholder !== undefined && !safeQuestionCopy(placeholder))
    ) return null;
    return {
      ...common,
      type: normalizedType,
      ...(placeholder === undefined ? {} : { placeholder }),
      maxLength: expectedMax,
    } as ShortTextSurveyQuestion | LongTextSurveyQuestion;
  }

  if (normalizedType === "single_choice" || normalizedType === "multi_choice") {
    if (
      !Array.isArray(object.options) ||
      object.options.length < SURVEY_LIMITS.optionsMin ||
      object.options.length > SURVEY_LIMITS.optionsMax
    ) return null;
    const options = object.options.map(normalizeSurveyOption);
    if (options.some((option) => option === null)) return null;
    const validOptions = options as SurveyOption[];
    if (
      new Set(validOptions.map((option) => option.value)).size !==
        validOptions.length
    ) {
      return null;
    }
    if (normalizedType === "single_choice") {
      return typeof object.allowOther === "boolean"
        ? {
          ...common,
          type: normalizedType,
          options: validOptions,
          allowOther: object.allowOther,
        }
        : null;
    }
    return Number.isInteger(object.maxSelections) &&
        (object.maxSelections as number) >= 1 &&
        (object.maxSelections as number) <= validOptions.length
      ? {
        ...common,
        type: normalizedType,
        options: validOptions,
        maxSelections: object.maxSelections as number,
      }
      : null;
  }

  const lowLabel = text(object.lowLabel, 0, 12);
  const highLabel = text(object.highLabel, 0, 12);
  return lowLabel !== null && highLabel !== null &&
      safeQuestionCopy(lowLabel) &&
      safeQuestionCopy(highLabel)
    ? { ...common, type: "rating_5", lowLabel, highLabel }
    : null;
}

export function normalizeSurveyConfigV3(value: unknown): SurveyConfigV3 | null {
  const root = exactObject(value, [
    "version",
    "presetId",
    "title",
    "description",
    "questions",
    "revision",
  ]);
  if (
    !root || root.version !== 3 ||
    !(root.presetId === null || typeof root.presetId === "string") ||
    !Number.isInteger(root.revision) || (root.revision as number) < 1 ||
    !Array.isArray(root.questions) ||
    root.questions.length < SURVEY_LIMITS.questionsMin ||
    root.questions.length > SURVEY_LIMITS.questionsMax ||
    new TextEncoder().encode(JSON.stringify(root)).length >
      SURVEY_LIMITS.configBytesMax
  ) return null;

  const title = text(root.title, 1, SURVEY_LIMITS.titleMax);
  const description = text(root.description, 1, SURVEY_LIMITS.descriptionMax);
  if (
    title === null || description === null ||
    !safeQuestionCopy(title) || !safeQuestionCopy(description)
  ) return null;

  const questions = root.questions.map(normalizeSurveyQuestion);
  if (questions.some((question) => question === null)) return null;
  const validQuestions = questions as SurveyQuestion[];
  if (
    new Set(validQuestions.map((question) => question.id)).size !==
      validQuestions.length ||
    validQuestions.filter((question) => question.required).length >
      SURVEY_LIMITS.requiredMax ||
    validQuestions.filter((question) =>
        question.type === "short_text" || question.type === "long_text"
      ).length > SURVEY_LIMITS.freeTextMax
  ) return null;

  const ratingRoles = validQuestions.filter((question) =>
    question.role === "rating"
  );
  const frequencyRoles = validQuestions.filter((question) =>
    question.role === "visit_frequency"
  );
  if (
    ratingRoles.length > 1 ||
    ratingRoles.some((question) => question.type !== "rating_5") ||
    frequencyRoles.length > 1 ||
    frequencyRoles.some((question) => question.type !== "single_choice")
  ) return null;

  return {
    version: 3,
    presetId: root.presetId as string | null,
    title,
    description,
    questions: validQuestions,
    revision: root.revision as number,
  };
}

export function requireSurveyConfigV3(value: unknown): SurveyConfigV3 {
  const config = normalizeSurveyConfigV3(value);
  if (!config) {
    throw appError(
      "INVALID_SURVEY_CONFIG",
      "アンケートの設問、上限、または禁止事項を確認してください。",
      400,
    );
  }
  return config;
}

function variantQuestion(
  group: JsonObject,
  variant: JsonObject,
): SurveyQuestion | null {
  return normalizeSurveyQuestion({
    ...variant,
    type: group.type,
    required: group.required,
    ...(group.role === undefined ? {} : { role: group.role }),
    ...(group.type === "short_text"
      ? { maxLength: SURVEY_LIMITS.shortTextAnswerMax }
      : group.type === "long_text"
      ? { maxLength: SURVEY_LIMITS.longTextAnswerMax }
      : {}),
  });
}

function questionVariant(question: SurveyQuestion): JsonObject {
  const { type: _type, required: _required, role: _role, ...variant } =
    question;
  if ("maxLength" in variant) delete variant.maxLength;
  return variant as JsonObject;
}

export function normalizeSurveyDefinitionV4(
  value: unknown,
): SurveyDefinitionV4 | null {
  const root = exactObject(value, [
    "version",
    "presetId",
    "title",
    "description",
    "questionGroups",
    "revision",
  ]);
  if (
    !root || root.version !== 4 ||
    !(root.presetId === null || typeof root.presetId === "string") ||
    !Number.isInteger(root.revision) || (root.revision as number) < 1 ||
    !Array.isArray(root.questionGroups) ||
    root.questionGroups.length < SURVEY_LIMITS.questionsMin ||
    root.questionGroups.length > SURVEY_LIMITS.questionsMax ||
    new TextEncoder().encode(JSON.stringify(root)).length >
      SURVEY_LIMITS.configBytesMax
  ) return null;

  const title = text(root.title, 1, SURVEY_LIMITS.titleMax);
  const description = text(root.description, 1, SURVEY_LIMITS.descriptionMax);
  if (
    title === null || description === null ||
    !safeQuestionCopy(title) || !safeQuestionCopy(description)
  ) return null;

  const groupIds = new Set<string>();
  const variantIds = new Set<string>();
  const roleOwners = new Set<string>();
  const groups: SurveyQuestionGroup[] = [];
  let variantCount = 0;
  let requiredCount = 0;
  let freeTextCount = 0;

  for (const rawGroup of root.questionGroups) {
    const group = exactOptionalObject(
      rawGroup,
      ["id", "type", "required", "variants"],
      ["role"],
    );
    if (
      !group || typeof group.id !== "string" ||
      !SURVEY_GROUP_ID_PATTERN.test(group.id) || groupIds.has(group.id) ||
      typeof group.type !== "string" ||
      !(SURVEY_QUESTION_TYPES as readonly string[]).includes(group.type) ||
      typeof group.required !== "boolean" || !Array.isArray(group.variants) ||
      group.variants.length < 1 || group.variants.length > 4 ||
      !(group.role === undefined || group.role === "rating" ||
        group.role === "visit_frequency")
    ) return null;

    if (group.role !== undefined) {
      if (roleOwners.has(group.role as string) || group.variants.length !== 1) {
        return null;
      }
      if (
        (group.role === "rating" && group.type !== "rating_5") ||
        (group.role === "visit_frequency" && group.type !== "single_choice")
      ) return null;
      roleOwners.add(group.role as string);
    }

    const variants: JsonObject[] = [];
    for (const rawVariant of group.variants) {
      if (
        rawVariant === null || Array.isArray(rawVariant) ||
        typeof rawVariant !== "object"
      ) return null;
      const variant = rawVariant as JsonObject;
      const question = variantQuestion(group, variant);
      if (
        typeof variant.id !== "string" ||
        !SURVEY_QUESTION_ID_PATTERN.test(variant.id) ||
        variantIds.has(variant.id) || !question
      ) return null;
      variantIds.add(variant.id);
      variants.push(questionVariant(question));
    }

    groupIds.add(group.id);
    variantCount += variants.length;
    if (group.required) requiredCount += 1;
    if (group.type === "short_text" || group.type === "long_text") {
      freeTextCount += 1;
    }
    groups.push({
      id: group.id,
      type: group.type as SurveyQuestion["type"],
      required: group.required as boolean,
      ...(group.role === undefined
        ? {}
        : { role: group.role as "rating" | "visit_frequency" }),
      variants,
    });
  }

  if (
    variantCount > 24 || requiredCount > SURVEY_LIMITS.requiredMax ||
    freeTextCount > SURVEY_LIMITS.freeTextMax
  ) return null;

  return {
    version: 4,
    presetId: root.presetId as string | null,
    title,
    description,
    questionGroups: groups,
    revision: root.revision as number,
  };
}

export function requireSurveyDefinitionV4(value: unknown): SurveyDefinitionV4 {
  const definition = normalizeSurveyDefinitionV4(value);
  if (!definition) {
    throw appError(
      "INVALID_SURVEY_CONFIG",
      "アンケートの設問、パターン、上限、または禁止事項を確認してください。",
      400,
    );
  }
  return definition;
}

function groupIdFromQuestionId(questionId: string): string {
  return `g_${questionId.slice(2)}`;
}

export function upcastSurveyConfigV3(
  config: SurveyConfigV3,
): SurveyDefinitionV4 {
  return {
    version: 4,
    presetId: config.presetId,
    title: config.title,
    description: config.description,
    questionGroups: config.questions.map((question) => {
      const { type, required, role } = question;
      return {
        id: groupIdFromQuestionId(question.id),
        type,
        required,
        ...(role === undefined ? {} : { role }),
        variants: [questionVariant(question)],
      };
    }),
    revision: config.revision,
  };
}

function cryptoRandom(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return (values[0] ?? 0) / 0x1_0000_0000;
}

export function materializeSurveyDefinition(
  definition: SurveyDefinitionV4,
  random: () => number = cryptoRandom,
): { config: SurveyConfigV3; selection: SurveyVariantSelection } {
  const selectedGroups: JsonObject = {};
  const questions = definition.questionGroups.map((group) => {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new Error("INVALID_SURVEY_RANDOM_SOURCE");
    }
    const variantIndex = Math.floor(sample * group.variants.length);
    const variant = group.variants[variantIndex];
    if (!variant) throw new Error("INVALID_SURVEY_VARIANT");
    const question = variantQuestion(group, variant);
    if (!question) throw new Error("INVALID_SURVEY_VARIANT");
    selectedGroups[group.id] = question.id;
    return question;
  });
  const config: SurveyConfigV3 = {
    version: 3,
    presetId: definition.presetId,
    title: definition.title,
    description: definition.description,
    questions,
    revision: definition.revision,
  };
  if (!normalizeSurveyConfigV3(config)) {
    throw new Error("INVALID_SURVEY_CONFIG");
  }
  return {
    config,
    selection: {
      schemaVersion: 1,
      algorithm: "uniform_v1",
      groups: selectedGroups,
    },
  };
}

export function storedSurveyDefinitionV4(value: unknown): SurveyDefinitionV4 {
  const v4 = normalizeSurveyDefinitionV4(value);
  return v4 ?? upcastSurveyConfigV3(storedSurveyConfigV3(value));
}

export function upcastSurveyConfigV2(config: SurveyConfig): SurveyConfigV3 {
  return {
    version: 3,
    presetId: config.templateId,
    title: config.title,
    description: config.description,
    questions: [
      {
        id: "q_000000000001",
        type: "single_choice",
        label: config.questions.visitFrequency.label,
        required: false,
        role: "visit_frequency",
        options: [
          { value: "first", label: "初めて" },
          { value: "occasional", label: "ときどき" },
          { value: "regular", label: "よく利用する" },
          { value: "unknown", label: "回答しない" },
        ],
        allowOther: false,
      },
      {
        id: "q_000000000002",
        type: "rating_5",
        label: config.questions.rating.label,
        required: false,
        role: "rating",
        lowLabel: "1",
        highLabel: "5",
      },
      {
        id: "q_000000000003",
        type: "short_text",
        label: config.questions.serviceUsed.label,
        placeholder: config.questions.serviceUsed.placeholder,
        required: true,
        maxLength: 120,
      },
      {
        id: "q_000000000004",
        type: "long_text",
        label: config.questions.memorablePoints.label,
        placeholder: config.questions.memorablePoints.placeholder,
        required: true,
        maxLength: 400,
      },
      {
        id: "q_000000000005",
        type: "long_text",
        label: config.questions.improvementPoints.label,
        placeholder: config.questions.improvementPoints.placeholder,
        required: false,
        maxLength: 400,
      },
    ],
    revision: 1,
  };
}

export const DEFAULT_SURVEY_CONFIG_V3: SurveyConfigV3 = {
  version: 3,
  presetId: "deep_dive_7",
  title: "ご利用について教えてください",
  description:
    "7問のかんたんなアンケートです。ご回答をもとに口コミ文の下書きを作成します。",
  questions: [
    {
      id: "q_000000000001",
      type: "single_choice",
      label: "今回のご利用は何回目ですか",
      required: false,
      role: "visit_frequency",
      options: [
        { value: "first", label: "初めて" },
        { value: "two_three", label: "2〜3回目" },
        { value: "regular", label: "よく利用している" },
        { value: "no_answer", label: "答えない" },
      ],
      allowOther: false,
    },
    {
      id: "q_000000000002",
      type: "rating_5",
      label: "今回の体験を5段階でいうと",
      required: false,
      role: "rating",
      lowLabel: "物足りない",
      highLabel: "とても良い",
    },
    {
      id: "q_000000000003",
      type: "single_choice",
      label: "来る前に、少し気にしていたことはありましたか",
      required: false,
      options: [
        { value: "first_time_anxiety", label: "初めてで不安だった" },
        { value: "price_concern", label: "料金が気になっていた" },
        { value: "fit_uncertain", label: "自分に合うか分からなかった" },
        { value: "none", label: "特になかった" },
      ],
      allowOther: true,
    },
    {
      id: "q_000000000004",
      type: "short_text",
      label: "今回利用したメニュー・サービスを教えてください",
      placeholder: "例：骨盤矯正、カット、ランチセット",
      required: true,
      maxLength: 120,
    },
    {
      id: "q_000000000005",
      type: "long_text",
      label:
        "今回いちばん印象に残った場面を、そのときの様子がわかるように教えてください",
      help:
        "うまく書けなくて大丈夫です。思い出したことをそのまま書いてください。",
      placeholder:
        "例：施術の前に、どこがどう歪んでいるかを模型で見せながら説明してくれた",
      required: true,
      maxLength: 400,
    },
    {
      id: "q_000000000006",
      type: "long_text",
      label: "それは、あなたにとってどんなふうに良かった（残念だった）ですか",
      placeholder: "例：何をされるか分からない不安がなくなった",
      required: false,
      maxLength: 400,
    },
    {
      id: "q_000000000007",
      type: "short_text",
      label:
        "どんな人にすすめたいですか。あえて言うなら気になった点も教えてください",
      placeholder: "例：整体が初めてで不安な人。予約は少し取りにくい",
      required: false,
      maxLength: 120,
    },
  ],
  revision: 1,
};

export const SURVEY_PRESET_IDS = [
  "deep_dive_7",
  "quick_3",
  "restaurant",
  "hair_salon",
  "treatment_clinic",
  "medical_clinic",
  "professional_services",
  "lodging",
  "retail",
  "blank",
] as const;

export type SurveyPresetId = typeof SURVEY_PRESET_IDS[number];

export interface SurveyPreset extends JsonObject {
  id: SurveyPresetId;
  label: string;
  description: string;
  config: SurveyConfigV3;
}

function presetConfig(
  presetId: SurveyPresetId,
  questions: SurveyQuestion[],
): SurveyConfigV3 {
  return {
    version: 3,
    presetId,
    title: DEFAULT_SURVEY_CONFIG_V3.title,
    description:
      `${questions.length}問のかんたんなアンケートです。ご回答をもとに口コミ文の下書きを作成します。`,
    questions: structuredClone(questions),
    revision: 1,
  };
}

function industryPresetV3(
  template: Exclude<SurveyTemplateId, "other">,
): SurveyConfigV3 {
  const questions = structuredClone(DEFAULT_SURVEY_CONFIG_V3.questions);
  const serviceQuestion = questions[3];
  const memorableQuestion = questions[4];
  if (serviceQuestion?.type === "short_text") {
    serviceQuestion.label = SERVICE_QUESTION[template].label;
    serviceQuestion.placeholder = SERVICE_QUESTION[template].placeholder;
  }
  if (memorableQuestion?.type === "long_text") {
    memorableQuestion.label = MEMORABLE_QUESTION[template].label;
    memorableQuestion.placeholder = MEMORABLE_QUESTION[template].placeholder;
  }
  return presetConfig(template, questions);
}

export const SURVEY_PRESETS: readonly SurveyPreset[] = [
  {
    id: "deep_dive_7",
    label: "深掘り7問",
    description: "具体的な場面と感じたことを引き出す既定の構成",
    config: structuredClone(DEFAULT_SURVEY_CONFIG_V3),
  },
  {
    id: "quick_3",
    label: "さくっと3問",
    description: "回答の負担を最小限にした構成",
    config: presetConfig(
      "quick_3",
      [
        DEFAULT_SURVEY_CONFIG_V3.questions[3],
        DEFAULT_SURVEY_CONFIG_V3.questions[4],
        DEFAULT_SURVEY_CONFIG_V3.questions[1],
      ].filter((question): question is SurveyQuestion =>
        question !== undefined
      ),
    ),
  },
  {
    id: "restaurant",
    label: "飲食店",
    description: "レストラン、カフェ、居酒屋など",
    config: industryPresetV3("restaurant"),
  },
  {
    id: "hair_salon",
    label: "美容室",
    description: "美容室、理容室、ネイル、サロンなど",
    config: industryPresetV3("hair_salon"),
  },
  {
    id: "treatment_clinic",
    label: "治療院",
    description: "整体、接骨院、鍼灸院など",
    config: industryPresetV3("treatment_clinic"),
  },
  {
    id: "medical_clinic",
    label: "クリニック",
    description: "医院、歯科、各種クリニックなど",
    config: industryPresetV3("medical_clinic"),
  },
  {
    id: "professional_services",
    label: "士業",
    description: "税理士、行政書士、司法書士など",
    config: industryPresetV3("professional_services"),
  },
  {
    id: "lodging",
    label: "宿泊",
    description: "ホテル、旅館、民宿など",
    config: industryPresetV3("lodging"),
  },
  {
    id: "retail",
    label: "小売",
    description: "食品、雑貨、アパレルなど",
    config: industryPresetV3("retail"),
  },
  {
    id: "blank",
    label: "白紙から作る",
    description: "質問を1問ずつ自由に作る構成",
    config: presetConfig("blank", [{
      id: "q_000000000001",
      type: "short_text",
      label: "質問文を入力してください",
      required: false,
      maxLength: 120,
    }]),
  },
] as const;

for (const preset of SURVEY_PRESETS) {
  if (!normalizeSurveyConfigV3(preset.config)) {
    throw new Error(`INVALID_SURVEY_PRESET_${preset.id}`);
  }
}

export function storedSurveyConfigV3(value: unknown): SurveyConfigV3 {
  const v3 = normalizeSurveyConfigV3(value);
  if (v3) return v3;
  const v2 = normalizeSurveyConfig(value);
  return v2
    ? upcastSurveyConfigV2(v2)
    : structuredClone(DEFAULT_SURVEY_CONFIG_V3);
}
