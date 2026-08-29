import type { MiddlewareHandler } from "hono";
import { SecretDeriver } from "../_shared/ai-credentials.ts";
import {
  DEFAULT_SURVEY_CONFIG_V3,
  upcastSurveyConfigV3,
} from "../_shared/survey-config.ts";
import type { AppEnv } from "../_shared/types.ts";
import { createPublicInterviewApp } from "../public-interview/app.ts";
import { resolveGenerationDecision } from "../public-interview/generation/generation-decision.ts";
import { assert, assertEquals, assertRejects } from "./assert.ts";

const origin = "https://app.example.test";
const slug = "test-store-123456";
const sessionId = "11111111-1111-4111-8111-111111111111";
const mutationKey = "22222222-2222-4222-8222-222222222222";
const interviewToken = "a".repeat(43);
const keyBase64 = btoa(String.fromCharCode(...new Array(32).fill(9)));

const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("supabaseContext", {
    userClaims: null,
    jwtClaims: null,
    supabase: {} as never,
    supabaseAdmin: {} as never,
  });
  await next();
};

const cipher = {
  encrypt: () => Promise.reject(new Error("unused")),
  decrypt: () => Promise.reject(new Error("unused")),
};

const models = {
  openai: {
    interview: "openai-test-model",
    review: "openai-test-model",
    rewrite: "openai-test-model",
  },
  gemini: {
    interview: "gemini-test",
    review: "gemini-test",
    rewrite: "gemini-test",
  },
  deepseek: {
    interview: "deepseek-test",
    review: "deepseek-test",
    rewrite: "deepseek-test",
  },
  xai: { interview: "grok-test", review: "grok-test", rewrite: "grok-test" },
  anthropic: {
    interview: "claude-sonnet-5",
    review: "claude-sonnet-5",
    rewrite: "claude-sonnet-5",
  },
};

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test("public store DTO strips all internal and handoff fields", async () => {
  const repository = {
    publicStore: () =>
      Promise.resolve({
        store_id: "private-store-id",
        owner_id: "private-owner-id",
        public_slug: slug,
        name: "店舗",
        industry: "飲食",
        description: "説明",
        welcome_message: "ようこそ",
        closing_message: "ありがとう",
        google_review_url:
          "https://search.google.com/local/writereview?placeid=secret",
        google_maps_url:
          "https://www.google.com/maps/search/?api=1&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4",
        survey_config_json: DEFAULT_SURVEY_CONFIG_V3,
        provider: "openai",
        generation_model: "secret-model",
      }),
  };
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: cipher,
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: { verify: () => Promise.resolve(true) },
    models,
  });
  const response = await app.request(`/public-interview/stores/${slug}`, {
    headers: { Origin: origin },
  });
  const payload = await body(response);
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assert(response.headers.get("X-Request-Id") !== null);
  const serialized = JSON.stringify(payload);
  for (
    const forbidden of [
      "store_id",
      "owner_id",
      "google_review_url",
      "survey_config_json",
      "private-store-id",
      "secret-model",
      "openai",
    ]
  ) {
    assert(!serialized.includes(forbidden), `leaked ${forbidden}`);
  }
  assertEquals(
    (payload.data as Record<string, unknown>).googleMapsUrl,
    "https://www.google.com/maps/search/?api=1&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4",
  );
  const publicConfig = (payload.data as Record<string, unknown>)
    .surveyConfig as Record<string, unknown>;
  assertEquals(publicConfig.version, 3);
  assertEquals(publicConfig.revision, 1);
  assertEquals((publicConfig.questions as unknown[]).length, 7);
});

Deno.test("completed session-start replay skips single-use Turnstile and returns deterministic token", async () => {
  let turnstileCalls = 0;
  let startCalls = 0;
  const repository = {
    publicStore: () =>
      Promise.resolve({
        store_id: "33333333-3333-4333-8333-333333333333",
        public_slug: slug,
      }),
    replaySessionStart: () =>
      Promise.resolve({
        session_id: sessionId,
        expires_at: "2026-07-10T12:00:00.000Z",
      }),
    interviewSurveySnapshot: () =>
      Promise.resolve({
        survey_revision: 1,
        survey_config_json: DEFAULT_SURVEY_CONFIG_V3,
      }),
    startSession: () => {
      startCalls += 1;
      return Promise.reject(new Error("must not start"));
    },
  };
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: cipher,
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: {
      verify: () => {
        turnstileCalls += 1;
        return Promise.resolve(false);
      },
    },
    models,
  });
  const request = () =>
    app.request("/public-interview/sessions", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify({
        publicSlug: slug,
        turnstileToken: crypto.randomUUID(),
        locale: "ja",
      }),
    });
  const first = await body(await request());
  const second = await body(await request());
  assertEquals(turnstileCalls, 0);
  assertEquals(startCalls, 0);
  assertEquals(first, second);
});

Deno.test("session start independently resolves v4 variants once and returns only v3", async () => {
  const definition = upcastSurveyConfigV3(DEFAULT_SURVEY_CONFIG_V3);
  definition.questionGroups[2]!.variants.push({
    ...structuredClone(definition.questionGroups[2]!.variants[0]!),
    id: "q_0000000000a3",
    label: "選ばれるQ3",
  });
  definition.questionGroups[3]!.variants.push({
    ...structuredClone(definition.questionGroups[3]!.variants[0]!),
    id: "q_0000000000a4",
    label: "選ばれないQ4",
  });
  let bound: Record<string, unknown> | undefined;
  const repository = {
    publicStore: () =>
      Promise.resolve({
        store_id: "33333333-3333-4333-8333-333333333333",
        public_slug: slug,
        survey_config_json: definition,
      }),
    replaySessionStart: () => Promise.resolve(null),
    startSession: () =>
      Promise.resolve({
        session_id: sessionId,
        expires_at: "2026-07-10T12:00:00.000Z",
      }),
    bindInterviewSurveySnapshot: (
      _sessionId: string,
      _tokenHash: string,
      sourceRevision: number,
      selection: Record<string, unknown>,
      resolvedConfig: Record<string, unknown>,
    ) => {
      bound = { sourceRevision, selection, resolvedConfig };
      return Promise.resolve({
        survey_revision: sourceRevision,
        survey_config_json: resolvedConfig,
      });
    },
  };
  const samples = [0, 0, 0.75, 0.25, 0, 0, 0];
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: cipher,
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: { verify: () => Promise.resolve(true) },
    models,
    surveyRandom: () => samples.shift() ?? 0,
  });
  const response = await app.request("/public-interview/sessions", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
      "CF-Connecting-IP": "203.0.113.10",
    },
    body: JSON.stringify({
      publicSlug: slug,
      turnstileToken: "ok",
      locale: "ja",
    }),
  });
  assertEquals(response.status, 201);
  const payload = await body(response);
  const config = (payload.data as Record<string, unknown>)
    .surveyConfig as Record<string, unknown>;
  assertEquals(config.version, 3);
  assertEquals(
    (config.questions as Record<string, unknown>[])[2]?.id,
    "q_0000000000a3",
  );
  assert(!JSON.stringify(payload).includes("選ばれないQ4"));
  assertEquals(
    (bound?.selection as Record<string, unknown>).algorithm,
    "uniform_v1",
  );
});

Deno.test("session start returns the revision bound by a concurrent retry", async () => {
  const boundConfig = structuredClone(DEFAULT_SURVEY_CONFIG_V3);
  boundConfig.revision = 2;
  const repository = {
    publicStore: () =>
      Promise.resolve({
        store_id: "33333333-3333-4333-8333-333333333333",
        public_slug: slug,
        survey_config_json: DEFAULT_SURVEY_CONFIG_V3,
      }),
    replaySessionStart: () => Promise.resolve(null),
    startSession: () =>
      Promise.resolve({
        session_id: sessionId,
        expires_at: "2026-07-10T12:00:00.000Z",
      }),
    bindInterviewSurveySnapshot: () =>
      Promise.resolve({
        survey_revision: 2,
        survey_config_json: boundConfig,
      }),
  };
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: cipher,
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: { verify: () => Promise.resolve(true) },
    models,
  });

  const response = await app.request("/public-interview/sessions", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
      "CF-Connecting-IP": "203.0.113.10",
    },
    body: JSON.stringify({
      publicSlug: slug,
      turnstileToken: "ok",
      locale: "ja",
    }),
  });
  assertEquals(response.status, 201);
  const payload = await body(response);
  const data = payload.data as Record<string, unknown>;
  assertEquals(data.surveyRevision, 2);
  assertEquals(
    (data.surveyConfig as Record<string, unknown>).revision,
    2,
  );
});

Deno.test("Turnstile Siteverify idempotency UUID is separate for each attempt", async () => {
  const siteverifyKeys: string[] = [];
  const repository = {
    publicStore: () =>
      Promise.resolve({
        store_id: "33333333-3333-4333-8333-333333333333",
        public_slug: slug,
      }),
    replaySessionStart: () => Promise.resolve(null),
  };
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: cipher,
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: {
      verify: (input) => {
        siteverifyKeys.push(input.siteverifyIdempotencyKey);
        return Promise.resolve(false);
      },
    },
    models,
  });
  for (const challenge of ["challenge-one", "challenge-two"]) {
    const response = await app.request("/public-interview/sessions", {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify({
        publicSlug: slug,
        turnstileToken: challenge,
        locale: "ja",
      }),
    });
    assertEquals(response.status, 403);
  }
  assertEquals(siteverifyKeys.length, 2);
  assert(siteverifyKeys[0] !== siteverifyKeys[1]);
  assert(!siteverifyKeys.includes(mutationKey));
});

Deno.test("legacy profile and text turns are rejected before persistence", async () => {
  let claimCalls = 0;
  const repository = {
    claimTurn: () => {
      claimCalls += 1;
      return Promise.reject(new Error("legacy turn must not be persisted"));
    },
  };
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: cipher,
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: { verify: () => Promise.resolve(true) },
    models,
  });
  for (
    const turnBody of [
      { kind: "profile", visitFrequency: "unknown" },
      { kind: "text", content: "従来のチャット回答" },
    ]
  ) {
    const response = await app.request(
      `/public-interview/sessions/${sessionId}/turns`,
      {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          "X-Interview-Token": interviewToken,
        },
        body: JSON.stringify(turnBody),
      },
    );
    assertEquals(response.status, 400);
    const payload = await body(response);
    assertEquals(
      (payload.error as Record<string, unknown>).code,
      "INVALID_TURN_INPUT",
    );
  }
  assertEquals(claimCalls, 0);
});

Deno.test("dynamic survey validates the snapshot and completes without an AI provider", async () => {
  let claimParams: Record<string, unknown> | undefined;
  let providerCalls = 0;
  const repository = {
    interviewSurveySnapshot: () =>
      Promise.resolve({
        survey_revision: 1,
        survey_config_json: DEFAULT_SURVEY_CONFIG_V3,
      }),
    claimTurn: (params: Record<string, unknown>) => {
      claimParams = params;
      return Promise.resolve({
        operation_id: crypto.randomUUID(),
        store_id: crypto.randomUUID(),
        ai_turn_count: 0,
        interview_complete: true,
        replayed: false,
      });
    },
  };
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: cipher,
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: { verify: () => Promise.resolve(true) },
    models,
    providerFactory: () => {
      providerCalls += 1;
      throw new Error("survey must not invoke provider");
    },
  });
  const response = await app.request(
    `/public-interview/sessions/${sessionId}/turns`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
        "X-Interview-Token": interviewToken,
      },
      body: JSON.stringify({
        kind: "survey",
        surveyRevision: 1,
        answers: {
          q_000000000001: { type: "single_choice", value: "two_three" },
          q_000000000002: { type: "rating_5", value: 5 },
          q_000000000004: { type: "short_text", value: "ランチコース" },
          q_000000000005: {
            type: "long_text",
            value: "接客が丁寧で、料理もおいしかったです。",
          },
          q_000000000007: {
            type: "short_text",
            value: "待ち時間が少し長かったです。",
          },
        },
      }),
    },
  );

  assertEquals(response.status, 200);
  assertEquals(providerCalls, 0);
  assertEquals(claimParams?.p_kind, "survey");
  assertEquals(claimParams?.p_rating, 5);
  assertEquals(claimParams?.p_visit_frequency, "occasional");
  assertEquals(claimParams?.p_survey_revision, 1);
  assertEquals(
    claimParams?.p_structured_answers_json,
    {
      schemaVersion: 3,
      answers: {
        q_000000000001: { type: "single_choice", value: "two_three" },
        q_000000000002: { type: "rating_5", value: 5 },
        q_000000000004: { type: "short_text", value: "ランチコース" },
        q_000000000005: {
          type: "long_text",
          value: "接客が丁寧で、料理もおいしかったです。",
        },
        q_000000000007: {
          type: "short_text",
          value: "待ち時間が少し長かったです。",
        },
      },
    },
  );
  assert(
    !JSON.stringify(claimParams?.p_answer_chunks).includes("特になし"),
    "omitted answers must never be converted into customer statements",
  );
  const payload = await body(response);
  const data = payload.data as Record<string, unknown>;
  assertEquals(data.turnCount, 0);
  assertEquals(data.next, { kind: "ready_for_review" });
});

Deno.test("dynamic survey rejects unknown, missing, mismatched, and out-of-range answers", async () => {
  let claimCalls = 0;
  const repository = {
    interviewSurveySnapshot: () =>
      Promise.resolve({ survey_config_json: DEFAULT_SURVEY_CONFIG_V3 }),
    claimTurn: () => {
      claimCalls += 1;
      return Promise.reject(new Error("invalid input reached persistence"));
    },
  };
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: cipher,
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: { verify: () => Promise.resolve(true) },
    models,
  });
  const required = {
    q_000000000004: { type: "short_text", value: "ランチ" },
    q_000000000005: { type: "long_text", value: "説明を聞いた場面です。" },
  };
  const invalidAnswers = [
    { ...required, q_ffffffffffff: { type: "short_text", value: "未知" } },
    { q_000000000004: required.q_000000000004 },
    {
      ...required,
      q_000000000002: { type: "short_text", value: "5" },
    },
    {
      ...required,
      q_000000000004: { type: "short_text", value: "あ".repeat(121) },
    },
    {
      ...required,
      q_000000000001: { type: "single_choice", value: "not_an_option" },
    },
    {
      ...required,
      q_000000000003: { type: "single_choice", value: "other:" },
    },
  ];
  for (const answers of invalidAnswers) {
    const response = await app.request(
      `/public-interview/sessions/${sessionId}/turns`,
      {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          "X-Interview-Token": interviewToken,
        },
        body: JSON.stringify({ kind: "survey", surveyRevision: 1, answers }),
      },
    );
    assertEquals(response.status, 400);
  }
  assertEquals(claimCalls, 0);
});

Deno.test("ratings 1 through 5 and omission all reach the same completion response", async () => {
  const persistedRatings: Array<number | null> = [];
  const repository = {
    interviewSurveySnapshot: () =>
      Promise.resolve({ survey_config_json: DEFAULT_SURVEY_CONFIG_V3 }),
    claimTurn: (params: Record<string, unknown>) => {
      persistedRatings.push(params.p_rating as number | null);
      return Promise.resolve({ ai_turn_count: 0 });
    },
  };
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: cipher,
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: { verify: () => Promise.resolve(true) },
    models,
  });
  for (const rating of [1, 2, 3, 4, 5, null]) {
    const answers: Record<string, unknown> = {
      q_000000000004: { type: "short_text", value: "ランチ" },
      q_000000000005: { type: "long_text", value: "説明を聞いた場面です。" },
    };
    if (rating !== null) {
      answers.q_000000000002 = { type: "rating_5", value: rating };
    }
    const response = await app.request(
      `/public-interview/sessions/${sessionId}/turns`,
      {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          "X-Interview-Token": interviewToken,
        },
        body: JSON.stringify({ kind: "survey", surveyRevision: 1, answers }),
      },
    );
    assertEquals(response.status, 200);
    const payload = await body(response);
    assertEquals(
      (payload.data as Record<string, unknown>).next,
      { kind: "ready_for_review" },
    );
  }
  assertEquals(persistedRatings, [1, 2, 3, 4, 5, null]);
});

Deno.test("maximum valid twelve-question answers are split into bounded chunks", async () => {
  const questions = Array.from({ length: 12 }, (_, index) => {
    const id = `q_${(index + 1).toString(16).padStart(12, "0")}`;
    if (index < 6) {
      return {
        id,
        type: "long_text",
        label: `長文設問${index + 1}`,
        required: index < 4,
        maxLength: 400,
      };
    }
    return {
      id,
      type: "multi_choice",
      label: `選択設問${index + 1}`,
      required: false,
      options: Array.from({ length: 8 }, (_, optionIndex) => ({
        value: `option_${optionIndex + 1}`,
        label: `選択肢${optionIndex + 1}`,
      })),
      maxSelections: 8,
    };
  });
  const config = {
    version: 3,
    presetId: null,
    title: "最大構成",
    description: "チャンク分割を確認します。",
    questions,
    revision: 9,
  };
  const answers = Object.fromEntries(questions.map((question, index) => [
    question.id,
    index < 6 ? { type: "long_text", value: "あ".repeat(400) } : {
      type: "multi_choice",
      value: Array.from(
        { length: 8 },
        (_, optionIndex) => `option_${optionIndex + 1}`,
      ),
    },
  ]));
  let claimParams: Record<string, unknown> | undefined;
  const repository = {
    interviewSurveySnapshot: () =>
      Promise.resolve({ survey_config_json: config }),
    claimTurn: (params: Record<string, unknown>) => {
      claimParams = params;
      return Promise.resolve({ ai_turn_count: 0 });
    },
  };
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: cipher,
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: { verify: () => Promise.resolve(true) },
    models,
  });
  const response = await app.request(
    `/public-interview/sessions/${sessionId}/turns`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
        "X-Interview-Token": interviewToken,
      },
      body: JSON.stringify({ kind: "survey", surveyRevision: 9, answers }),
    },
  );
  assertEquals(response.status, 200);
  const chunks = claimParams?.p_answer_chunks as string[];
  assert(chunks.length > 1 && chunks.length <= 12);
  assert(chunks.every((chunk) => chunk.length >= 1 && chunk.length <= 1000));
  assert(
    JSON.stringify(claimParams?.p_structured_answers_json).length < 16_384,
  );
});

Deno.test("credential decryption failure returns a generic error and records the unreadable credential reason", async () => {
  const operationId = crypto.randomUUID();
  const storeId = crypto.randomUUID();
  let providerCalls = 0;
  let failed: { operationId: string; errorCode: string } | undefined;
  const repository = {
    claimReview: () =>
      Promise.resolve({
        operation_id: operationId,
        store_id: storeId,
        generation_mode: "ai",
        replayed: false,
      }),
    getActiveConnection: () =>
      Promise.resolve({
        storeId,
        provider: "openai" as const,
        model: "openai-test-model",
        ciphertext: "invalid",
        iv: "invalid",
        keyVersion: 1,
        keyLast4: "test",
      }),
    failOperation: (receivedOperationId: string, errorCode: string) => {
      failed = { operationId: receivedOperationId, errorCode };
      return Promise.resolve();
    },
  };
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: {
      encrypt: () => Promise.reject(new Error("unused")),
      decrypt: () => Promise.reject(new Error("CREDENTIAL_DECRYPTION_FAILED")),
    },
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: { verify: () => Promise.resolve(true) },
    models,
    providerFactory: () => {
      providerCalls += 1;
      throw new Error("provider must not be invoked after decryption failure");
    },
  });

  const response = await app.request(
    `/public-interview/sessions/${sessionId}/review`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Idempotency-Key": mutationKey,
        "X-Interview-Token": interviewToken,
      },
    },
  );
  const payload = await body(response);
  assertEquals(response.status, 503);
  assertEquals(providerCalls, 0);
  assertEquals(failed, {
    operationId,
    errorCode: "AI_BYOK_CREDENTIAL_UNREADABLE",
  });
  assertEquals(
    (payload.error as Record<string, unknown>).code,
    "AI_GENERATION_FAILED",
  );
  assertEquals(
    (payload.error as Record<string, unknown>).message,
    "エラーが発生しました。",
  );
});

Deno.test("unexpected generation bugs are hidden from the visitor and retain their internal code", async () => {
  const operationId = crypto.randomUUID();
  let completed = 0;
  let failed: { operationId: string; errorCode: string } | undefined;
  const repository = {
    claimReview: () =>
      Promise.resolve({
        operation_id: operationId,
        store_id: crypto.randomUUID(),
        generation_mode: "ai",
        replayed: false,
      }),
    getActiveConnection: () => Promise.reject(new Error("PROGRAMMING_BUG")),
    completeReviewResult: () => {
      completed += 1;
      return Promise.reject(new Error("must not complete"));
    },
    failOperation: (receivedOperationId: string, errorCode: string) => {
      failed = { operationId: receivedOperationId, errorCode };
      return Promise.resolve();
    },
  };
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: cipher,
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: { verify: () => Promise.resolve(true) },
    models,
  });

  const response = await app.request(
    `/public-interview/sessions/${sessionId}/review`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Idempotency-Key": mutationKey,
        "X-Interview-Token": interviewToken,
      },
    },
  );
  const payload = await body(response);
  assertEquals(response.status, 503);
  assertEquals(completed, 0);
  assertEquals(failed, { operationId, errorCode: "PROGRAMMING_BUG" });
  assertEquals(
    (payload.error as Record<string, unknown>).message,
    "エラーが発生しました。",
  );
});

Deno.test("expired review lease is retryable with a fresh client key", async () => {
  const oldOperationId = "33333333-3333-4333-8333-333333333333";
  const newOperationId = "44444444-4444-4444-8444-444444444444";
  const claimedKeyHashes: string[] = [];
  const failedOperations: Array<{ operationId: string; errorCode: string }> =
    [];
  let claimCount = 0;
  const storeId = "55555555-5555-4555-8555-555555555555";
  const repository = {
    claimReview: (input: Record<string, unknown>) => {
      claimedKeyHashes.push(String(input.p_idempotency_key_hash));
      claimCount += 1;
      return Promise.resolve({
        operation_id: claimCount === 1 ? oldOperationId : newOperationId,
        store_id: storeId,
        generation_mode: "ai",
        rewrite_limit: 2,
        replayed: false,
      });
    },
    getInterviewContext: () =>
      Promise.resolve({
        storeId,
        sessionId,
        storeName: "店舗",
        industry: "飲食",
        locale: "ja" as const,
        rating: null,
        visitFrequency: null,
        structuredAnswers: {
          serviceUsed: "ランチ",
          memorablePoints: "料理が温かかったです。",
        },
        messages: [],
        currentReview: null,
      }),
    getActiveConnection: () =>
      Promise.resolve({
        storeId,
        provider: "openai" as const,
        model: "openai-test-model",
        ciphertext: "ciphertext",
        iv: "iv",
        keyVersion: 1,
        keyLast4: "test",
      }),
    completeReviewResult: (
      operationId: string,
      result: Record<string, unknown>,
    ) => {
      if (operationId === oldOperationId) {
        return Promise.reject(new Error("OPERATION_LEASE_EXPIRED"));
      }
      return Promise.resolve({
        review_text: result.text,
        rewrite_count: 0,
        rewrite_limit: 2,
        remaining_rewrites: 2,
        generation_source: result.source,
      });
    },
    failOperation: (operationId: string, errorCode: string) => {
      failedOperations.push({ operationId, errorCode });
      return Promise.resolve();
    },
  };
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: {
      encrypt: () => Promise.reject(new Error("unused")),
      decrypt: () => Promise.resolve("byok-secret"),
    },
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: { verify: () => Promise.resolve(true) },
    models,
    providerFactory: () =>
      ({
        generateReview: (input: { requestId: string }) =>
          Promise.resolve({
            text: "AIが生成した口コミ文です。",
            provider: "openai" as const,
            model: "openai-test-model",
            inputTokens: 10,
            outputTokens: 10,
            generatedCharacters: 12,
            providerRequestId: "provider-request",
            requestId: input.requestId,
          }),
      }) as never,
  });

  const expiredResponse = await app.request(
    `/public-interview/sessions/${sessionId}/review`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Idempotency-Key": mutationKey,
        "X-Interview-Token": interviewToken,
      },
    },
  );
  const expiredPayload = await body(expiredResponse);
  assertEquals(expiredResponse.status, 503);
  assertEquals(
    (expiredPayload.error as Record<string, unknown>).code,
    "AI_GENERATION_FAILED",
  );
  assertEquals(
    (expiredPayload.error as Record<string, unknown>).retryable,
    true,
  );

  const retryResponse = await app.request(
    `/public-interview/sessions/${sessionId}/review`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Idempotency-Key": "66666666-6666-4666-8666-666666666666",
        "X-Interview-Token": interviewToken,
      },
    },
  );
  assertEquals(retryResponse.status, 200);
  assertEquals(failedOperations, [{
    operationId: oldOperationId,
    errorCode: "OPERATION_LEASE_EXPIRED",
  }]);
  assertEquals(claimedKeyHashes.length, 2);
  assert(claimedKeyHashes[0] !== claimedKeyHashes[1]);
});

Deno.test("rewrite generation failure preserves the current review and records the internal reason", async () => {
  const currentReview = "利用者が自分で編集した率直な口コミ文です。";
  const operationId = crypto.randomUUID();
  const storeId = crypto.randomUUID();
  let contextCalls = 0;
  let failed: { operationId: string; errorCode: string } | undefined;
  const repository = {
    validateSession: () =>
      Promise.resolve({
        edited_review: currentReview,
        rewrite_count: 3,
        rewrite_limit: 8,
        remaining_rewrites: 5,
      }),
    claimRewrite: () =>
      Promise.resolve({
        operation_id: operationId,
        store_id: storeId,
        generation_mode: "ai",
        rewrite_count: 4,
        rewrite_limit: 8,
        remaining_rewrites: 4,
        replayed: false,
      }),
    getActiveConnection: () =>
      Promise.resolve({
        storeId,
        provider: "openai" as const,
        model: "openai-test-model",
        ciphertext: "invalid",
        iv: "invalid",
        keyVersion: 1,
        keyLast4: "test",
      }),
    getInterviewContext: () => {
      contextCalls += 1;
      return Promise.reject(
        new Error("rewrite fallback must not rebuild text"),
      );
    },
    failOperation: (receivedOperationId: string, errorCode: string) => {
      failed = { operationId: receivedOperationId, errorCode };
      return Promise.resolve();
    },
  };
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: {
      encrypt: () => Promise.reject(new Error("unused")),
      decrypt: () => Promise.reject(new Error("CREDENTIAL_DECRYPTION_FAILED")),
    },
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: { verify: () => Promise.resolve(true) },
    models,
  });

  const response = await app.request(
    `/public-interview/sessions/${sessionId}/rewrite`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Idempotency-Key": mutationKey,
        "X-Interview-Token": interviewToken,
      },
    },
  );
  const payload = await body(response);
  assertEquals(response.status, 503);
  assertEquals(contextCalls, 0);
  assertEquals(failed, {
    operationId,
    errorCode: "AI_BYOK_CREDENTIAL_UNREADABLE",
  });
  assertEquals(
    (payload.error as Record<string, unknown>).message,
    "エラーが発生しました。",
  );
});

Deno.test("expired rewrite lease is retryable with a fresh client key", async () => {
  const oldOperationId = "77777777-7777-4777-8777-777777777777";
  const newOperationId = "88888888-8888-4888-8888-888888888888";
  const claimedKeyHashes: string[] = [];
  const failedOperations: Array<{ operationId: string; errorCode: string }> =
    [];
  let claimCount = 0;
  const currentReview = "元の口コミ文です。";
  const storeId = "99999999-9999-4999-8999-999999999999";
  const repository = {
    validateSession: () =>
      Promise.resolve({ edited_review: currentReview, rewrite_count: 0 }),
    claimRewrite: (input: Record<string, unknown>) => {
      claimedKeyHashes.push(String(input.p_idempotency_key_hash));
      claimCount += 1;
      return Promise.resolve({
        operation_id: claimCount === 1 ? oldOperationId : newOperationId,
        store_id: storeId,
        generation_mode: "ai",
        rewrite_limit: 2,
        replayed: false,
      });
    },
    getInterviewContext: () =>
      Promise.resolve({
        storeId,
        sessionId,
        storeName: "店舗",
        industry: "飲食",
        locale: "ja" as const,
        rating: null,
        visitFrequency: null,
        structuredAnswers: {},
        messages: [],
        currentReview,
      }),
    getActiveConnection: () =>
      Promise.resolve({
        storeId,
        provider: "openai" as const,
        model: "openai-test-model",
        ciphertext: "ciphertext",
        iv: "iv",
        keyVersion: 1,
        keyLast4: "test",
      }),
    completeRewriteResult: (
      operationId: string,
      result: Record<string, unknown>,
    ) => {
      if (operationId === oldOperationId) {
        return Promise.reject(new Error("OPERATION_LEASE_EXPIRED"));
      }
      return Promise.resolve({
        review_text: result.text,
        rewrite_count: 1,
        rewrite_limit: 2,
        remaining_rewrites: 1,
        generation_source: result.source,
      });
    },
    failOperation: (operationId: string, errorCode: string) => {
      failedOperations.push({ operationId, errorCode });
      return Promise.resolve();
    },
  };
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: {
      encrypt: () => Promise.reject(new Error("unused")),
      decrypt: () => Promise.resolve("byok-secret"),
    },
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: { verify: () => Promise.resolve(true) },
    models,
    providerFactory: () =>
      ({
        rewriteReview: (input: { requestId: string }) =>
          Promise.resolve({
            text: "AIが書き直した口コミ文です。",
            provider: "openai" as const,
            model: "openai-test-model",
            inputTokens: 10,
            outputTokens: 10,
            generatedCharacters: 14,
            providerRequestId: "provider-request",
            requestId: input.requestId,
          }),
      }) as never,
  });

  const expiredResponse = await app.request(
    `/public-interview/sessions/${sessionId}/rewrite`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Idempotency-Key": mutationKey,
        "X-Interview-Token": interviewToken,
      },
    },
  );
  const expiredPayload = await body(expiredResponse);
  assertEquals(expiredResponse.status, 503);
  assertEquals(
    (expiredPayload.error as Record<string, unknown>).code,
    "AI_GENERATION_FAILED",
  );

  const retryResponse = await app.request(
    `/public-interview/sessions/${sessionId}/rewrite`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Idempotency-Key": "aaaaaaaa-7777-4777-8777-777777777777",
        "X-Interview-Token": interviewToken,
      },
    },
  );
  assertEquals(retryResponse.status, 200);
  assertEquals(failedOperations, [{
    operationId: oldOperationId,
    errorCode: "OPERATION_LEASE_EXPIRED",
  }]);
  assertEquals(claimedKeyHashes.length, 2);
  assert(claimedKeyHashes[0] !== claimedKeyHashes[1]);
});

Deno.test("copy handoff never exposes the Google URL", async () => {
  const repository = {
    recordHandoff: () =>
      Promise.resolve({
        google_review_url:
          "https://search.google.com/local/writereview?placeid=must-not-leak",
      }),
  };
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: cipher,
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: { verify: () => Promise.resolve(true) },
    models,
  });
  const response = await app.request(
    `/public-interview/sessions/${sessionId}/handoff`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
        "X-Interview-Token": interviewToken,
      },
      body: JSON.stringify({
        eventType: "review_text_copied",
        editedReview: "率直な口コミ文です。",
      }),
    },
  );
  assertEquals(response.status, 200);
  const serialized = JSON.stringify(await body(response));
  assert(!serialized.includes("googleReviewUrl"));
  assert(!serialized.includes("must-not-leak"));
});

Deno.test("short rate-limit failures return Retry-After and expose it to the browser", async () => {
  const repository = {
    interviewSurveySnapshot: () =>
      Promise.resolve({ survey_config_json: DEFAULT_SURVEY_CONFIG_V3 }),
    claimTurn: () => Promise.reject(new Error("RATE_LIMIT_EXCEEDED")),
  };
  const app = createPublicInterviewApp({
    allowedOrigins: new Set([origin]),
    authMiddleware,
    repository: () => repository as never,
    credentialCipher: cipher,
    secretDeriver: await SecretDeriver.create(keyBase64, keyBase64),
    turnstile: { verify: () => Promise.resolve(true) },
    models,
  });
  const response = await app.request(
    `/public-interview/sessions/${sessionId}/turns`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
        "X-Interview-Token": interviewToken,
      },
      body: JSON.stringify({
        kind: "survey",
        surveyRevision: 1,
        answers: {
          q_000000000004: { type: "short_text", value: "ランチ" },
          q_000000000005: { type: "long_text", value: "接客が丁寧でした。" },
        },
      }),
    },
  );
  assertEquals(response.status, 429);
  assertEquals(response.headers.get("Retry-After"), "60");
  assert(
    response.headers.get("Access-Control-Expose-Headers")?.includes(
      "Retry-After",
    ),
  );
});

Deno.test("generation is unavailable when BYOK is not configured", async () => {
  const resolved = await resolveGenerationDecision(
    { credentialCipher: cipher },
    { getActiveConnection: () => Promise.resolve(null) },
    crypto.randomUUID(),
    sessionId,
    crypto.randomUUID(),
    "review",
  );
  assertEquals(resolved, {
    decision: { kind: "unavailable", reason: "byok_not_configured" },
  });
});

Deno.test("generation resolves the active owner credential", async () => {
  const storeId = crypto.randomUUID();
  const resolved = await resolveGenerationDecision(
    {
      credentialCipher: {
        encrypt: () => Promise.reject(new Error("unused")),
        decrypt: () => Promise.resolve("owner-secret"),
      },
    },
    {
      getActiveConnection: () =>
        Promise.resolve({
          storeId,
          provider: "openai" as const,
          model: "openai-test-model",
          ciphertext: "ciphertext",
          iv: "iv",
          keyVersion: 1,
          keyLast4: "cret",
        }),
    },
    crypto.randomUUID(),
    sessionId,
    storeId,
    "review",
  );
  assertEquals(resolved, {
    decision: {
      kind: "ai",
      source: "byok",
      provider: "openai",
      model: "openai-test-model",
    },
    credential: {
      value: {
        storeId,
        provider: "openai",
        model: "openai-test-model",
        ciphertext: "ciphertext",
        iv: "iv",
        keyVersion: 1,
        keyLast4: "cret",
      },
      apiKey: "owner-secret",
    },
  });
});

Deno.test("generation fails closed without the BYOK repository contract", async () => {
  await assertRejects(
    () =>
      resolveGenerationDecision(
        { credentialCipher: cipher },
        {},
        crypto.randomUUID(),
        sessionId,
        crypto.randomUUID(),
        "rewrite",
      ),
    "INVALID_BYOK_CREDENTIAL_REPOSITORY",
  );
});
