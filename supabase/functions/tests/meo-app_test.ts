import type { MiddlewareHandler } from "hono";
import type { AppEnv, JsonObject } from "../_shared/types.ts";
import { createMeoApp } from "../meo-api/app.ts";
import { assert, assertEquals } from "./assert.ts";

const origin = "https://app.example.test";
const ownerId = "11111111-1111-4111-8111-111111111111";
const storeId = "44444444-4444-4444-8444-444444444444";
const mutationKey = "22222222-2222-4222-8222-222222222222";
const oauthState = "s".repeat(43);
const oauthVerifier = "v".repeat(43);

const replayedHealthResult: JsonObject = {
  score: 91,
  checks: [
    "description",
    "hours",
    "website",
    "phone",
    "category",
    "media",
    "posts",
    "review-replies",
    "recent-reviews",
  ].map((id) => ({
    id,
    title: id,
    status: "good",
    summary: `${id} ok`,
    nextAction: null,
  })),
};
const diagnosedAt = "2026-08-12T12:34:56.000Z";

function authMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("supabaseContext", {
      userClaims: { id: ownerId },
      jwtClaims: {},
      supabase: {} as never,
      supabaseAdmin: {} as never,
    });
    await next();
  };
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    requireFeature: () =>
      Promise.resolve({
        state: "available",
        execution_mode: "native",
      }),
    reserveProviderCall: () =>
      Promise.resolve({
        reservation_id: "77777777-7777-4777-8777-777777777777",
        authorized: true,
        replayed: false,
      }),
    settleProviderCall: () => Promise.resolve({ status: "succeeded" }),
    claimHealthDiagnosis: () =>
      Promise.resolve({
        reservation_id: "77777777-7777-4777-8777-777777777777",
        authorized: true,
        replayed: false,
        status: "processing",
      }),
    settleHealthDiagnosis: (input: JsonObject) =>
      Promise.resolve({
        status: "succeeded",
        diagnosedAt,
        result: input.result,
      }),
    saveManualHealthDiagnosis: (input: JsonObject) =>
      Promise.resolve({ replayed: false, diagnosedAt, result: input.result }),
    latestHealthResult: () => Promise.resolve(null),
    createOauthState: () => Promise.resolve(),
    prepareOauthCallback: () => Promise.reject(new Error("unused")),
    consumeOauthState: () => Promise.reject(new Error("unused")),
    connections: () => Promise.resolve([]),
    connection: () => Promise.resolve(null),
    saveConnection: () => Promise.reject(new Error("unused")),
    selectGoogleLocation: () => Promise.reject(new Error("unused")),
    deleteConnection: () => Promise.resolve(),
    updateCredential: () => Promise.resolve(),
    externalWriteSettings: () =>
      Promise.resolve({ enabled: false, can_manage: true, can_execute: true }),
    setExternalWrites: (input: JsonObject) =>
      Promise.resolve({
        enabled: input.enabled,
        can_manage: true,
        can_execute: true,
      }),
    claimExternalAction: () =>
      Promise.resolve({
        operation_id: "33333333-3333-4333-8333-333333333333",
        replayed: false,
      }),
    completeExternalAction: () => Promise.resolve(),
    attentionExternalAction: () => Promise.resolve(),
    failExternalAction: () => Promise.resolve(),
    reserveAiDraft: () => Promise.reject(new Error("unused")),
    settleAiDraft: () => Promise.reject(new Error("unused")),
    saveManualRank: () => Promise.resolve({ saved: true }),
    rankHistory: () => Promise.resolve([]),
    reserveRankMeasurement: () => Promise.reject(new Error("unused")),
    markRankSubmitted: () => Promise.reject(new Error("unused")),
    failRankMeasurement: () => Promise.resolve(),
    saveInsights: () => Promise.resolve({ saved: true }),
    insightHistory: () => Promise.resolve([]),
    ...overrides,
  };
}

function app(overrides: Record<string, unknown> = {}, repo = repository()) {
  return createMeoApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware(),
    callbackAuthMiddleware: authMiddleware(),
    repository: () => repo as never,
    credentialCipher: {
      encrypt: () =>
        Promise.resolve({
          ciphertext: "ciphertext-value-long",
          iv: "iv-value-long-enough",
          keyVersion: 1,
        }),
      decrypt: () => Promise.reject(new Error("unused")),
    },
    appOrigin: origin,
    now: () => Date.UTC(2026, 7, 11, 0, 0, 0),
    ...overrides,
  });
}

Deno.test("hidden feature fails closed before deterministic draft generation", async () => {
  const server = app(
    {},
    repository({
      requireFeature: () => Promise.reject(new Error("FEATURE_HIDDEN")),
    }),
  );
  const response = await server.request(
    `/meo-api/v1/stores/${storeId}/review-replies/draft`,
    {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ rating: 5 }),
    },
  );
  assertEquals(response.status, 404);
  const payload = await response.json();
  assertEquals(payload.error.code, "FEATURE_HIDDEN");
});

Deno.test("hidden Google features block OAuth before state creation", async () => {
  let stateCreations = 0;
  const response = await app(
    {},
    repository({
      requireFeature: () => Promise.reject(new Error("FEATURE_HIDDEN")),
      createOauthState: () => {
        stateCreations += 1;
        return Promise.resolve();
      },
    }),
  ).request(
    `/meo-api/v1/stores/${storeId}/connections/google_business/start`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Idempotency-Key": mutationKey,
      },
    },
  );
  assertEquals(response.status, 404);
  assertEquals(stateCreations, 0);
  const payload = await response.json();
  assertEquals(payload.error.code, "FEATURE_HIDDEN");
});

Deno.test("paused Instagram feature blocks OAuth before state creation", async () => {
  let stateCreations = 0;
  const response = await app(
    {},
    repository({
      requireFeature: () => Promise.reject(new Error("FEATURE_PAUSED")),
      createOauthState: () => {
        stateCreations += 1;
        return Promise.resolve();
      },
    }),
  ).request(
    `/meo-api/v1/stores/${storeId}/connections/instagram/start`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Idempotency-Key": mutationKey,
      },
    },
  );
  assertEquals(response.status, 503);
  assertEquals(stateCreations, 0);
  const payload = await response.json();
  assertEquals(payload.error.code, "FEATURE_PAUSED");
});

Deno.test("OAuth start binds the stored state to the initiating browser challenge", async () => {
  const saved: JsonObject[] = [];
  const response = await app(
    {
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {},
      },
    },
    repository({
      createOauthState: (input: JsonObject) => {
        saved.push(input);
        return Promise.resolve();
      },
    }),
  ).request(
    `/meo-api/v1/stores/${storeId}/connections/google_business/start`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify({ challenge: "c".repeat(43) }),
    },
  );
  assertEquals(response.status, 200);
  assertEquals(saved[0]?.browserChallenge, "c".repeat(43));
});

Deno.test("provider quota rejects OAuth abuse before creating another state", async () => {
  let stateCreations = 0;
  const response = await app(
    {
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {},
      },
    },
    repository({
      reserveProviderCall: () =>
        Promise.resolve({
          reservation_id: "77777777-7777-4777-8777-777777777777",
          authorized: false,
          denial_code: "PROVIDER_STORE_WINDOW_LIMIT",
        }),
      createOauthState: () => {
        stateCreations += 1;
        return Promise.resolve();
      },
    }),
  ).request(
    `/meo-api/v1/stores/${storeId}/connections/google_business/start`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify({ challenge: "c".repeat(43) }),
    },
  );
  assertEquals(response.status, 429);
  assertEquals(stateCreations, 0);
  const payload = await response.json();
  assertEquals(payload.error.code, "PROVIDER_RATE_LIMITED");
});

Deno.test("manual GBP health requires an idempotency key before persistence", async () => {
  let saves = 0;
  const response = await app(
    {},
    repository({
      saveManualHealthDiagnosis: () => {
        saves += 1;
        return Promise.reject(new Error("must not run"));
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/health/check`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      useConnection: false,
      hasBusinessDescription: true,
      hasWebsite: true,
      hasBusinessHours: true,
      hasPhoneNumber: true,
      hasPrimaryCategory: true,
      photoCount: 5,
      videoCount: 0,
      daysSinceLastMedia: 1,
      postCount: 1,
      daysSinceLastPost: 1,
      reviewReplyRate: 1,
      recentReviewCount: 1,
    }),
  });

  assertEquals(response.status, 400);
  assertEquals((await response.json()).error.code, "IDEMPOTENCY_KEY_REQUIRED");
  assertEquals(saves, 0);
});

Deno.test("manual GBP health persists the bounded result and returns the database readback", async () => {
  const saves: JsonObject[] = [];
  const response = await app(
    {},
    repository({
      saveManualHealthDiagnosis: (input: JsonObject) => {
        saves.push(input);
        return Promise.resolve({
          replayed: false,
          diagnosedAt,
          result: input.result,
        });
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/health/check`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({
      useConnection: false,
      hasBusinessDescription: true,
      hasWebsite: true,
      hasBusinessHours: true,
      hasPhoneNumber: true,
      hasPrimaryCategory: true,
      photoCount: 5,
      videoCount: 0,
      daysSinceLastMedia: 1,
      postCount: 1,
      daysSinceLastPost: 1,
      reviewReplyRate: 1,
      recentReviewCount: 1,
    }),
  });

  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(saves.length, 1);
  assertEquals(saves[0]?.actorId, ownerId);
  assertEquals(saves[0]?.storeId, storeId);
  assert(/^[0-9a-f]{64}$/.test(String(saves[0]?.keyHash)));
  assert(/^[0-9a-f]{64}$/.test(String(saves[0]?.requestHash)));
  assertEquals(payload.data, {
    source: "manual",
    diagnosedAt,
    result: saves[0]?.result,
  });
});

Deno.test("manual GBP health returns an exact persisted replay", async () => {
  const response = await app(
    {},
    repository({
      saveManualHealthDiagnosis: () =>
        Promise.resolve({
          replayed: true,
          diagnosedAt,
          result: replayedHealthResult,
        }),
    }),
  ).request(`/meo-api/v1/stores/${storeId}/health/check`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({
      useConnection: false,
      hasBusinessDescription: false,
      hasWebsite: false,
      hasBusinessHours: false,
      hasPhoneNumber: false,
      hasPrimaryCategory: false,
      photoCount: 0,
      videoCount: 0,
      daysSinceLastMedia: 31,
      postCount: 0,
      daysSinceLastPost: 61,
      reviewReplyRate: 0,
      recentReviewCount: 0,
    }),
  });

  assertEquals(response.status, 200);
  assertEquals((await response.json()).data, {
    source: "manual",
    diagnosedAt,
    result: replayedHealthResult,
  });
});

Deno.test("manual GBP health maps a same-key payload conflict", async () => {
  const response = await app(
    {},
    repository({
      saveManualHealthDiagnosis: () =>
        Promise.reject(new Error("IDEMPOTENCY_PAYLOAD_CONFLICT")),
    }),
  ).request(`/meo-api/v1/stores/${storeId}/health/check`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({
      useConnection: false,
      hasBusinessDescription: false,
      hasWebsite: false,
      hasBusinessHours: false,
      hasPhoneNumber: false,
      hasPrimaryCategory: false,
      photoCount: 0,
      videoCount: 0,
      daysSinceLastMedia: 31,
      postCount: 0,
      daysSinceLastPost: 61,
      reviewReplyRate: 0,
      recentReviewCount: 0,
    }),
  });

  assertEquals(response.status, 409);
  assertEquals((await response.json()).error.code, "IDEMPOTENCY_CONFLICT");
});

Deno.test("latest GBP health returns null when no saved result exists", async () => {
  const response = await app().request(
    `/meo-api/v1/stores/${storeId}/health/latest`,
    { headers: { Origin: origin } },
  );

  assertEquals(response.status, 200);
  assertEquals((await response.json()).data, null);
});

Deno.test("latest GBP health returns one bounded saved result", async () => {
  const diagnosedAt = "2026-08-12T12:34:56.000Z";
  const response = await app(
    {},
    repository({
      latestHealthResult: () =>
        Promise.resolve({
          source: "manual",
          diagnosedAt,
          result: replayedHealthResult,
        }),
    }),
  ).request(`/meo-api/v1/stores/${storeId}/health/latest`, {
    headers: { Origin: origin },
  });

  assertEquals(response.status, 200);
  assertEquals((await response.json()).data, {
    source: "manual",
    diagnosedAt,
    result: replayedHealthResult,
  });
});

Deno.test("connected GBP health requires an idempotency key before claiming usage", async () => {
  let claims = 0;
  const response = await app(
    {},
    repository({
      claimHealthDiagnosis: () => {
        claims += 1;
        return Promise.reject(new Error("must not run"));
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/health/check`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ useConnection: true }),
  });

  assertEquals(response.status, 400);
  assertEquals((await response.json()).error.code, "IDEMPOTENCY_KEY_REQUIRED");
  assertEquals(claims, 0);
});

Deno.test("connected GBP health exact replay returns the same bounded result without Google or settlement", async () => {
  let googleCalls = 0;
  let settlements = 0;
  const response = await app(
    {
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          profile: () => {
            googleCalls += 1;
            return Promise.reject(new Error("must not run"));
          },
        },
      },
    },
    repository({
      claimHealthDiagnosis: () =>
        Promise.resolve({
          reservation_id: "77777777-7777-4777-8777-777777777777",
          authorized: true,
          replayed: true,
          status: "succeeded",
          diagnosedAt,
          result: replayedHealthResult,
        }),
      settleHealthDiagnosis: () => {
        settlements += 1;
        return Promise.reject(new Error("must not run"));
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/health/check`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({ useConnection: true }),
  });

  assertEquals(response.status, 200);
  assertEquals((await response.json()).data, {
    source: "google_business",
    diagnosedAt,
    result: replayedHealthResult,
  });
  assertEquals(googleCalls, 0);
  assertEquals(settlements, 0);
});

Deno.test("connected GBP health rejects a same-key payload conflict before Google", async () => {
  let googleCalls = 0;
  const response = await app(
    {
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          profile: () => {
            googleCalls += 1;
            return Promise.reject(new Error("must not run"));
          },
        },
      },
    },
    repository({
      claimHealthDiagnosis: () =>
        Promise.reject(new Error("IDEMPOTENCY_PAYLOAD_CONFLICT")),
    }),
  ).request(`/meo-api/v1/stores/${storeId}/health/check`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({ useConnection: true }),
  });

  assertEquals(response.status, 409);
  assertEquals((await response.json()).error.code, "IDEMPOTENCY_CONFLICT");
  assertEquals(googleCalls, 0);
});

for (
  const [status, expectedCode] of [
    ["processing", "HEALTH_DIAGNOSIS_IN_PROGRESS"],
    ["failed", "HEALTH_DIAGNOSIS_PREVIOUSLY_FAILED"],
    ["attention_required", "HEALTH_DIAGNOSIS_ATTENTION_REQUIRED"],
    ["expired", "HEALTH_DIAGNOSIS_RESULT_EXPIRED"],
  ] as const
) {
  Deno.test(`connected GBP health ${status} replay never calls Google`, async () => {
    let googleCalls = 0;
    const response = await app(
      {
        google: {
          clientId: "client",
          redirectUri: "https://api.example.test/callback",
          client: {
            profile: () => {
              googleCalls += 1;
              return Promise.reject(new Error("must not run"));
            },
          },
        },
      },
      repository({
        claimHealthDiagnosis: () =>
          Promise.resolve({
            reservation_id: "77777777-7777-4777-8777-777777777777",
            authorized: false,
            replayed: true,
            status,
          }),
      }),
    ).request(`/meo-api/v1/stores/${storeId}/health/check`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify({ useConnection: true }),
    });

    assertEquals(response.status, status === "expired" ? 410 : 409);
    assertEquals((await response.json()).error.code, expectedCode);
    assertEquals(googleCalls, 0);
  });
}

Deno.test("connected GBP health treats empty Google containers as missing and records readback success", async () => {
  const settlements: JsonObject[] = [];
  const response = await app(
    {
      credentialCipher: {
        encrypt: () => Promise.reject(new Error("unused")),
        decrypt: () =>
          Promise.resolve(JSON.stringify({
            accessToken: "google-token",
            refreshToken: "refresh-token",
            expiresAt: "2026-08-12T00:00:00.000Z",
            scopes: ["https://www.googleapis.com/auth/business.manage"],
          })),
      },
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          profile: () =>
            Promise.resolve({
              profile: { description: "   " },
              websiteUri: "",
              regularHours: { periods: [] },
              phoneNumbers: {},
              categories: { primaryCategory: {} },
            }),
          reviews: () =>
            Promise.resolve({
              reviews: [{
                name: "accounts/a/locations/l/reviews/r",
                reviewerName: null,
                rating: 5,
                comment: null,
                createTime: "2026-01-10T00:00:00.000Z",
                updateTime: "2026-08-10T00:00:00.000Z",
                replyComment: null,
                replyUpdateTime: null,
              }],
              complete: true,
              totalReviewCount: 1,
            }),
          media: () =>
            Promise.resolve({
              mediaItems: [{
                name: "accounts/a/locations/l/media/photo",
                mediaFormat: "PHOTO",
                createTime: "2026-08-10T00:00:00.000Z",
              }],
              complete: true,
              totalMediaItemCount: 1,
            }),
          localPosts: () =>
            Promise.resolve({
              posts: [{
                name: "accounts/a/locations/l/localPosts/p",
                createTime: "2026-01-09T00:00:00.000Z",
                updateTime: "2026-08-11T00:00:00.000Z",
              }],
              complete: true,
            }),
        },
      },
    },
    repository({
      connection: () =>
        Promise.resolve({
          provider: "google_business",
          status: "active",
          location_name: "accounts/a/locations/l",
          ciphertext: "ciphertext-value-long",
          iv: "iv-value-long-enough",
          keyVersion: 1,
        }),
      claimHealthDiagnosis: () => {
        return Promise.resolve({
          reservation_id: "77777777-7777-4777-8777-777777777777",
          authorized: true,
          replayed: false,
          status: "processing",
        });
      },
      settleHealthDiagnosis: (input: JsonObject) => {
        settlements.push(input);
        return Promise.resolve({
          status: "succeeded",
          diagnosedAt,
          result: input.result,
        });
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/health/check`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({ useConnection: true }),
  });

  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.data.source, "google_business");
  assertEquals(payload.data.diagnosedAt, diagnosedAt);
  const checks = payload.data.result.checks as JsonObject[];
  for (
    const [id, status] of [
      ["description", "action"],
      ["hours", "action"],
      ["website", "warning"],
      ["phone", "warning"],
      ["category", "action"],
      ["media", "action"],
      ["posts", "action"],
      ["review-replies", "action"],
      ["recent-reviews", "action"],
    ]
  ) {
    assertEquals(checks.find((check) => check.id === id)?.status, status);
  }
  assertEquals(settlements.length, 1);
  assertEquals(
    settlements[0]?.operationId,
    "77777777-7777-4777-8777-777777777777",
  );
  assertEquals(settlements[0]?.outcome, "success");
  assertEquals(settlements[0]?.safeErrorCode, null);
  assertEquals(settlements[0]?.result, payload.data.result);
});

Deno.test("GBP health fails closed when successful Google reads cannot be settled", async () => {
  const outcomes: string[] = [];
  const response = await app(
    {
      credentialCipher: {
        encrypt: () => Promise.reject(new Error("unused")),
        decrypt: () =>
          Promise.resolve(JSON.stringify({
            accessToken: "google-token",
            refreshToken: "refresh-token",
            expiresAt: "2026-08-12T12:00:00.000Z",
            scopes: ["https://www.googleapis.com/auth/business.manage"],
          })),
      },
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          profile: () => Promise.resolve({}),
          reviews: () =>
            Promise.resolve({
              reviews: [],
              complete: true,
              totalReviewCount: 0,
            }),
          media: () =>
            Promise.resolve({
              mediaItems: [],
              complete: true,
              totalMediaItemCount: 0,
            }),
          localPosts: () => Promise.resolve({ posts: [], complete: true }),
        },
      },
    },
    repository({
      connection: () =>
        Promise.resolve({
          provider: "google_business",
          status: "active",
          location_name: "accounts/a/locations/l",
          ciphertext: "ciphertext-value-long",
          iv: "iv-value-long-enough",
          keyVersion: 1,
        }),
      settleHealthDiagnosis: (input: JsonObject) => {
        outcomes.push(String(input.outcome));
        return Promise.reject(new Error("database unavailable"));
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/health/check`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({ useConnection: true }),
  });

  assertEquals(response.status, 503);
  assertEquals(
    (await response.json()).error.code,
    "PROVIDER_RESULT_SETTLEMENT_FAILED",
  );
  assertEquals(outcomes, ["success"]);
});

Deno.test("GBP health atomic result persistence failure is quarantined without a second settlement", async () => {
  let providerCalls = 0;
  const settlements: JsonObject[] = [];
  const response = await app(
    {
      credentialCipher: {
        encrypt: () => Promise.reject(new Error("unused")),
        decrypt: () =>
          Promise.resolve(JSON.stringify({
            accessToken: "google-token",
            refreshToken: "refresh-token",
            expiresAt: "2026-08-12T12:00:00.000Z",
            scopes: ["https://www.googleapis.com/auth/business.manage"],
          })),
      },
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          profile: () => {
            providerCalls += 1;
            return Promise.resolve({});
          },
          reviews: () => {
            providerCalls += 1;
            return Promise.resolve({
              reviews: [],
              complete: true,
              totalReviewCount: 0,
            });
          },
          media: () => {
            providerCalls += 1;
            return Promise.resolve({
              mediaItems: [],
              complete: true,
              totalMediaItemCount: 0,
            });
          },
          localPosts: () => {
            providerCalls += 1;
            return Promise.resolve({ posts: [], complete: true });
          },
        },
      },
    },
    repository({
      connection: () =>
        Promise.resolve({
          provider: "google_business",
          status: "active",
          location_name: "accounts/a/locations/l",
          ciphertext: "ciphertext-value-long",
          iv: "iv-value-long-enough",
          keyVersion: 1,
        }),
      settleHealthDiagnosis: (input: JsonObject) => {
        settlements.push(input);
        return Promise.reject(new Error("atomic result write failed"));
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/health/check`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({ useConnection: true }),
  });

  assertEquals(response.status, 503);
  assertEquals(
    (await response.json()).error.code,
    "PROVIDER_RESULT_SETTLEMENT_FAILED",
  );
  assertEquals(providerCalls, 4);
  assertEquals(settlements.length, 1);
  assertEquals(settlements[0]?.outcome, "success");
  assertEquals(
    (settlements[0]?.result as JsonObject)?.checks instanceof Array,
    true,
  );
});

Deno.test("GBP health does not score incomplete paginated review metrics", async () => {
  const response = await app(
    {
      credentialCipher: {
        encrypt: () => Promise.reject(new Error("unused")),
        decrypt: () =>
          Promise.resolve(JSON.stringify({
            accessToken: "google-token",
            refreshToken: "refresh-token",
            expiresAt: "2026-08-12T12:00:00.000Z",
            scopes: ["https://www.googleapis.com/auth/business.manage"],
          })),
      },
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          profile: () => Promise.resolve({}),
          reviews: () =>
            Promise.resolve({
              reviews: [{
                name: "accounts/a/locations/l/reviews/r",
                reviewerName: null,
                rating: 5,
                comment: null,
                createTime: "2026-08-10T00:00:00.000Z",
                updateTime: "2026-08-10T00:00:00.000Z",
                replyComment: "返信済み",
                replyUpdateTime: "2026-08-11T00:00:00.000Z",
              }],
              complete: false,
              totalReviewCount: 2_000,
            }),
          media: () =>
            Promise.resolve({
              mediaItems: [],
              complete: true,
              totalMediaItemCount: 0,
            }),
          localPosts: () => Promise.resolve({ posts: [], complete: true }),
        },
      },
    },
    repository({
      connection: () =>
        Promise.resolve({
          provider: "google_business",
          status: "active",
          location_name: "accounts/a/locations/l",
          ciphertext: "ciphertext-value-long",
          iv: "iv-value-long-enough",
          keyVersion: 1,
        }),
    }),
  ).request(`/meo-api/v1/stores/${storeId}/health/check`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({ useConnection: true }),
  });

  assertEquals(response.status, 200);
  const checks = (await response.json()).data.result.checks as JsonObject[];
  for (const id of ["review-replies", "recent-reviews"]) {
    const check = checks.find((candidate) => candidate.id === id);
    assertEquals(check?.status, "unknown");
    assertEquals(check?.nextAction, null);
  }
});

Deno.test("GBP health does not score incomplete media or local post metrics", async () => {
  const response = await app(
    {
      credentialCipher: {
        encrypt: () => Promise.reject(new Error("unused")),
        decrypt: () =>
          Promise.resolve(JSON.stringify({
            accessToken: "google-token",
            refreshToken: "refresh-token",
            expiresAt: "2026-08-12T12:00:00.000Z",
            scopes: ["https://www.googleapis.com/auth/business.manage"],
          })),
      },
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          profile: () => Promise.resolve({}),
          reviews: () =>
            Promise.resolve({
              reviews: [],
              complete: true,
              totalReviewCount: 0,
            }),
          media: () =>
            Promise.resolve({
              mediaItems: [{
                name: "accounts/a/locations/l/media/photo",
                mediaFormat: "PHOTO",
                createTime: "2026-08-10T00:00:00.000Z",
              }],
              complete: false,
              totalMediaItemCount: 20_000,
            }),
          localPosts: () =>
            Promise.resolve({
              posts: [{
                name: "accounts/a/locations/l/localPosts/p",
                createTime: "2026-08-10T00:00:00.000Z",
                updateTime: "2026-08-11T00:00:00.000Z",
              }],
              complete: false,
            }),
        },
      },
    },
    repository({
      connection: () =>
        Promise.resolve({
          provider: "google_business",
          status: "active",
          location_name: "accounts/a/locations/l",
          ciphertext: "ciphertext-value-long",
          iv: "iv-value-long-enough",
          keyVersion: 1,
        }),
    }),
  ).request(`/meo-api/v1/stores/${storeId}/health/check`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({ useConnection: true }),
  });

  assertEquals(response.status, 200);
  const checks = (await response.json()).data.result.checks as JsonObject[];
  for (const id of ["media", "posts"]) {
    const check = checks.find((candidate) => candidate.id === id);
    assertEquals(check?.status, "unknown");
    assertEquals(check?.nextAction, null);
  }
});

Deno.test("GBP health provider failure is isolated to a safe failed usage record", async () => {
  const settlements: JsonObject[] = [];
  let connectionWrites = 0;
  const response = await app(
    {
      credentialCipher: {
        encrypt: () => Promise.reject(new Error("unused")),
        decrypt: () =>
          Promise.resolve(JSON.stringify({
            accessToken: "google-token",
            refreshToken: "refresh-token",
            expiresAt: "2026-08-12T00:00:00.000Z",
            scopes: ["https://www.googleapis.com/auth/business.manage"],
          })),
      },
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          profile: () => Promise.reject(new Error("secret provider detail")),
          reviews: () =>
            Promise.resolve({
              reviews: [],
              complete: true,
              totalReviewCount: 0,
            }),
          media: () =>
            Promise.resolve({
              mediaItems: [],
              complete: true,
              totalMediaItemCount: 0,
            }),
          localPosts: () => Promise.resolve({ posts: [], complete: true }),
        },
      },
    },
    repository({
      connection: () =>
        Promise.resolve({
          provider: "google_business",
          status: "active",
          location_name: "accounts/a/locations/l",
          ciphertext: "ciphertext-value-long",
          iv: "iv-value-long-enough",
          keyVersion: 1,
        }),
      updateCredential: () => {
        connectionWrites += 1;
        return Promise.resolve();
      },
      settleHealthDiagnosis: (input: JsonObject) => {
        settlements.push(input);
        return Promise.resolve({ status: "failed" });
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/health/check`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({ useConnection: true }),
  });

  assertEquals(response.status, 500);
  const body = await response.text();
  assert(!body.includes("secret provider detail"));
  assertEquals(JSON.parse(body).error.code, "INTERNAL_ERROR");
  assertEquals(connectionWrites, 0);
  assertEquals(settlements, [{
    operationId: "77777777-7777-4777-8777-777777777777",
    outcome: "failed",
    safeErrorCode: "PROVIDER_CALL_FAILED",
  }]);
});

Deno.test("paused GBP health stops before provider reservation or connection read", async () => {
  let claims = 0;
  let connectionReads = 0;
  const response = await app(
    {},
    repository({
      requireFeature: () => Promise.reject(new Error("FEATURE_PAUSED")),
      claimHealthDiagnosis: () => {
        claims += 1;
        return Promise.reject(new Error("must not run"));
      },
      connection: () => {
        connectionReads += 1;
        return Promise.reject(new Error("must not run"));
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/health/check`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({ useConnection: true }),
  });

  assertEquals(response.status, 503);
  assertEquals((await response.json()).error.code, "FEATURE_PAUSED");
  assertEquals(claims, 0);
  assertEquals(connectionReads, 0);
});

Deno.test("review reply template works without AI or Google connection", async () => {
  const response = await app().request(
    `/meo-api/v1/stores/${storeId}/review-replies/draft`,
    {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        rating: 4,
        reviewComment: "落ち着けました",
        storeName: "テスト店",
        tone: "short",
      }),
    },
  );
  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.data.source, "template");
  assertEquals(payload.data.requiresReview, true);
  assert(payload.data.reply.includes("ありがとうございます"));
});

Deno.test("review reply template honors English locale and rejects unsupported locale", async () => {
  const englishResponse = await app().request(
    `/meo-api/v1/stores/${storeId}/review-replies/draft`,
    {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        rating: 5,
        reviewComment: "料理が最高でした",
        storeName: "クチトル食堂",
        tone: "warm",
        locale: "en",
      }),
    },
  );
  assertEquals(englishResponse.status, 200);
  const englishPayload = await englishResponse.json();
  assert(englishPayload.data.reply.includes("Thank you"));
  assert(englishPayload.data.reply.includes("クチトル食堂"));

  const invalidResponse = await app().request(
    `/meo-api/v1/stores/${storeId}/review-replies/draft`,
    {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ rating: 5, locale: "fr" }),
    },
  );
  assertEquals(invalidResponse.status, 400);
  assertEquals(
    (await invalidResponse.json()).error.code,
    "INVALID_REVIEW_REPLY_LOCALE",
  );
});

Deno.test("review reply rejects a fractional rating instead of silently rounding it", async () => {
  const response = await app().request(
    `/meo-api/v1/stores/${storeId}/review-replies/draft`,
    {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ rating: 4.4, reviewComment: "よかったです" }),
    },
  );
  assertEquals(response.status, 400);
  const payload = await response.json();
  assertEquals(payload.error.code, "INVALID_REVIEW_RATING");
});

Deno.test("owner-provider review mode uses only the active owner credential", async () => {
  const settlements: JsonObject[] = [];
  const response = await app(
    {
      credentialCipher: {
        encrypt: () => Promise.reject(new Error("unused")),
        decrypt: () => Promise.resolve("owner-api-key"),
      },
      ownerAiRepository: () => ({
        getActiveConnection: () =>
          Promise.resolve({
            storeId,
            provider: "openai" as const,
            model: "openai-model-standard",
            ciphertext: "ciphertext-value-long",
            iv: "iv-value-long-enough",
            keyVersion: 1,
            keyLast4: "-key",
          }),
      }),
      providerFactory: (_provider: unknown, apiKey: string) => ({
        draftReviewReply: () => {
          assertEquals(apiKey, "owner-api-key");
          return Promise.resolve({
            text: "ご来店と率直なご感想をありがとうございます。",
            provider: "openai" as const,
            model: "openai-model-standard",
            inputTokens: 10,
            outputTokens: 12,
            generatedCharacters: 22,
            providerRequestId: null,
            requestId: "55555555-5555-4555-8555-555555555555",
          });
        },
      } as never),
    },
    repository({
      requireFeature: () =>
        Promise.resolve({
          state: "available",
          execution_mode: "owner_provider",
        }),
      reserveAiDraft: (input: JsonObject) => {
        assertEquals(input.credentialSource, "owner_provider");
        return Promise.resolve({
          reservation_id: "55555555-5555-4555-8555-555555555555",
          authorized: true,
          replayed: false,
        });
      },
      settleAiDraft: (input: JsonObject) => {
        settlements.push(input);
        return Promise.resolve({ status: "succeeded" });
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/review-replies/draft`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({
      rating: 3,
      reviewComment: "普通でした",
      generationMode: "owner_provider",
    }),
  });
  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.data.source, "owner_provider");
  assertEquals(settlements[0]?.credentialSource, "owner_provider");
});

Deno.test("Google review write refuses an unconfirmed draft before provider access", async () => {
  let connectionReads = 0;
  const response = await app(
    {},
    repository({
      connection: () => {
        connectionReads += 1;
        return Promise.resolve(null);
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/reviews/reply`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({
      reviewName: "accounts/a/locations/l/reviews/r",
      comment: "ありがとうございます。",
      confirmed: false,
    }),
  });
  assertEquals(response.status, 409);
  assertEquals(connectionReads, 0);
  const payload = await response.json();
  assertEquals(payload.error.code, "PUBLISH_CONFIRMATION_REQUIRED");
});

Deno.test("external writes are disabled by default and owner enablement is explicit", async () => {
  const getResponse = await app().request(
    `/meo-api/v1/stores/${storeId}/external-writes`,
    { headers: { Origin: origin } },
  );
  assertEquals(getResponse.status, 200);
  assertEquals((await getResponse.json()).data, {
    enabled: false,
    canManage: true,
    canExecute: true,
  });

  let setting: JsonObject | null = null;
  const patchResponse = await app(
    {},
    repository({
      setExternalWrites: (input: JsonObject) => {
        setting = input;
        return Promise.resolve({
          enabled: true,
          can_manage: true,
          can_execute: true,
        });
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/external-writes`, {
    method: "PATCH",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({ enabled: true }),
  });
  assertEquals(patchResponse.status, 200);
  assertEquals(setting, { actorId: ownerId, storeId, enabled: true });
  assertEquals((await patchResponse.json()).data, {
    enabled: true,
    canManage: true,
    canExecute: true,
  });
});

Deno.test("confirmed external writes still fail while the store gate is disabled", async () => {
  const response = await app(
    {},
    repository({
      claimExternalAction: () =>
        Promise.reject(new Error("EXTERNAL_WRITES_DISABLED")),
    }),
  ).request(`/meo-api/v1/stores/${storeId}/reviews/reply`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({
      reviewName: "accounts/a/locations/l/reviews/r",
      comment: "ありがとうございます。",
      confirmed: true,
    }),
  });
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error.code, "EXTERNAL_WRITES_DISABLED");
});

Deno.test("read-only members cannot claim a confirmed external write", async () => {
  const response = await app(
    {},
    repository({
      claimExternalAction: () =>
        Promise.reject(new Error("EXTERNAL_WRITE_ROLE_REQUIRED")),
    }),
  ).request(`/meo-api/v1/stores/${storeId}/reviews/reply`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({
      reviewName: "accounts/a/locations/l/reviews/r",
      comment: "ご来店ありがとうございました。",
      confirmed: true,
    }),
  });
  assertEquals(response.status, 403);
  assertEquals(
    (await response.json()).error.code,
    "EXTERNAL_WRITE_ROLE_REQUIRED",
  );
});

Deno.test("Google review write completes only after an exact provider readback", async () => {
  const calls: string[] = [];
  const reviewName = "accounts/a/locations/l/reviews/r";
  const completions: JsonObject[] = [];
  const response = await app(
    {
      credentialCipher: {
        encrypt: () => Promise.reject(new Error("unused")),
        decrypt: () =>
          Promise.resolve(JSON.stringify({
            accessToken: "google-token",
            refreshToken: "refresh-token",
            expiresAt: "2026-08-12T00:00:00.000Z",
            scopes: ["https://www.googleapis.com/auth/business.manage"],
          })),
      },
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          reply: () => {
            calls.push("write");
            return Promise.resolve();
          },
          review: () => {
            calls.push("readback");
            return Promise.resolve({
              name: reviewName,
              reviewerName: null,
              rating: 5,
              comment: "よかったです",
              createTime: null,
              updateTime: null,
              replyComment: "ありがとうございます。",
              replyUpdateTime: "2026-08-11T00:00:00.000Z",
            });
          },
        },
      },
    },
    repository({
      connection: () =>
        Promise.resolve({
          provider: "google_business",
          status: "active",
          location_name: "accounts/a/locations/l",
          ciphertext: "ciphertext-value-long",
          iv: "iv-value-long-enough",
          keyVersion: 1,
        }),
      completeExternalAction: (_operationId: string, result: JsonObject) => {
        completions.push(result);
        return Promise.resolve();
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/reviews/reply`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({
      reviewName,
      comment: "ありがとうございます。",
      confirmed: true,
    }),
  });
  assertEquals(response.status, 200);
  assertEquals(calls, ["write", "readback"]);
  assertEquals(completions[0]?.providerResourceName, reviewName);
  const payload = await response.json();
  assertEquals(payload.data.readBackAt, "2026-08-11T00:00:00.000Z");
});

Deno.test("a different review with the same reply text is never accepted as readback", async () => {
  const reviewName = "accounts/a/locations/l/reviews/requested";
  let attentionCalls = 0;
  let completionCalls = 0;
  let failureCalls = 0;
  const response = await app(
    {
      credentialCipher: {
        encrypt: () => Promise.reject(new Error("unused")),
        decrypt: () =>
          Promise.resolve(JSON.stringify({
            accessToken: "google-token",
            refreshToken: "refresh-token",
            expiresAt: "2026-08-12T00:00:00.000Z",
            scopes: ["https://www.googleapis.com/auth/business.manage"],
          })),
      },
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          reply: () => Promise.resolve(),
          review: () =>
            Promise.resolve({
              name: "accounts/a/locations/l/reviews/different",
              reviewerName: null,
              rating: 5,
              comment: null,
              createTime: null,
              updateTime: null,
              replyComment: "ありがとうございます。",
              replyUpdateTime: "2026-08-11T00:00:00.000Z",
            }),
        },
      },
    },
    repository({
      connection: () =>
        Promise.resolve({
          provider: "google_business",
          status: "active",
          location_name: "accounts/a/locations/l",
          ciphertext: "ciphertext-value-long",
          iv: "iv-value-long-enough",
          keyVersion: 1,
        }),
      completeExternalAction: () => {
        completionCalls += 1;
        return Promise.resolve();
      },
      attentionExternalAction: () => {
        attentionCalls += 1;
        return Promise.resolve();
      },
      failExternalAction: () => {
        failureCalls += 1;
        return Promise.resolve();
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/reviews/reply`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({
      reviewName,
      comment: "ありがとうございます。",
      confirmed: true,
    }),
  });

  assertEquals(response.status, 409);
  const payload = await response.json();
  assertEquals(payload.error.code, "EXTERNAL_ACTION_OUTCOME_UNKNOWN");
  assertEquals(attentionCalls, 1);
  assertEquals(completionCalls, 0);
  assertEquals(failureCalls, 0);
});

Deno.test("ambiguous Google review write is quarantined and never recorded as a definite failure", async () => {
  let attentionCalls = 0;
  let failureCalls = 0;
  const reviewName = "accounts/a/locations/l/reviews/r";
  const response = await app(
    {
      credentialCipher: {
        encrypt: () => Promise.reject(new Error("unused")),
        decrypt: () =>
          Promise.resolve(JSON.stringify({
            accessToken: "google-token",
            refreshToken: "refresh-token",
            expiresAt: "2026-08-12T00:00:00.000Z",
            scopes: ["https://www.googleapis.com/auth/business.manage"],
          })),
      },
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          reply: () => Promise.reject(new TypeError("network outcome unknown")),
        },
      },
    },
    repository({
      connection: () =>
        Promise.resolve({
          provider: "google_business",
          status: "active",
          location_name: "accounts/a/locations/l",
          ciphertext: "ciphertext-value-long",
          iv: "iv-value-long-enough",
          keyVersion: 1,
        }),
      attentionExternalAction: () => {
        attentionCalls += 1;
        return Promise.resolve();
      },
      failExternalAction: () => {
        failureCalls += 1;
        return Promise.resolve();
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/reviews/reply`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({
      reviewName,
      comment: "ありがとうございます。",
      confirmed: true,
    }),
  });
  assertEquals(response.status, 409);
  const payload = await response.json();
  assertEquals(payload.error.code, "EXTERNAL_ACTION_OUTCOME_UNKNOWN");
  assert(payload.error.message.includes("再送せず"));
  assertEquals(attentionCalls, 1);
  assertEquals(failureCalls, 0);
});

Deno.test("confirmed Google write with a receipt failure is quarantined instead of marked failed", async () => {
  let attentionCalls = 0;
  let failureCalls = 0;
  const reviewName = "accounts/a/locations/l/reviews/r";
  const response = await app(
    {
      credentialCipher: {
        encrypt: () => Promise.reject(new Error("unused")),
        decrypt: () =>
          Promise.resolve(JSON.stringify({
            accessToken: "google-token",
            refreshToken: "refresh-token",
            expiresAt: "2026-08-12T00:00:00.000Z",
            scopes: ["https://www.googleapis.com/auth/business.manage"],
          })),
      },
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          reply: () => Promise.resolve(),
          review: () =>
            Promise.resolve({
              name: reviewName,
              reviewerName: null,
              rating: 5,
              comment: null,
              createTime: null,
              updateTime: null,
              replyComment: "ありがとうございます。",
              replyUpdateTime: "2026-08-11T00:00:00.000Z",
            }),
        },
      },
    },
    repository({
      connection: () =>
        Promise.resolve({
          provider: "google_business",
          status: "active",
          location_name: "accounts/a/locations/l",
          ciphertext: "ciphertext-value-long",
          iv: "iv-value-long-enough",
          keyVersion: 1,
        }),
      completeExternalAction: () =>
        Promise.reject(new Error("database unavailable")),
      attentionExternalAction: () => {
        attentionCalls += 1;
        return Promise.resolve();
      },
      failExternalAction: () => {
        failureCalls += 1;
        return Promise.resolve();
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/reviews/reply`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({
      reviewName,
      comment: "ありがとうございます。",
      confirmed: true,
    }),
  });
  assertEquals(response.status, 500);
  const payload = await response.json();
  assertEquals(payload.error.code, "EXTERNAL_ACTION_RECEIPT_FAILED");
  assert(payload.error.message.includes("再送せず"));
  assertEquals(attentionCalls, 1);
  assertEquals(failureCalls, 0);
});

Deno.test("confirmed Google write with a receipt settlement failure is quarantined", async () => {
  let attentionCalls = 0;
  let failureCalls = 0;
  let completionCalls = 0;
  const reviewName = "accounts/a/locations/l/reviews/r";
  const response = await app(
    {
      credentialCipher: {
        encrypt: () => Promise.reject(new Error("unused")),
        decrypt: () =>
          Promise.resolve(JSON.stringify({
            accessToken: "google-token",
            refreshToken: "refresh-token",
            expiresAt: "2026-08-12T12:00:00.000Z",
            scopes: ["https://www.googleapis.com/auth/business.manage"],
          })),
      },
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          reply: () => Promise.resolve(),
          review: () =>
            Promise.resolve({
              name: reviewName,
              reviewerName: null,
              rating: 5,
              comment: null,
              createTime: null,
              updateTime: null,
              replyComment: "ありがとうございます。",
              replyUpdateTime: "2026-08-11T00:00:00.000Z",
            }),
        },
      },
    },
    repository({
      connection: () =>
        Promise.resolve({
          provider: "google_business",
          status: "active",
          location_name: "accounts/a/locations/l",
          ciphertext: "ciphertext-value-long",
          iv: "iv-value-long-enough",
          keyVersion: 1,
        }),
      settleProviderCall: () =>
        Promise.reject(new Error("database unavailable")),
      attentionExternalAction: (_operationId: string, code: string) => {
        attentionCalls += 1;
        assertEquals(code, "PROVIDER_RESULT_SETTLEMENT_FAILED");
        return Promise.resolve();
      },
      failExternalAction: () => {
        failureCalls += 1;
        return Promise.resolve();
      },
      completeExternalAction: () => {
        completionCalls += 1;
        return Promise.resolve();
      },
    }),
  ).request(`/meo-api/v1/stores/${storeId}/reviews/reply`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({
      reviewName,
      comment: "ありがとうございます。",
      confirmed: true,
    }),
  });

  assertEquals(response.status, 409);
  assertEquals(
    (await response.json()).error.code,
    "EXTERNAL_ACTION_OUTCOME_UNKNOWN",
  );
  assertEquals(attentionCalls, 1);
  assertEquals(failureCalls, 0);
  assertEquals(completionCalls, 0);
});

Deno.test("manual image post completes only when readback has the exact source URL", async () => {
  const locationName = "accounts/a/locations/l";
  const postName = `${locationName}/localPosts/post-1`;
  const imageUrl = "https://cdn.example.test/manual-image.jpg";
  for (const exactMedia of [true, false]) {
    let attentionCalls = 0;
    let completionCalls = 0;
    let failureCalls = 0;
    let writes = 0;
    const response = await app(
      {
        credentialCipher: {
          encrypt: () => Promise.reject(new Error("unused")),
          decrypt: () =>
            Promise.resolve(JSON.stringify({
              accessToken: "google-token",
              refreshToken: "refresh-token",
              expiresAt: "2026-08-12T00:00:00.000Z",
              scopes: ["https://www.googleapis.com/auth/business.manage"],
            })),
        },
        google: {
          clientId: "client",
          redirectUri: "https://api.example.test/callback",
          client: {
            createLocalPost: (
              _token: string,
              _location: string,
              input: JsonObject,
            ) => {
              writes += 1;
              assertEquals(input.imageUrl, imageUrl);
              return Promise.resolve({ name: postName });
            },
            localPost: () =>
              Promise.resolve({
                name: postName,
                summary: "画像付き投稿",
                media: [{
                  sourceUrl: exactMedia
                    ? imageUrl
                    : "https://cdn.example.test/different.jpg",
                }],
              }),
          },
        },
      },
      repository({
        connection: () =>
          Promise.resolve({
            provider: "google_business",
            status: "active",
            location_name: locationName,
            ciphertext: "ciphertext-value-long",
            iv: "iv-value-long-enough",
            keyVersion: 1,
          }),
        completeExternalAction: () => {
          completionCalls += 1;
          return Promise.resolve();
        },
        attentionExternalAction: () => {
          attentionCalls += 1;
          return Promise.resolve();
        },
        failExternalAction: () => {
          failureCalls += 1;
          return Promise.resolve();
        },
      }),
    ).request(`/meo-api/v1/stores/${storeId}/instagram/publish`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify({
        summary: "画像付き投稿",
        imageUrl,
        confirmed: true,
      }),
    });

    assertEquals(writes, 1);
    assertEquals(response.status, exactMedia ? 200 : 409);
    assertEquals(completionCalls, exactMedia ? 1 : 0);
    assertEquals(attentionCalls, exactMedia ? 0 : 1);
    assertEquals(failureCalls, 0);
    if (!exactMedia) {
      const payload = await response.json();
      assertEquals(payload.error.code, "EXTERNAL_ACTION_OUTCOME_UNKNOWN");
    }
  }
});

Deno.test("rank measurement keeps the manual path when automatic mode is disabled", async () => {
  const response = await app().request(
    `/meo-api/v1/stores/${storeId}/rank/measure`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify({
        keyword: "新宿 カフェ",
        targetPlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
        latitude: 35.6895,
        longitude: 139.6917,
      }),
    },
  );
  assertEquals(response.status, 409);
  const payload = await response.json();
  assertEquals(payload.error.code, "AUTOMATIC_RANK_DISABLED");
  assert(payload.error.message.includes("手動チェック"));
});

Deno.test("rank request cannot override the operator execution mode", async () => {
  const response = await app(
    {},
    repository({
      requireFeature: () =>
        Promise.resolve({
          state: "available",
          execution_mode: "owner_provider",
        }),
    }),
  ).request(`/meo-api/v1/stores/${storeId}/rank/measure`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({
      keyword: "新宿 カフェ",
      targetPlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
      latitude: 35.6895,
      longitude: 139.6917,
      credentialSource: "native",
    }),
  });
  assertEquals(response.status, 409);
  const payload = await response.json();
  assertEquals(payload.error.code, "FEATURE_EXECUTION_MODE_MISMATCH");
});

Deno.test("rank request rejects malformed competitor Place IDs instead of silently dropping them", async () => {
  const response = await app().request(
    `/meo-api/v1/stores/${storeId}/rank/measure`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify({
        keyword: "新宿 カフェ",
        targetPlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
        competitorPlaceIds: ["short"],
        latitude: 35.6895,
        longitude: 139.6917,
      }),
    },
  );
  assertEquals(response.status, 400);
  const payload = await response.json();
  assertEquals(payload.error.code, "INVALID_COMPETITOR_PLACE_IDS");
});

Deno.test("owner-provider rank uses the saved DataForSEO credential", async () => {
  let providerCalls = 0;
  const jobId = "99999999-9999-4999-8999-999999999999";
  const response = await app(
    {
      credentialCipher: {
        encrypt: () => Promise.reject(new Error("unused")),
        decrypt: () =>
          Promise.resolve(JSON.stringify({
            login: "owner@example.test",
            password: "owner-password",
          })),
      },
      dataForSeoFactory: () => ({
        submitMapsTask: () => {
          providerCalls += 1;
          return Promise.resolve({ taskId: "owner-task-1", cost: 0.0006 });
        },
      } as never),
    },
    repository({
      requireFeature: () =>
        Promise.resolve({
          state: "available",
          execution_mode: "owner_provider",
        }),
      connection: () =>
        Promise.resolve({
          provider: "dataforseo",
          status: "active",
          ciphertext: "ciphertext-value-long",
          iv: "iv-value-long-enough",
          keyVersion: 1,
        }),
      reserveRankMeasurement: (input: JsonObject) => {
        assertEquals(input.credentialSource, "owner_provider");
        return Promise.resolve({
          authorized: true,
          dispatch_authorized: true,
          replayed: false,
          status: "queued",
          job_id: jobId,
        });
      },
      markRankSubmitted: () =>
        Promise.resolve({ id: jobId, status: "submitted" }),
    }),
  ).request(`/meo-api/v1/stores/${storeId}/rank/measure`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "Idempotency-Key": mutationKey,
    },
    body: JSON.stringify({
      keyword: "新宿 カフェ",
      targetPlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
      latitude: 35.6895,
      longitude: 139.6917,
    }),
  });
  assertEquals(response.status, 200);
  assertEquals(providerCalls, 1);
});

Deno.test("OAuth callback failure follows supported Accept-Language preferences", async () => {
  const cases = [
    {
      header: "en-US",
      locale: "en",
      title: "<title>Connection error</title>",
      heading: "<h1>We couldn't complete the connection</h1>",
      detail: "We couldn't complete the connection to the external service.",
      guidance: "Return to Kuchitoru Zero and try again.",
    },
    {
      header: "ja-JP",
      locale: "ja",
      title: "<title>接続エラー</title>",
      heading: "<h1>接続を完了できませんでした</h1>",
      detail: "外部サービスとの接続を完了できませんでした。",
      guidance: "クチトルZeroへ戻り、もう一度お試しください。",
    },
    {
      header: "ja-JP;q=0.4, en-US;q=0.9",
      locale: "en",
      title: "<title>Connection error</title>",
      heading: "<h1>We couldn't complete the connection</h1>",
      detail: "We couldn't complete the connection to the external service.",
      guidance: "Return to Kuchitoru Zero and try again.",
    },
    {
      header: "fr-FR, definitely_invalid;q=broken",
      locale: "ja",
      title: "<title>接続エラー</title>",
      heading: "<h1>接続を完了できませんでした</h1>",
      detail: "外部サービスとの接続を完了できませんでした。",
      guidance: "クチトルZeroへ戻り、もう一度お試しください。",
    },
  ];

  for (const testCase of cases) {
    const response = await app().request(
      "/meo-api/oauth/unsupported/callback",
      { headers: { "Accept-Language": testCase.header } },
    );
    assertEquals(response.status, 400);
    assertEquals(response.headers.get("content-language"), testCase.locale);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(response.headers.get("referrer-policy"), "no-referrer");
    assertEquals(
      response.headers.get("content-security-policy"),
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
    );
    const html = await response.text();
    assert(html.includes(`<html lang="${testCase.locale}">`));
    assert(html.includes(testCase.title));
    assert(html.includes(testCase.heading));
    assert(html.includes(testCase.detail));
    assert(html.includes(testCase.guidance));
  }
});

Deno.test("OAuth callback expired failure uses constant localized copy", async () => {
  const response = await app(
    {},
    repository({
      prepareOauthCallback: () => Promise.reject(new Error("database detail")),
    }),
  ).request(
    `/meo-api/oauth/google/callback?state=${oauthState}`,
    { headers: { "Accept-Language": "en-GB" } },
  );

  assertEquals(response.status, 400);
  assertEquals(response.headers.get("content-language"), "en");
  const html = await response.text();
  assert(html.includes("This connection attempt has expired."));
  assert(!html.includes("database detail"));
});

Deno.test("public OAuth callback receives a Supabase context before consuming state", async () => {
  let repositorySawContext = false;
  const callbackMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set("supabaseContext", {
      userClaims: null,
      jwtClaims: null,
      supabase: {} as never,
      supabaseAdmin: {} as never,
    });
    await next();
  };
  const response = await app({
    callbackAuthMiddleware: callbackMiddleware,
    repository: (c: { var: { supabaseContext: unknown } }) => {
      repositorySawContext = c.var.supabaseContext !== undefined;
      return repository({
        prepareOauthCallback: () =>
          Promise.resolve({
            store_id: storeId,
            return_path: `/dashboard/stores/${storeId}/connections`,
          }),
      }) as never;
    },
  }).request(
    `/meo-api/oauth/google/callback?state=${oauthState}&error=access_denied`,
  );
  assertEquals(response.status, 303);
  assertEquals(repositorySawContext, true);
  assertEquals(
    response.headers.get("location"),
    `${origin}/dashboard/stores/${storeId}/connections?connection=cancelled`,
  );
});

Deno.test("public OAuth callback never exchanges or stores provider tokens", async () => {
  let exchanges = 0;
  let saves = 0;
  const response = await app(
    {
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          exchangeCode: () => {
            exchanges += 1;
            return Promise.reject(new Error("must not exchange"));
          },
        },
      },
    },
    repository({
      prepareOauthCallback: () =>
        Promise.resolve({
          store_id: storeId,
          return_path: `/dashboard/stores/${storeId}/connections`,
        }),
      saveConnection: () => {
        saves += 1;
        return Promise.resolve({});
      },
    }),
  ).request(
    `/meo-api/oauth/google/callback?state=${oauthState}&code=authorization-code`,
  );
  assertEquals(response.status, 303);
  const redirect = new URL(response.headers.get("location")!);
  const fragment = new URLSearchParams(redirect.hash.slice(1));
  assertEquals(redirect.search, "");
  assertEquals(fragment.get("connection"), "oauth_callback");
  assertEquals(fragment.get("provider"), "google_business");
  assertEquals(fragment.get("state"), oauthState);
  assertEquals(fragment.get("code"), "authorization-code");
  assertEquals(exchanges, 0);
  assertEquals(saves, 0);
});

Deno.test("OAuth completion rejects a different browser before token exchange", async () => {
  let exchanges = 0;
  const response = await app(
    {
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          exchangeCode: () => {
            exchanges += 1;
            return Promise.reject(new Error("must not exchange"));
          },
        },
      },
    },
    repository({
      consumeOauthState: () =>
        Promise.reject(new Error("OAUTH_STATE_INVALID_OR_EXPIRED")),
    }),
  ).request(
    `/meo-api/v1/stores/${storeId}/connections/google_business/complete`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify({
        state: oauthState,
        code: "authorization-code",
        verifier: oauthVerifier,
      }),
    },
  );
  assertEquals(response.status, 409);
  const payload = await response.json();
  assertEquals(payload.error.code, "OAUTH_BROWSER_MISMATCH");
  assertEquals(exchanges, 0);
});

Deno.test("Google OAuth never auto-selects even one returned location", async () => {
  const saves: JsonObject[] = [];
  const response = await app(
    {
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          exchangeCode: () =>
            Promise.resolve({
              accessToken: "google-access-token",
              refreshToken: "google-refresh-token",
              expiresAt: "2026-08-12T12:00:00.000Z",
              scopes: ["https://www.googleapis.com/auth/business.manage"],
            }),
          locations: () =>
            Promise.resolve([{
              name: "accounts/a/locations/only",
              title: "実店舗かもしれない店舗",
              accountName: "accounts/a",
              storefrontAddress: "東京都",
              latlng: { latitude: 35.693825, longitude: 139.703356 },
            }]),
        },
      },
    },
    repository({
      consumeOauthState: () => Promise.resolve(),
      saveConnection: (input: JsonObject) => {
        saves.push(input);
        return Promise.resolve({});
      },
    }),
  ).request(
    `/meo-api/v1/stores/${storeId}/connections/google_business/complete`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify({
        state: oauthState,
        code: "authorization-code",
        verifier: oauthVerifier,
      }),
    },
  );

  assertEquals(response.status, 200);
  assertEquals((await response.json()).data, {
    connected: true,
    selectLocation: true,
  });
  assertEquals(saves.length, 1);
  assertEquals(saves[0]?.externalAccountId, "accounts/a");
  assertEquals(saves[0]?.locationName, null);
  assertEquals(saves[0]?.displayName, null);
});

Deno.test("OAuth connection saved before receipt settlement failure is not settled as failed", async () => {
  const settlements: string[] = [];
  let saves = 0;
  const response = await app(
    {
      google: {
        clientId: "client",
        redirectUri: "https://api.example.test/callback",
        client: {
          exchangeCode: (_code: string, verifier: string) => {
            assertEquals(verifier, oauthVerifier);
            return Promise.resolve({
              accessToken: "google-access-token",
              refreshToken: "google-refresh-token",
              expiresAt: "2026-08-12T12:00:00.000Z",
              scopes: ["https://www.googleapis.com/auth/business.manage"],
            });
          },
          locations: () => Promise.resolve([]),
        },
      },
    },
    repository({
      consumeOauthState: () => Promise.resolve(),
      saveConnection: () => {
        saves += 1;
        return Promise.resolve({});
      },
      settleProviderCall: (input: JsonObject) => {
        settlements.push(String(input.outcome));
        return Promise.reject(new Error("database unavailable"));
      },
    }),
  ).request(
    `/meo-api/v1/stores/${storeId}/connections/google_business/complete`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify({
        state: oauthState,
        code: "authorization-code",
        verifier: oauthVerifier,
      }),
    },
  );

  assertEquals(response.status, 503);
  assertEquals(
    (await response.json()).error.code,
    "PROVIDER_RESULT_SETTLEMENT_FAILED",
  );
  assertEquals(saves, 1);
  assertEquals(settlements, ["success"]);
});

Deno.test("manual performance analysis remains available without Google", async () => {
  const response = await app().request(
    `/meo-api/v1/stores/${storeId}/insights/manual`,
    {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "Idempotency-Key": mutationKey,
      },
      body: JSON.stringify({
        periodStart: "2026-07-01",
        periodEnd: "2026-07-28",
        current: {
          searches: 20,
          views: 30,
          websiteClicks: 3,
          calls: 2,
          directionRequests: 5,
        },
        previous: {
          searches: 10,
          views: 20,
          websiteClicks: 3,
          calls: 1,
          directionRequests: 4,
        },
      }),
    },
  );
  assertEquals(response.status, 200);
  const payload = await response.json();
  assertEquals(payload.data.comparison[0].changeRate, 100);
});
