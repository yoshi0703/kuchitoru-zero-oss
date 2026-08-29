import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../_shared/types.ts";
import {
  canonicalSurveyConfig,
  DEFAULT_SURVEY_CONFIG_V3 as DEFAULT_SURVEY_CONFIG,
  normalizeSurveyConfigV3,
  SURVEY_GROUP_ID_PATTERN,
  SURVEY_QUESTION_ID_PATTERN,
  upcastSurveyConfigV2,
  upcastSurveyConfigV3,
} from "../_shared/survey-config.ts";
import { createOwnerApp, ownerInternals } from "../owner-api/app.ts";
import { assert, assertEquals } from "./assert.ts";

const origin = "https://app.example.test";
const ownerId = "11111111-1111-4111-8111-111111111111";
const storeId = "44444444-4444-4444-8444-444444444444";
const mutationKey = "22222222-2222-4222-8222-222222222222";
const nowMs = Date.UTC(2026, 6, 10, 6, 0, 0);
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
const cipher = {
  encrypt: () => Promise.reject(new Error("unused")),
  decrypt: () => Promise.reject(new Error("unused")),
};

function authMiddleware(
  claims: Record<string, unknown>,
  calls: { signOut: number; delete: number },
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("supabaseContext", {
      userClaims: { id: ownerId },
      jwtClaims: claims,
      supabase: {} as never,
      supabaseAdmin: {
        schema: () => ({
          rpc: () => Promise.resolve({ data: null, error: null }),
          from: () => undefined,
        }),
        auth: {
          admin: {
            signOut: () => {
              calls.signOut += 1;
              return Promise.resolve({ error: null });
            },
            deleteUser: () => {
              calls.delete += 1;
              return Promise.resolve({ error: null });
            },
          },
        },
      },
    });
    await next();
  };
}

function ownerRepository(overrides: Record<string, unknown> = {}) {
  return {
    claimOwnerOperation: () =>
      Promise.resolve({
        operation_id: "33333333-3333-4333-8333-333333333333",
        replayed: false,
      }),
    claimStoreOperation: () =>
      Promise.resolve({
        operation_id: "33333333-3333-4333-8333-333333333333",
        replayed: false,
      }),
    completeOwnerOperation: () => Promise.resolve({}),
    failOperation: () => Promise.resolve(),
    purgeOwnerIdempotency: () => Promise.resolve(0),
    ownerSurveyConfig: () => Promise.resolve(DEFAULT_SURVEY_CONFIG),
    ...overrides,
  };
}

Deno.test("owner store list preserves the effective public availability field", async () => {
  const calls = { signOut: 0, delete: 0 };
  const stores = [{
    id: storeId,
    owner_store_slot: 1,
    status: "published",
    is_publicly_available: false,
  }];
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () =>
      ownerRepository({
        ownerStores: () => Promise.resolve(stores),
      }) as never,
    credentialCipher: cipher,
    models,
  });

  const response = await app.request("/owner-api/v2/stores", {
    headers: { Origin: origin },
  });

  assertEquals(response.status, 200);
  assertEquals(await response.json(), { success: true, data: stores });
});

Deno.test("Community capabilities and version expose no installer secrets", async () => {
  const calls = { signOut: 0, delete: 0 };
  const emptyModels = Object.fromEntries(
    ["openai", "gemini", "deepseek", "xai", "anthropic"].map((provider) => [
      provider,
      { interview: "", review: "", rewrite: "" },
    ]),
  ) as typeof models;
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () => ownerRepository() as never,
    credentialCipher: cipher,
    models: emptyModels,
    gitSha: "0123456789abcdef0123456789abcdef01234567",
  });
  const capabilities = await app.request("/owner-api/system-capabilities", {
    headers: { Origin: origin },
  });
  assertEquals(capabilities.status, 200);
  assertEquals((await capabilities.json()).data, {
    edition: "community",
    aiMode: "byok",
    providers: ["openai", "gemini", "deepseek", "xai", "anthropic"].map(
      (provider) => ({ provider, available: false }),
    ),
    integrations: {
      googleBusiness: true,
      instagram: true,
      dataForSeo: true,
    },
  });
  const version = await app.request("/owner-api/version", {
    headers: { Origin: origin },
  });
  assertEquals((await version.json()).data, {
    version: "1.0.0",
    gitSha: "0123456789abcdef0123456789abcdef01234567",
    dbSchemaVersion: "20260829000000",
  });
});

Deno.test("legacy store routes fail closed instead of falling back to slot 2", async () => {
  const slotTwoId = "55555555-5555-4555-8555-555555555555";
  const surveyConfig = structuredClone(DEFAULT_SURVEY_CONFIG);
  const reads = [
    "/owner-api/survey-config",
    "/owner-api/survey-revisions",
    "/owner-api/ai-connection",
    "/owner-api/ai-connections",
  ];
  const mutations = [
    {
      method: "PUT",
      url: "/owner-api/store",
      body: { name: "Must not overwrite slot 2" },
    },
    {
      method: "PUT",
      url: "/owner-api/survey-config",
      body: surveyConfig,
    },
    { method: "POST", url: "/owner-api/store/publish", body: undefined },
    { method: "POST", url: "/owner-api/store/pause", body: undefined },
    {
      method: "POST",
      url: "/owner-api/ai-connection/validate-and-save",
      body: { provider: "openai", apiKey: "not-a-real-provider-key" },
    },
    {
      method: "POST",
      url: "/owner-api/ai-connection/revalidate",
      body: { provider: "openai" },
    },
    {
      method: "POST",
      url: "/owner-api/ai-connection/select-provider",
      body: { provider: "openai" },
    },
    {
      method: "POST",
      url: "/owner-api/ai-connection/select-model",
      body: { provider: "openai", model: "openai-test-model" },
    },
    {
      method: "DELETE",
      url: "/owner-api/ai-connection?provider=openai",
      body: undefined,
    },
  ] as const;
  let slotTwoTouches = 0;
  const forbidden = () => {
    slotTwoTouches += 1;
    return Promise.reject(new Error("must not touch slot 2"));
  };
  const repository = ownerRepository({
    ownerStores: () =>
      Promise.resolve([{ id: slotTwoId, owner_store_slot: 2 }]),
    claimStoreOperation: forbidden,
    ownerStore: forbidden,
    createStore: forbidden,
    updateStore: forbidden,
    ownerSurveyConfig: forbidden,
    updateSurveyConfig: forbidden,
    ownerSurveyRevisions: forbidden,
    setStoreStatus: forbidden,
    aiConnections: forbidden,
    getConnection: forbidden,
    saveConnection: forbidden,
    deleteConnection: forbidden,
    markConnection: forbidden,
    selectProvider: forbidden,
    selectModel: forbidden,
  });
  const createApp = () => {
    const calls = { signOut: 0, delete: 0 };
    return createOwnerApp({
      allowedOrigins: new Set([origin]),
      authMiddleware: authMiddleware({}, calls),
      repository: () => repository as never,
      credentialCipher: cipher,
      models,
    });
  };

  for (const url of reads) {
    const response = await createApp().request(url, {
      headers: { Origin: origin },
    });
    assertEquals(response.status, 404, url);
  }
  for (const testCase of mutations) {
    const headers: Record<string, string> = {
      Origin: origin,
      "Idempotency-Key": mutationKey,
    };
    if (testCase.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const response = await createApp().request(testCase.url, {
      method: testCase.method,
      headers,
      body: testCase.body === undefined
        ? undefined
        : JSON.stringify(testCase.body),
    });
    assertEquals(response.status, 404, testCase.url);
  }
  assertEquals(slotTwoTouches, 0);
});

Deno.test("store slot exhaustion returns a safe operational error", async () => {
  const calls = { signOut: 0, delete: 0 };
  const repository = ownerRepository({
    createStore: () => Promise.reject(new Error("STORE_SLOT_EXHAUSTED")),
  });
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () => repository as never,
    credentialCipher: cipher,
    models,
  });

  const response = await app.request("/owner-api/v2/stores", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({ name: "Store 101" }),
  });
  assertEquals(response.status, 409);
  assertEquals(await response.json(), {
    success: false,
    error: {
      code: "STORE_SLOT_EXHAUSTED",
      message: "登録できる店舗は100件までです。",
      retryable: false,
    },
  });
});

Deno.test("account deletion rejects old AMR and accepts a fresh verified AMR", async () => {
  const freshTimestamp = Math.floor(nowMs / 1000) - 60;
  const oldTimestamp = Math.floor(nowMs / 1000) - 600;
  assertEquals(
    ownerInternals.recentReauthentication({
      amr: [{ method: "password", timestamp: oldTimestamp }],
    }, nowMs),
    false,
  );
  assertEquals(
    ownerInternals.recentReauthentication({
      amr: [{ method: "password", timestamp: freshTimestamp }],
    }, nowMs),
    true,
  );

  for (
    const [timestamp, expected] of [[oldTimestamp, 409], [
      freshTimestamp,
      200,
    ]] as const
  ) {
    const calls = { signOut: 0, delete: 0 };
    const purgeArguments: Array<string | null> = [];
    const repository = ownerRepository({
      purgeOwnerIdempotency: (_owner: string, keep: string | null) => {
        purgeArguments.push(keep);
        return Promise.resolve(0);
      },
    });
    const app = createOwnerApp({
      allowedOrigins: new Set([origin]),
      authMiddleware: authMiddleware({
        amr: [{ method: "password", timestamp }],
      }, calls),
      repository: () => repository as never,
      credentialCipher: cipher,
      models,
      now: () => nowMs,
    });
    const response = await app.request("/owner-api/account", {
      method: "DELETE",
      headers: {
        Origin: origin,
        Authorization: "Bearer verified-user-jwt",
        "Idempotency-Key": mutationKey,
      },
    });
    assertEquals(response.status, expected);
    assertEquals(calls.delete, expected === 200 ? 1 : 0);
    assertEquals(purgeArguments.length, expected === 200 ? 2 : 0);
    if (expected === 200) assertEquals(purgeArguments[1], null);
  }
});

Deno.test("new public slug is server-generated and a client slug is ignored", async () => {
  const calls = { signOut: 0, delete: 0 };
  let input: Record<string, unknown> | undefined;
  let createOperationId = "";
  const repository = ownerRepository({
    createStore: (
      _owner: string,
      operationId: string,
      value: Record<string, unknown>,
    ) => {
      createOperationId = operationId;
      input = value;
      return Promise.resolve({
        id: crypto.randomUUID(),
        public_slug: value.publicSlug,
        name: value.name,
      });
    },
  });
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () => repository as never,
    credentialCipher: cipher,
    models,
  });
  const response = await app.request("/owner-api/v2/stores", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({
      name: "店舗",
      publicSlug: "attacker-selected-public-slug",
    }),
  });
  assertEquals(response.status, 200);
  assertEquals(
    createOperationId,
    "33333333-3333-4333-8333-333333333333",
  );
  assert(input?.publicSlug !== "attacker-selected-public-slug");
  assert(/^[a-z0-9]{32}$/.test(String(input?.publicSlug)));
});

Deno.test("owner survey revisions are returned only through the authenticated owner API", async () => {
  const calls = { signOut: 0, delete: 0 };
  const revisions = [{ revision: 1, config: DEFAULT_SURVEY_CONFIG }];
  const repository = ownerRepository({
    ownerSurveyRevisions: (requestedOwnerId: string) => {
      assertEquals(requestedOwnerId, ownerId);
      return Promise.resolve(revisions);
    },
  });
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () => repository as never,
    credentialCipher: cipher,
    models,
  });

  const response = await app.request(
    `/owner-api/v2/stores/${storeId}/survey-revisions`,
    {
      headers: { Origin: origin, Authorization: "Bearer owner-jwt" },
    },
  );

  assertEquals(response.status, 200);
  assertEquals((await response.json()).data, revisions);
});

Deno.test("owner capabilities are server-timed, store-scoped, and safely projected", async () => {
  const calls = { signOut: 0, delete: 0 };
  const repositoryCalls: Array<{
    owner: string;
    store: string;
    evaluatedAt: string;
  }> = [];
  const featureRows = [
    ["instagram_to_gbp", "hidden", "native", null],
    ["gbp_health", "hidden", "native", null],
    ["gbp_insights", "available", "native", "2026-07-10T06:00:00Z"],
    ["meo_rank", "paused", "owner_provider", "2026-07-03T06:00:00Z"],
    ["review_reply", "hidden", "owner_provider", null],
  ].map(([featureKey, state, executionMode, releaseAt]) => ({
    feature_key: featureKey,
    state,
    visible: state !== "hidden",
    available: state === "available",
    execution_mode: executionMode,
    release_at: releaseAt,
    operator_id: "must-not-leak@example.test",
    kill_switch: true,
  }));
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () =>
      ownerRepository({
        ownerStores: () =>
          Promise.resolve([{
            id: storeId,
            owner_store_slot: 1,
          }]),
        ownerFeatureCapabilities: (
          owner: string,
          store: string,
          evaluatedAt: string,
        ) => {
          repositoryCalls.push({ owner, store, evaluatedAt });
          return Promise.resolve(featureRows);
        },
      }) as never,
    credentialCipher: cipher,
    models,
    now: () => nowMs,
  });

  const response = await app.request(
    "/owner-api/v2/feature-capabilities",
    { headers: { Origin: origin } },
  );
  assertEquals(response.status, 200);
  assertEquals(repositoryCalls, [{
    owner: ownerId,
    store: storeId,
    evaluatedAt: new Date(nowMs).toISOString(),
  }]);
  assertEquals(await response.json(), {
    success: true,
    data: {
      serverTime: new Date(nowMs).toISOString(),
      features: [
        {
          key: "gbp_insights",
          title: "Googleマップ分析",
          status: "available",
          releaseAt: "2026-07-10T06:00:00.000Z",
          executionMode: "native",
          reason: null,
        },
        {
          key: "review_reply",
          title: "口コミ返信",
          status: "hidden",
          releaseAt: null,
          executionMode: "owner_provider",
          reason: null,
        },
        {
          key: "instagram_to_gbp",
          title: "Instagram投稿の再利用",
          status: "hidden",
          releaseAt: null,
          executionMode: "native",
          reason: null,
        },
        {
          key: "meo_rank",
          title: "MEO順位計測",
          status: "paused",
          releaseAt: "2026-07-03T06:00:00.000Z",
          executionMode: "owner_provider",
          reason: "現在、一時停止しています。",
        },
        {
          key: "gbp_health",
          title: "プロフィール診断",
          status: "hidden",
          releaseAt: null,
          executionMode: "native",
          reason: null,
        },
      ],
    },
  });
});

Deno.test("owner mutation replay returns stored JSON without repeating side effects", async () => {
  const calls = { signOut: 0, delete: 0 };
  let ownerStoreCalls = 0;
  const repository = ownerRepository({
    claimStoreOperation: () =>
      Promise.resolve({
        replayed: true,
        result_json: {
          provider: "openai",
          status: "active",
          keyLast4: "1234",
          validatedAt: "2026-07-10T00:00:00Z",
          safeErrorCode: null,
        },
      }),
    ownerStore: () => {
      ownerStoreCalls += 1;
      return Promise.reject(new Error("must not execute"));
    },
  });
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () => repository as never,
    credentialCipher: cipher,
    models,
  });
  const response = await app.request(
    `/owner-api/v2/stores/${storeId}/ai-connection/validate-and-save`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify({
        provider: "openai",
        apiKey: "not-a-real-provider-key",
      }),
    },
  );
  assertEquals(response.status, 200);
  assertEquals(ownerStoreCalls, 0);
  assert(
    !JSON.stringify(await response.json()).includes("not-a-real-provider-key"),
  );
});

Deno.test("owner API accepts expanded provider IDs and rejects unknown providers", async () => {
  const calls = { signOut: 0, delete: 0 };
  for (const selectedProvider of ["deepseek", "xai", "anthropic"] as const) {
    const repository = ownerRepository({
      claimStoreOperation: () =>
        Promise.resolve({
          replayed: true,
          result_json: {
            provider: selectedProvider,
            status: "active",
            keyLast4: "1234",
            validatedAt: "2026-07-10T00:00:00Z",
            safeErrorCode: null,
          },
        }),
    });
    const app = createOwnerApp({
      allowedOrigins: new Set([origin]),
      authMiddleware: authMiddleware({}, calls),
      repository: () => repository as never,
      credentialCipher: cipher,
      models,
    });
    const response = await app.request(
      `/owner-api/v2/stores/${storeId}/ai-connection/validate-and-save`,
      {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "Idempotency-Key": mutationKey,
        },
        body: JSON.stringify({
          provider: selectedProvider,
          apiKey: "not-a-real-provider-key",
        }),
      },
    );
    assertEquals(response.status, 200);
    const serialized = JSON.stringify(await response.json());
    assert(serialized.includes(selectedProvider));
    assert(!serialized.includes("not-a-real-provider-key"));
  }

  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () => ownerRepository() as never,
    credentialCipher: cipher,
    models,
  });
  const rejected = await app.request(
    `/owner-api/v2/stores/${storeId}/ai-connection/validate-and-save`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify({
        provider: "unknown",
        apiKey: "never-use-this-key",
      }),
    },
  );
  assertEquals(rejected.status, 400);

  const rejectedModel = await app.request(
    `/owner-api/v2/stores/${storeId}/ai-connection/validate-and-save`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify({
        provider: "openai",
        model: "unapproved-expensive-model",
        apiKey: "never-use-this-key",
      }),
    },
  );
  assertEquals(rejectedModel.status, 400);
});

Deno.test("owner API lists every safe saved AI connection", async () => {
  const calls = { signOut: 0, delete: 0 };
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () =>
      ownerRepository({
        aiConnections: () =>
          Promise.resolve([
            {
              provider: "openai",
              model: "openai-test-model",
              status: "active",
              is_active: true,
              key_last4: "1234",
              validated_at: "2026-07-10T00:00:00Z",
              last_error_code: null,
              credential_ciphertext: "must-not-leak",
            },
            {
              provider: "xai",
              model: "grok-4.3",
              status: "invalid",
              is_active: false,
              key_last4: "9876",
              validated_at: null,
              last_error_code: "AI_CREDENTIAL_INVALID",
              credential_ciphertext: "must-not-leak",
            },
          ]),
      }) as never,
    credentialCipher: cipher,
    models,
  });
  const response = await app.request(
    `/owner-api/v2/stores/${storeId}/ai-connections`,
    {
      headers: { Origin: origin, Authorization: "Bearer verified-user-jwt" },
    },
  );
  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.data, [
    {
      provider: "openai",
      status: "active",
      keyLast4: "1234",
      model: "openai-test-model",
    },
    {
      provider: "xai",
      status: "invalid",
      keyLast4: "9876",
      model: "grok-4.3",
    },
  ]);
  assert(!JSON.stringify(payload).includes("must-not-leak"));
});

Deno.test("owner survey config GET upcasts stored v3 copy to v4", async () => {
  const calls = { signOut: 0, delete: 0 };
  const config = structuredClone(DEFAULT_SURVEY_CONFIG);
  config.title = "カフェご来店アンケート";
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () =>
      ownerRepository({
        ownerSurveyConfig: () => Promise.resolve(config),
      }) as never,
    credentialCipher: cipher,
    models,
  });

  const response = await app.request(
    `/owner-api/v3/stores/${storeId}/survey-config`,
    {
      headers: { Origin: origin, Authorization: "Bearer verified-user-jwt" },
    },
  );
  assertEquals(response.status, 200);
  const payload = await response.json() as { data: unknown };
  assertEquals(
    payload.data,
    upcastSurveyConfigV3(normalizeSurveyConfigV3(config)!),
  );
});

Deno.test("owner survey v2 GET keeps the legacy v3 response shape", async () => {
  const calls = { signOut: 0, delete: 0 };
  const legacy = canonicalSurveyConfig(
    "restaurant",
    "保存済みアンケート",
    "保存済みの説明です。",
  );
  let updates = 0;
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () =>
      ownerRepository({
        ownerSurveyConfig: () => Promise.resolve(legacy),
        updateSurveyConfig: () => {
          updates += 1;
          return Promise.reject(new Error("must not update"));
        },
      }) as never,
    credentialCipher: cipher,
    models,
  });

  const response = await app.request(
    `/owner-api/v2/stores/${storeId}/survey-config`,
    {
      headers: { Origin: origin, Authorization: "Bearer verified-user-jwt" },
    },
  );
  assertEquals(response.status, 200);
  assertEquals(
    (await response.json() as { data: unknown }).data,
    upcastSurveyConfigV2(legacy),
  );
  assertEquals(updates, 0);
});

Deno.test("owner survey v2 GET materializes stored v4 without exposing variants", async () => {
  const calls = { signOut: 0, delete: 0 };
  const definition = upcastSurveyConfigV3(
    structuredClone(DEFAULT_SURVEY_CONFIG),
  );
  const group = definition.questionGroups[2]!;
  group.variants.push({
    ...structuredClone(group.variants[0]!),
    id: "q_bbbbbbbbbbbb",
  });
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () =>
      ownerRepository({
        ownerSurveyConfig: () => Promise.resolve(definition),
      }) as never,
    credentialCipher: cipher,
    models,
  });

  const response = await app.request(
    `/owner-api/v2/stores/${storeId}/survey-config`,
    {
      headers: { Origin: origin, Authorization: "Bearer verified-user-jwt" },
    },
  );
  assertEquals(response.status, 200);
  const data = (await response.json() as {
    data: {
      version: number;
      questions?: unknown[];
      questionGroups?: unknown[];
    };
  }).data;
  assertEquals(data.version, 3);
  assertEquals(data.questions?.length, definition.questionGroups.length);
  assertEquals(data.questionGroups, undefined);
});

Deno.test("owner survey v2 PUT refuses to collapse an existing v4 definition", async () => {
  const calls = { signOut: 0, delete: 0 };
  let claims = 0;
  const definition = upcastSurveyConfigV3(
    structuredClone(DEFAULT_SURVEY_CONFIG),
  );
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () =>
      ownerRepository({
        ownerSurveyConfig: () => Promise.resolve(definition),
        claimStoreOperation: () => {
          claims += 1;
          return Promise.resolve({
            operation_id: "33333333-3333-4333-8333-333333333333",
            replayed: false,
          });
        },
      }) as never,
    credentialCipher: cipher,
    models,
  });

  const response = await app.request(
    `/owner-api/v2/stores/${storeId}/survey-config`,
    {
      method: "PUT",
      headers: {
        Origin: origin,
        Authorization: "Bearer verified-user-jwt",
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify(DEFAULT_SURVEY_CONFIG),
    },
  );
  assertEquals(response.status, 409);
  assertEquals(claims, 1);
});

Deno.test("owner survey v2 PUT replays a completed save before the v4 guard", async () => {
  const calls = { signOut: 0, delete: 0 };
  let configReads = 0;
  const replayed = { version: 3, revision: 2, title: "保存済み" };
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () =>
      ownerRepository({
        claimStoreOperation: () =>
          Promise.resolve({ replayed: true, result_json: replayed }),
        ownerSurveyConfig: () => {
          configReads += 1;
          return Promise.reject(new Error("must replay before reading config"));
        },
      }) as never,
    credentialCipher: cipher,
    models,
  });

  const response = await app.request(
    `/owner-api/v2/stores/${storeId}/survey-config`,
    {
      method: "PUT",
      headers: {
        Origin: origin,
        Authorization: "Bearer verified-user-jwt",
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify(DEFAULT_SURVEY_CONFIG),
    },
  );
  assertEquals(response.status, 200);
  assertEquals((await response.json() as { data: unknown }).data, replayed);
  assertEquals(configReads, 0);
});

Deno.test("owner snapshot endpoint passes only requested session IDs", async () => {
  const calls = { signOut: 0, delete: 0 };
  let requested: string[] = [];
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () =>
      ownerRepository({
        ownerInterviewSurveySnapshots: (
          _owner: string,
          _store: string,
          sessionIds: string[],
        ) => {
          requested = sessionIds;
          return Promise.resolve([]);
        },
      }) as never,
    credentialCipher: cipher,
    models,
  });

  const response = await app.request(
    `/owner-api/v2/stores/${storeId}/interview-survey-snapshots`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        Authorization: "Bearer verified-user-jwt",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sessionIds: [storeId, mutationKey, storeId] }),
    },
  );
  assertEquals(response.status, 200);
  assertEquals(requested, [storeId, mutationKey]);
});

Deno.test("owner survey presets require auth and expose all starting points", async () => {
  const calls = { signOut: 0, delete: 0 };
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () => ownerRepository() as never,
    credentialCipher: cipher,
    models,
  });
  const response = await app.request("/owner-api/v2/survey-presets", {
    headers: { Origin: origin, Authorization: "Bearer verified-user-jwt" },
  });
  assertEquals(response.status, 200);
  const payload = await response.json() as { data: Array<{ id: string }> };
  assertEquals(payload.data.map((preset) => preset.id), [
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
  ]);
});

Deno.test("owner survey config GET requires an existing store", async () => {
  const calls = { signOut: 0, delete: 0 };
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () =>
      ownerRepository({
        ownerSurveyConfig: () => Promise.resolve(null),
      }) as never,
    credentialCipher: cipher,
    models,
  });

  const response = await app.request(
    `/owner-api/v3/stores/${storeId}/survey-config`,
    {
      headers: { Origin: origin, Authorization: "Bearer verified-user-jwt" },
    },
  );
  assertEquals(response.status, 404);
});

Deno.test("owner survey config accepts exact text limits and persists normalized text", async () => {
  const calls = { signOut: 0, delete: 0 };
  const config = structuredClone(DEFAULT_SURVEY_CONFIG);
  config.title = "t".repeat(120);
  config.description = "d".repeat(300);
  let persisted: unknown;
  const repository = ownerRepository({
    updateSurveyConfig: (_owner: string, _store: string, value: unknown) => {
      persisted = value;
      return Promise.resolve(value);
    },
  });
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () => repository as never,
    credentialCipher: cipher,
    models,
  });

  const response = await app.request(
    `/owner-api/v3/stores/${storeId}/survey-config`,
    {
      method: "PUT",
      headers: {
        Origin: origin,
        Authorization: "Bearer verified-user-jwt",
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify(config),
    },
  );
  assertEquals(response.status, 200);
  assertEquals(
    persisted,
    upcastSurveyConfigV3(normalizeSurveyConfigV3(config)!),
  );
});

Deno.test("owner survey config rejects v3 limit and vocabulary violations before claiming", async () => {
  const calls = { signOut: 0, delete: 0 };
  for (
    const invalid of [
      (() => {
        const config = structuredClone(DEFAULT_SURVEY_CONFIG);
        config.description = "";
        return config;
      })(),
      (() => {
        const config = structuredClone(DEFAULT_SURVEY_CONFIG);
        const question = config.questions.find((candidate) =>
          candidate.type === "long_text"
        );
        if (question?.type === "long_text") {
          question.placeholder = "p".repeat(101);
        }
        return config;
      })(),
      (() => {
        const config = structuredClone(DEFAULT_SURVEY_CONFIG);
        const source = config.questions.find((question) =>
          question.type === "short_text"
        )!;
        config.questions = Array.from({ length: 13 }, (_, index) => ({
          ...structuredClone(source),
          id: `q_${(index + 1).toString(16).padStart(12, "0")}`,
        }));
        return config;
      })(),
      (() => {
        const config = structuredClone(DEFAULT_SURVEY_CONFIG);
        config.questions.slice(0, 5).forEach((question) => {
          question.required = true;
        });
        return config;
      })(),
      (() => {
        const config = structuredClone(DEFAULT_SURVEY_CONFIG);
        config.questions[3]!.role = "rating";
        return config;
      })(),
      (() => {
        const config = structuredClone(DEFAULT_SURVEY_CONFIG);
        config.questions[0]!.label = "電話番号を入力してください";
        return config;
      })(),
      (() => {
        const config = structuredClone(DEFAULT_SURVEY_CONFIG);
        config.description = "満足した方のみご回答ください";
        return config;
      })(),
    ]
  ) {
    let claims = 0;
    const app = createOwnerApp({
      allowedOrigins: new Set([origin]),
      authMiddleware: authMiddleware({}, calls),
      repository: () =>
        ownerRepository({
          claimStoreOperation: () => {
            claims += 1;
            return Promise.reject(new Error("must not claim"));
          },
        }) as never,
      credentialCipher: cipher,
      models,
    });
    const response = await app.request(
      `/owner-api/v3/stores/${storeId}/survey-config`,
      {
        method: "PUT",
        headers: {
          Origin: origin,
          Authorization: "Bearer verified-user-jwt",
          "Content-Type": "application/json",
          "Idempotency-Key": mutationKey,
        },
        body: JSON.stringify(invalid),
      },
    );
    assertEquals(response.status, 400);
    assertEquals(claims, 0);
  }
});

Deno.test("same idempotency key replays the exact server-assigned survey ids", async () => {
  const calls = { signOut: 0, delete: 0 };
  const config = structuredClone(DEFAULT_SURVEY_CONFIG);
  config.title = "保存済みアンケート";
  let updates = 0;
  let savedResult: unknown;
  const requestHashes: string[] = [];
  const legacy = canonicalSurveyConfig(
    "restaurant",
    "旧アンケート",
    "旧設定です。",
  );
  const repository = ownerRepository({
    ownerSurveyConfig: () => Promise.resolve(legacy),
    claimStoreOperation: (input: { requestHash: string }) => {
      requestHashes.push(input.requestHash);
      return savedResult === undefined
        ? Promise.resolve({
          operation_id: "33333333-3333-4333-8333-333333333333",
          replayed: false,
        })
        : Promise.resolve({ replayed: true, result_json: savedResult });
    },
    updateSurveyConfig: (_owner: string, _store: string, value: unknown) => {
      updates += 1;
      return Promise.resolve(value);
    },
    completeOwnerOperation: (_operation: string, result: unknown) => {
      savedResult = result;
      return Promise.resolve({});
    },
  });
  const app = createOwnerApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware({}, calls),
    repository: () => repository as never,
    credentialCipher: cipher,
    models,
  });

  const request = () =>
    app.request(`/owner-api/v3/stores/${storeId}/survey-config`, {
      method: "PUT",
      headers: {
        Origin: origin,
        Authorization: "Bearer verified-user-jwt",
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify(config),
    });
  const firstResponse = await request();
  const secondResponse = await request();
  assertEquals(firstResponse.status, 200);
  assertEquals(secondResponse.status, 200);
  const first = (await firstResponse.json() as {
    data: ReturnType<typeof upcastSurveyConfigV3>;
  }).data;
  const second = (await secondResponse.json() as {
    data: ReturnType<typeof upcastSurveyConfigV3>;
  }).data;
  assertEquals(first, second);
  assertEquals(requestHashes[0], requestHashes[1]);
  assertEquals(updates, 1);
  assert(
    first.questionGroups.every((group) =>
      SURVEY_GROUP_ID_PATTERN.test(group.id) &&
      group.variants.every((variant) =>
        typeof variant.id === "string" &&
        SURVEY_QUESTION_ID_PATTERN.test(variant.id)
      )
    ),
  );
  assert(
    first.questionGroups.some((group, index) =>
      group.variants[0]?.id !== config.questions[index]!.id
    ),
  );
});
