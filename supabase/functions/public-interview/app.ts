import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type {
  CredentialCipher,
  SecretDeriver,
} from "../_shared/ai-credentials.ts";
import {
  AppError,
  appError,
  configureHttp,
  readJsonObject,
  requestHashes,
  requestIp,
  requireMutationKey,
  requireString,
  requireUuid,
  sha256Hex,
  success,
} from "../_shared/http.ts";
import type { ProviderFactory, ProviderModels } from "../_shared/providers.ts";
import {
  AiRuntime,
  defaultProviderFactory,
  providerModelsConfigured,
} from "../_shared/providers.ts";
import type { SupabaseRepository } from "../_shared/supabase.ts";
import { dbValue } from "../_shared/supabase.ts";
import {
  materializeSurveyDefinition,
  normalizeSurveyConfigV3,
  storedSurveyDefinitionV4,
  type SurveyConfigV3,
  type SurveyQuestion,
} from "../_shared/survey-config.ts";
import type { TurnstileVerifier } from "../_shared/turnstile.ts";
import type {
  AppEnv,
  JsonObject,
  SupabaseRequestContext,
} from "../_shared/types.ts";
import {
  type GenerationUnavailableReason,
  resolveGenerationDecision,
} from "./generation/generation-decision.ts";

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INTERVIEW_SESSION_TTL_MS = 15 * 60 * 1000;
const PUBLIC_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{15,127}$/;
const MAX_TURNS = 8;
const MAX_REWRITE_LIMIT = 20;
const AI_GENERATION_ERROR_MESSAGE = "エラーが発生しました。";
const INTERNAL_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,99}$/;

const GENERATION_UNAVAILABLE_CODES: Record<
  GenerationUnavailableReason,
  string
> = {
  byok_not_configured: "AI_BYOK_NOT_CONFIGURED",
  byok_credential_unreadable: "AI_BYOK_CREDENTIAL_UNREADABLE",
};
type PublicRepository = Pick<
  SupabaseRepository,
  | "publicStore"
  | "replaySessionStart"
  | "startSession"
  | "bindInterviewSurveySnapshot"
  | "interviewSurveySnapshot"
  | "validateSession"
  | "sessionResume"
  | "claimTurn"
  | "claimReview"
  | "completeReviewResult"
  | "claimRewrite"
  | "completeRewriteResult"
  | "saveEditedReview"
  | "recordHandoff"
  | "failOperation"
  | "getConnection"
  | "getActiveConnection"
  | "saveConnection"
  | "deleteConnection"
  | "getInterviewContext"
>;

export type PublicAppDependencies = {
  allowedOrigins: ReadonlySet<string>;
  authMiddleware: MiddlewareHandler<AppEnv>;
  repository(
    c: { var: { supabaseContext: SupabaseRequestContext } },
  ): PublicRepository;
  credentialCipher: CredentialCipher;
  secretDeriver: SecretDeriver;
  turnstile: TurnstileVerifier;
  models: ProviderModels;
  providerFactory?: ProviderFactory;
  now?: () => number;
  surveyRandom?: () => number;
};

function token(
  c: { req: { header(name: string): string | undefined } },
): string {
  const value = c.req.header("X-Interview-Token")?.trim() ?? "";
  if (!SESSION_TOKEN_PATTERN.test(value)) {
    throw appError(
      "SESSION_INVALID",
      "インタビューを確認できませんでした。",
      401,
    );
  }
  return value;
}

function safePublicStore(store: JsonObject): JsonObject {
  const definition = storedSurveyDefinitionV4(store.survey_config_json);
  const surveyConfig = materializeSurveyDefinition(definition, () => 0).config;
  return {
    publicSlug: store.public_slug,
    name: store.name,
    industry: store.industry ?? null,
    description: store.description ?? null,
    welcomeMessage: store.welcome_message ?? null,
    closingMessage: store.closing_message ?? null,
    googleMapsUrl: store.google_maps_url ?? null,
    surveyConfig,
    surveyRevision: surveyConfig.revision,
  };
}

type SurveyAnswer = {
  type: SurveyQuestion["type"];
  value: string | string[] | number;
};

function surveyRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw appError(
      "SURVEY_REVISION_NOT_FOUND",
      "このアンケートの版を確認できません。最初からやり直してください。",
      400,
    );
  }
  return value as number;
}

function answerObject(value: unknown): JsonObject | null {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  const object = value as JsonObject;
  const keys = Object.keys(object);
  return keys.length === 2 && keys.includes("type") && keys.includes("value")
    ? object
    : null;
}

function invalidAnswer(message = "回答内容を確認してください。"): never {
  throw appError("INVALID_TURN_INPUT", message, 400);
}

function normalizedAnswer(
  question: SurveyQuestion,
  raw: unknown,
): { answer: SurveyAnswer; display: string } {
  const object = answerObject(raw);
  if (!object || object.type !== question.type) invalidAnswer();
  const value = object.value;

  if (question.type === "short_text" || question.type === "long_text") {
    if (typeof value !== "string") invalidAnswer();
    const text = value.trim();
    if (text.length < 1 || text.length > question.maxLength) invalidAnswer();
    return { answer: { type: question.type, value: text }, display: text };
  }

  if (question.type === "rating_5") {
    if (
      !Number.isInteger(value) || (value as number) < 1 || (value as number) > 5
    ) {
      invalidAnswer("評価を確認してください。");
    }
    return {
      answer: { type: question.type, value: value as number },
      display: String(value),
    };
  }

  const optionLabels = new Map(
    question.options.map((option) => [option.value, option.label]),
  );
  if (question.type === "single_choice") {
    if (typeof value !== "string") invalidAnswer();
    const optionLabel = optionLabels.get(value);
    if (optionLabel) {
      return { answer: { type: question.type, value }, display: optionLabel };
    }
    if (!question.allowOther || !value.startsWith("other:")) invalidAnswer();
    const other = value.slice("other:".length).trim();
    if (other.length < 1 || other.length > 54) invalidAnswer();
    return {
      answer: { type: question.type, value: `other:${other}` },
      display: other,
    };
  }

  if (
    !Array.isArray(value) || value.length < 1 ||
    value.length > question.maxSelections ||
    new Set(value).size !== value.length ||
    value.some((entry) => typeof entry !== "string" || !optionLabels.has(entry))
  ) invalidAnswer();
  const selected = value as string[];
  return {
    answer: { type: question.type, value: selected },
    display: selected.map((entry) => optionLabels.get(entry)).join("、"),
  };
}

function validateSurveyAnswers(
  config: SurveyConfigV3,
  value: unknown,
): {
  structuredAnswers: JsonObject;
  answerChunks: string[];
  rating: number | null;
  visitFrequency: string | null;
} {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    invalidAnswer();
  }
  const rawAnswers = value as JsonObject;
  const knownIds = new Set(config.questions.map((question) => question.id));
  if (Object.keys(rawAnswers).some((id) => !knownIds.has(id))) invalidAnswer();

  const answers: JsonObject = {};
  const sections: string[] = [];
  let rating: number | null = null;
  let visitFrequency: string | null = null;
  for (const question of config.questions) {
    const raw = rawAnswers[question.id];
    if (raw === undefined) {
      if (question.required) {
        invalidAnswer(`${question.label}に回答してください。`);
      }
      continue;
    }
    const normalized = normalizedAnswer(question, raw);
    answers[question.id] = normalized.answer;
    sections.push(`【${question.label}】\n${normalized.display}`);
    if (question.role === "rating") {
      rating = normalized.answer.value as number;
    }
    if (question.role === "visit_frequency") {
      const selected = normalized.answer.value as string;
      visitFrequency = selected === "first"
        ? "first"
        : selected === "occasional" || selected === "two_three"
        ? "occasional"
        : selected === "regular"
        ? "regular"
        : "unknown";
    }
  }
  if (sections.length === 0) invalidAnswer();

  return {
    structuredAnswers: { schemaVersion: 3, answers },
    answerChunks: chunkAnswerSections(sections),
    rating,
    visitFrequency,
  };
}

function chunkAnswerSections(sections: string[]): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const section of sections) {
    if (section.length > 1000) invalidAnswer();
    const candidate = current ? `${current}\n\n${section}` : section;
    if (candidate.length <= 1000) {
      current = candidate;
    } else {
      chunks.push(current);
      current = section;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function revisionConfig(value: JsonObject): SurveyConfigV3 {
  const config = normalizeSurveyConfigV3(value.survey_config_json);
  if (!config) {
    throw appError(
      "SURVEY_REVISION_NOT_FOUND",
      "このアンケートの版を確認できません。最初からやり直してください。",
      400,
    );
  }
  return config;
}

function numeric(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function remainingRewrites(value: unknown): number {
  if (
    typeof value !== "number" || !Number.isInteger(value) || value < 0 ||
    value > MAX_REWRITE_LIMIT
  ) {
    throw new Error("INVALID_REWRITE_ALLOWANCE");
  }
  return value;
}

function reviewResponse(result: JsonObject): JsonObject {
  return {
    review: result.review_text,
    remainingRewrites: remainingRewrites(result.remaining_rewrites),
    generationSource: result.generation_source === "template"
      ? "template"
      : "ai",
  };
}

async function sessionAuthentication(
  c: { req: { header(name: string): string | undefined } },
): Promise<{ raw: string; hash: string }> {
  const raw = token(c);
  return { raw, hash: await sha256Hex(raw) };
}

function publicGenerationError(): AppError {
  return appError(
    "AI_GENERATION_FAILED",
    AI_GENERATION_ERROR_MESSAGE,
    503,
    true,
    true,
  );
}

function internalGenerationErrorCode(error: unknown): string {
  const candidates = error instanceof AppError
    ? [error.code]
    : error instanceof Error
    ? [
      typeof (error as Error & { code?: unknown }).code === "string"
        ? (error as Error & { code: string }).code
        : "",
      error.message,
    ]
    : [];
  return candidates.find((candidate) =>
    INTERNAL_ERROR_CODE_PATTERN.test(candidate)
  ) ?? "AI_GENERATION_INTERNAL_ERROR";
}

async function rejectGeneration(
  repository: Pick<PublicRepository, "failOperation">,
  operationId: string,
  errorCode: string,
): Promise<never> {
  // Each client retry uses a fresh operation id, so this private operation
  // ledger retains every failed attempt and its specific internal reason.
  await repository.failOperation(operationId, errorCode).catch(() => undefined);
  throw publicGenerationError();
}

export function createPublicInterviewApp(
  dependencies: PublicAppDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  configureHttp(app, dependencies.allowedOrigins);
  app.use("/public-interview/*", dependencies.authMiddleware);

  app.get("/public-interview/stores/:slug", async (c) => {
    const publicSlug = requireString(c.req.param("slug"), {
      code: "INVALID_PUBLIC_SLUG",
      message: "公開URLを確認してください。",
      min: 16,
      max: 128,
      pattern: PUBLIC_SLUG_PATTERN,
    });
    const store = await dependencies.repository(c).publicStore(publicSlug);
    if (!store) {
      throw appError(
        "STORE_NOT_AVAILABLE",
        "このアンケートは現在利用できません。",
        404,
      );
    }
    return success(c, safePublicStore(store));
  });

  app.post("/public-interview/sessions", async (c) => {
    const idempotencyKey = requireMutationKey(c);
    const body = await readJsonObject(c, 8_192);
    const publicSlug = requireString(body.publicSlug, {
      code: "INVALID_PUBLIC_SLUG",
      message: "公開URLを確認してください。",
      min: 16,
      max: 128,
      pattern: PUBLIC_SLUG_PATTERN,
    });
    const locale = body.locale === "ja"
      ? "ja"
      : body.locale === "en"
      ? "en"
      : null;
    if (!locale) {
      throw appError("INVALID_LOCALE", "言語設定を確認してください。", 400);
    }
    const turnstileToken = requireString(body.turnstileToken, {
      code: "TURNSTILE_REQUIRED",
      message: "人間であることを確認してください。",
      min: 1,
      max: 4096,
    });
    const repository = dependencies.repository(c);
    const store = await repository.publicStore(publicSlug);
    if (!store || typeof store.store_id !== "string") {
      throw appError(
        "STORE_NOT_AVAILABLE",
        "このアンケートは現在利用できません。",
        404,
      );
    }
    const storeId = store.store_id;
    const shownSurveyDefinition = storedSurveyDefinitionV4(
      store.survey_config_json,
    );
    const shownSurveyRevision = shownSurveyDefinition.revision;
    const hashes = await requestHashes(
      idempotencyKey,
      "POST",
      "/public-interview/sessions",
      { publicSlug, locale },
    );

    const replay = await repository.replaySessionStart({
      storeId,
      keyHash: hashes.keyHash,
      requestHash: hashes.requestHash,
    });
    if (replay) {
      const sessionId = dbValue.string(replay.session_id, "SESSION_ID");
      const sessionToken = await dependencies.secretDeriver.sessionToken(
        sessionId,
        idempotencyKey,
      );
      const tokenHash = await sha256Hex(sessionToken);
      let snapshot = await repository.interviewSurveySnapshot(
        sessionId,
        tokenHash,
      );
      if (!snapshot) {
        const resolved = materializeSurveyDefinition(
          shownSurveyDefinition,
          dependencies.surveyRandom,
        );
        snapshot = await repository.bindInterviewSurveySnapshot(
          sessionId,
          tokenHash,
          shownSurveyRevision,
          resolved.selection,
          resolved.config,
        );
      }
      const replayedConfig = revisionConfig(snapshot);
      return success(c, {
        sessionId,
        sessionToken,
        expiresAt: replay.expires_at,
        surveyConfig: replayedConfig,
        surveyRevision: replayedConfig.revision,
      });
    }

    const origin = c.req.header("Origin");
    if (!origin) {
      throw appError("ORIGIN_REQUIRED", "送信元を確認できません。", 403);
    }
    const clientIp = requestIp(c);
    if (
      !await dependencies.turnstile.verify({
        token: turnstileToken,
        remoteIp: clientIp,
        siteverifyIdempotencyKey: crypto.randomUUID(),
        expectedHostname: new URL(origin).hostname,
      })
    ) {
      throw appError(
        "TURNSTILE_FAILED",
        "人間であることを確認できませんでした。もう一度お試しください。",
        403,
        true,
      );
    }

    const sessionId = crypto.randomUUID();
    const sessionToken = await dependencies.secretDeriver.sessionToken(
      sessionId,
      idempotencyKey,
    );
    const now = (dependencies.now ?? Date.now)();
    const result = await repository.startSession({
      sessionId,
      storeId,
      locale,
      tokenHash: await sha256Hex(sessionToken),
      ipSubjectHash: await dependencies.secretDeriver.subjectHash(
        "ip-store",
        `${storeId}:${clientIp}`,
      ),
      keyHash: hashes.keyHash,
      requestHash: hashes.requestHash,
      expiresAt: new Date(now + INTERVIEW_SESSION_TTL_MS).toISOString(),
    });
    const actualSessionId = dbValue.string(result.session_id, "SESSION_ID");
    const actualSessionToken = await dependencies.secretDeriver.sessionToken(
      actualSessionId,
      idempotencyKey,
    );
    const resolved = materializeSurveyDefinition(
      shownSurveyDefinition,
      dependencies.surveyRandom,
    );
    const snapshot = await repository.bindInterviewSurveySnapshot(
      actualSessionId,
      await sha256Hex(actualSessionToken),
      shownSurveyRevision,
      resolved.selection,
      resolved.config,
    );
    const snapshotConfig = revisionConfig(snapshot);
    return success(c, {
      sessionId: actualSessionId,
      sessionToken: actualSessionToken,
      expiresAt: result.expires_at,
      surveyConfig: snapshotConfig,
      surveyRevision: snapshotConfig.revision,
    }, 201);
  });

  app.get("/public-interview/sessions/:id", async (c) => {
    const sessionId = requireUuid(c.req.param("id"));
    const authentication = await sessionAuthentication(c);
    const repository = dependencies.repository(c);
    const result = await repository.sessionResume(
      sessionId,
      authentication.hash,
    );
    const snapshot = await repository.interviewSurveySnapshot(
      sessionId,
      authentication.hash,
    );
    const nextKind = result.next_kind;
    const next = nextKind === "conversation"
      ? {
        kind: "conversation",
        lastAssistantQuestion: result.last_assistant_question ?? null,
      }
      : nextKind === "review"
      ? { kind: "review", review: result.edited_review ?? null }
      : nextKind === "ready_for_review"
      ? { kind: "ready_for_review" }
      : { kind: "profile" };
    return success(c, {
      status: result.status,
      turnCount: numeric(result.ai_turn_count),
      maxTurns: MAX_TURNS,
      interviewComplete: result.interview_complete === true,
      generationStatus: result.generation_status,
      rewriteCount: numeric(result.rewrite_count),
      editedReview: result.edited_review ?? null,
      remainingRewrites: remainingRewrites(result.remaining_rewrites),
      ...(snapshot
        ? {
          surveyConfig: revisionConfig(snapshot),
          surveyRevision: surveyRevision(snapshot.survey_revision),
        }
        : {}),
      next,
    });
  });

  app.post("/public-interview/sessions/:id/turns", async (c) => {
    const sessionId = requireUuid(c.req.param("id"));
    const idempotencyKey = requireMutationKey(c);
    const body = await readJsonObject(c, 20_000);
    if (body.kind !== "survey") {
      throw appError(
        "INVALID_TURN_INPUT",
        "固定アンケートの回答内容を確認してください。",
        400,
      );
    }
    const authentication = await sessionAuthentication(c);
    const hashes = await requestHashes(
      idempotencyKey,
      "POST",
      `/public-interview/sessions/${sessionId}/turns`,
      body,
    );
    const sessionSubjectHash = await dependencies.secretDeriver.subjectHash(
      "session",
      `${sessionId}:${authentication.raw}`,
    );
    const repository = dependencies.repository(c);
    const requestedRevision = surveyRevision(body.surveyRevision);
    let storedRevision: JsonObject;
    try {
      const snapshot = await repository.interviewSurveySnapshot(
        sessionId,
        authentication.hash,
      );
      const snapshotConfig = snapshot
        ? normalizeSurveyConfigV3(snapshot.survey_config_json)
        : null;
      const snapshotRevision = snapshot?.survey_revision ??
        snapshotConfig?.revision;
      if (!snapshot || snapshotRevision !== requestedRevision) {
        throw new Error("SURVEY_REVISION_NOT_FOUND");
      }
      storedRevision = snapshot;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("SURVEY_REVISION_NOT_FOUND")
      ) {
        throw appError(
          "SURVEY_REVISION_NOT_FOUND",
          "このアンケートの版を確認できません。最初からやり直してください。",
          400,
        );
      }
      throw error;
    }
    const config = revisionConfig(storedRevision);
    const validated = validateSurveyAnswers(config, body.answers);
    const profile: JsonObject = {};
    if (validated.visitFrequency !== null) {
      profile.visitFrequency = validated.visitFrequency;
    }
    if (validated.rating !== null) profile.rating = validated.rating;
    const params: JsonObject = {
      p_session_id: sessionId,
      p_token_hash: authentication.hash,
      p_session_subject_hash: sessionSubjectHash,
      p_idempotency_key_hash: hashes.keyHash,
      p_request_hash: hashes.requestHash,
      p_kind: "survey",
      p_profile_json: profile,
      p_structured_answers_json: validated.structuredAnswers,
      p_answer_chunks: validated.answerChunks,
      p_survey_revision: requestedRevision,
      p_rating: validated.rating,
      p_visit_frequency: validated.visitFrequency,
    };

    const claim = await repository.claimTurn(params);
    const turnCount = numeric(claim.ai_turn_count);
    return success(c, {
      answerSaved: true,
      turnCount,
      maxTurns: MAX_TURNS,
      next: { kind: "ready_for_review" },
    });
  });

  app.post("/public-interview/sessions/:id/review", async (c) => {
    const sessionId = requireUuid(c.req.param("id"));
    const idempotencyKey = requireMutationKey(c);
    const authentication = await sessionAuthentication(c);
    const hashes = await requestHashes(
      idempotencyKey,
      "POST",
      `/public-interview/sessions/${sessionId}/review`,
      {},
    );
    const repository = dependencies.repository(c);
    const claim = await repository.claimReview({
      p_session_id: sessionId,
      p_token_hash: authentication.hash,
      p_session_subject_hash: await dependencies.secretDeriver.subjectHash(
        "session",
        `${sessionId}:${authentication.raw}`,
      ),
      p_idempotency_key_hash: hashes.keyHash,
      p_request_hash: hashes.requestHash,
    });
    if (claim.replayed === true) return success(c, reviewResponse(claim));
    const operationId = dbValue.string(claim.operation_id, "OPERATION_ID");
    const storeId = dbValue.string(claim.store_id, "STORE_ID");
    try {
      const resolvedGeneration = await resolveGenerationDecision(
        dependencies,
        repository,
        operationId,
        sessionId,
        storeId,
        "review",
      );
      if (resolvedGeneration.decision.kind === "unavailable") {
        return await rejectGeneration(
          repository,
          operationId,
          GENERATION_UNAVAILABLE_CODES[resolvedGeneration.decision.reason],
        );
      }
      if (!("credential" in resolvedGeneration)) {
        throw new Error("INVALID_BYOK_GENERATION_DECISION");
      }
      if (
        !providerModelsConfigured(
          dependencies.models,
          resolvedGeneration.credential.value.provider,
        )
      ) {
        return await rejectGeneration(
          repository,
          operationId,
          "AI_PROVIDER_NOT_CONFIGURED",
        );
      }
      const result = await new AiRuntime(
        repository,
        dependencies.models,
        dependencies.providerFactory ?? defaultProviderFactory,
      ).invoke({
        provider: resolvedGeneration.credential.value.provider,
        model: resolvedGeneration.credential.value.model,
        apiKey: resolvedGeneration.credential.apiKey,
        storeId,
        sessionId,
        operation: "review_generation",
        requestId: c.get("requestId"),
      });
      return success(
        c,
        reviewResponse(
          await repository.completeReviewResult(operationId, {
            ...result,
            source: "ai",
          }),
        ),
      );
    } catch (error) {
      if (error instanceof AppError && error.code === "AI_GENERATION_FAILED") {
        throw error;
      }
      return await rejectGeneration(
        repository,
        operationId,
        internalGenerationErrorCode(error),
      );
    }
  });

  app.patch("/public-interview/sessions/:id/review", async (c) => {
    const sessionId = requireUuid(c.req.param("id"));
    const idempotencyKey = requireMutationKey(c);
    const body = await readJsonObject(c, 4_096);
    const editedReview = requireString(body.editedReview, {
      code: "INVALID_REVIEW_TEXT",
      message: "口コミ文は1〜800文字で入力してください。",
      min: 1,
      max: 800,
    });
    const authentication = await sessionAuthentication(c);
    const hashes = await requestHashes(
      idempotencyKey,
      "PATCH",
      `/public-interview/sessions/${sessionId}/review`,
      { editedReview },
    );
    const result = await dependencies.repository(c).saveEditedReview({
      p_session_id: sessionId,
      p_token_hash: authentication.hash,
      p_session_subject_hash: await dependencies.secretDeriver.subjectHash(
        "session",
        `${sessionId}:${authentication.raw}`,
      ),
      p_idempotency_key_hash: hashes.keyHash,
      p_request_hash: hashes.requestHash,
      p_edited_review: editedReview,
    });
    return success(c, {
      review: result.review_text,
      remainingRewrites: remainingRewrites(result.remaining_rewrites),
    });
  });

  app.post("/public-interview/sessions/:id/rewrite", async (c) => {
    const sessionId = requireUuid(c.req.param("id"));
    const idempotencyKey = requireMutationKey(c);
    const authentication = await sessionAuthentication(c);
    const repository = dependencies.repository(c);
    const session = await repository.validateSession(
      sessionId,
      authentication.hash,
    );
    const currentReview = requireString(session.edited_review, {
      code: "INVALID_REVIEW_TEXT",
      message: "口コミ文を確認してください。",
      min: 1,
      max: 800,
    });
    const hashes = await requestHashes(
      idempotencyKey,
      "POST",
      `/public-interview/sessions/${sessionId}/rewrite`,
      { currentReview },
    );
    const claim = await repository.claimRewrite({
      p_session_id: sessionId,
      p_token_hash: authentication.hash,
      p_session_subject_hash: await dependencies.secretDeriver.subjectHash(
        "session",
        `${sessionId}:${authentication.raw}`,
      ),
      p_idempotency_key_hash: hashes.keyHash,
      p_request_hash: hashes.requestHash,
      p_current_review: currentReview,
    });
    if (claim.replayed === true) return success(c, reviewResponse(claim));
    const operationId = dbValue.string(claim.operation_id, "OPERATION_ID");
    const storeId = dbValue.string(claim.store_id, "STORE_ID");
    try {
      const resolvedGeneration = await resolveGenerationDecision(
        dependencies,
        repository,
        operationId,
        sessionId,
        storeId,
        "rewrite",
      );
      if (resolvedGeneration.decision.kind === "unavailable") {
        return await rejectGeneration(
          repository,
          operationId,
          GENERATION_UNAVAILABLE_CODES[resolvedGeneration.decision.reason],
        );
      }
      if (!("credential" in resolvedGeneration)) {
        throw new Error("INVALID_BYOK_GENERATION_DECISION");
      }
      if (
        !providerModelsConfigured(
          dependencies.models,
          resolvedGeneration.credential.value.provider,
        )
      ) {
        return await rejectGeneration(
          repository,
          operationId,
          "AI_PROVIDER_NOT_CONFIGURED",
        );
      }
      const result = await new AiRuntime(
        repository,
        dependencies.models,
        dependencies.providerFactory ?? defaultProviderFactory,
      ).invoke({
        provider: resolvedGeneration.credential.value.provider,
        model: resolvedGeneration.credential.value.model,
        apiKey: resolvedGeneration.credential.apiKey,
        storeId,
        sessionId,
        operation: "review_rewrite",
        requestId: c.get("requestId"),
        currentReview,
      });
      return success(
        c,
        reviewResponse(
          await repository.completeRewriteResult(operationId, {
            ...result,
            source: "ai",
          }),
        ),
      );
    } catch (error) {
      if (error instanceof AppError && error.code === "AI_GENERATION_FAILED") {
        throw error;
      }
      return await rejectGeneration(
        repository,
        operationId,
        internalGenerationErrorCode(error),
      );
    }
  });

  app.post("/public-interview/sessions/:id/handoff", async (c) => {
    const sessionId = requireUuid(c.req.param("id"));
    const idempotencyKey = requireMutationKey(c);
    const body = await readJsonObject(c, 4_096);
    if (
      body.eventType !== "review_text_copied" &&
      body.eventType !== "google_review_opened"
    ) {
      throw appError(
        "INVALID_HANDOFF_INPUT",
        "操作内容を確認してください。",
        400,
      );
    }
    const editedReview = requireString(body.editedReview, {
      code: "INVALID_REVIEW_TEXT",
      message: "口コミ文は1〜800文字で入力してください。",
      min: 1,
      max: 800,
    });
    const authentication = await sessionAuthentication(c);
    const hashes = await requestHashes(
      idempotencyKey,
      "POST",
      `/public-interview/sessions/${sessionId}/handoff`,
      { eventType: body.eventType, editedReview },
    );
    const result = await dependencies.repository(c).recordHandoff({
      p_session_id: sessionId,
      p_token_hash: authentication.hash,
      p_session_subject_hash: await dependencies.secretDeriver.subjectHash(
        "session",
        `${sessionId}:${authentication.raw}`,
      ),
      p_idempotency_key_hash: hashes.keyHash,
      p_request_hash: hashes.requestHash,
      p_event_type: body.eventType,
      p_edited_review: editedReview,
    });
    return success(
      c,
      body.eventType === "google_review_opened"
        ? { recorded: true, googleReviewUrl: result.google_review_url }
        : { recorded: true },
    );
  });

  return app;
}
