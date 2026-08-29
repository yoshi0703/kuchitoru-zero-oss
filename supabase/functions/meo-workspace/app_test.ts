import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../_shared/types.ts";
import { sha256Hex } from "../_shared/http.ts";
import { assertEquals } from "../tests/assert.ts";
import { createWorkspaceApp } from "./app.ts";
import type {
  WorkspaceAuthorization,
  WorkspaceMutationInput,
  WorkspaceRepositoryPort,
} from "./repository.ts";

const origin = "https://app.example.test";
const actorId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";
const recordId = "44444444-4444-4444-8444-444444444444";
const actorEmail = "owner@example.test";
const invitationToken = "A".repeat(43);

type AuthIdentity = {
  id: string;
  userEmail?: string | null;
  jwtEmail?: string | null;
  jwtSubject?: string | null;
};

function authMiddleware(
  identity: AuthIdentity | null = {
    id: actorId,
    userEmail: actorEmail,
    jwtEmail: actorEmail,
    jwtSubject: actorId,
  },
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set("supabaseContext", {
      userClaims: identity
        ? { id: identity.id, email: identity.userEmail }
        : null,
      jwtClaims: identity
        ? { email: identity.jwtEmail, sub: identity.jwtSubject ?? identity.id }
        : null,
      supabase: {} as never,
      supabaseAdmin: {} as never,
    });
    await next();
  };
}

function authorization(
  role: WorkspaceAuthorization["role"] = "owner",
  approvalRequired = false,
): WorkspaceAuthorization {
  return { organizationId, storeId, role, approvalRequired };
}

function repository(
  overrides: Partial<WorkspaceRepositoryPort> = {},
): WorkspaceRepositoryPort {
  return {
    accessibleStores: () => Promise.resolve({ stores: [] }),
    acceptInvitation: () => Promise.resolve({ store_id: storeId }),
    authorize: () => Promise.resolve(authorization()),
    workspaceSnapshot: () => Promise.resolve({ store: { id: storeId } }),
    list: (input) => Promise.resolve({ items: [], input }),
    mutate: (input) => Promise.resolve({ saved: true, input }),
    ...overrides,
  };
}

function app(
  repo: WorkspaceRepositoryPort = repository(),
  identity: AuthIdentity | null = {
    id: actorId,
    userEmail: actorEmail,
    jwtEmail: actorEmail,
    jwtSubject: actorId,
  },
) {
  return createWorkspaceApp({
    allowedOrigins: new Set([origin]),
    authMiddleware: authMiddleware(identity),
    repository: () => repo,
  });
}

function json(method: string, value: unknown): RequestInit {
  return {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}

Deno.test("workspace snapshot authorizes the actor and never accepts a client role", async () => {
  const calls: unknown[][] = [];
  const response = await app(repository({
    authorize: (...input) => {
      calls.push(input);
      return Promise.resolve(authorization("analyst"));
    },
  })).request(`${origin}/meo-workspace/v1/stores/${storeId}/snapshot`);

  assertEquals(response.status, 200);
  assertEquals(calls, [[actorId, storeId]]);
  assertEquals(await response.json(), {
    success: true,
    data: { store: { id: storeId } },
  });
});

Deno.test("accessible stores uses only the authenticated actor without store authorization", async () => {
  const calls: string[] = [];
  let authorizations = 0;
  const data = { stores: [{ store_id: storeId, role: "editor" }] };
  const response = await app(repository({
    accessibleStores: (id) => {
      calls.push(id);
      return Promise.resolve(data);
    },
    authorize: () => {
      authorizations += 1;
      return Promise.resolve(authorization());
    },
  })).request(`${origin}/meo-workspace/v1/stores`, {
    headers: { Origin: origin },
  });

  assertEquals(response.status, 200);
  assertEquals(calls, [actorId]);
  assertEquals(authorizations, 0);
  assertEquals(await response.json(), { success: true, data });
});

Deno.test("invitation acceptance sends verified actor email and SHA-256 token hash only", async () => {
  const calls: unknown[][] = [];
  const data = { store_id: storeId, role: "editor" };
  const response = await app(repository({
    acceptInvitation: (...input) => {
      calls.push(input);
      return Promise.resolve(data);
    },
  })).request(
    `${origin}/meo-workspace/v1/invitations/accept`,
    json("POST", { token: invitationToken }),
  );

  assertEquals(response.status, 200);
  assertEquals(calls, [[
    actorId,
    actorEmail,
    await sha256Hex(invitationToken),
  ]]);
  assertEquals(calls.flat().includes(invitationToken), false);
  assertEquals(await response.json(), { success: true, data });
});

Deno.test("invitation acceptance rejects invalid token, unverified email, and malformed readback", async () => {
  let acceptances = 0;
  const repo = repository({
    acceptInvitation: () => {
      acceptances += 1;
      return Promise.resolve({ store_id: storeId });
    },
  });
  const invalidToken = await app(repo).request(
    `${origin}/meo-workspace/v1/invitations/accept`,
    json("POST", { token: "raw-token" }),
  );
  const oversized = await app(repo).request(
    `${origin}/meo-workspace/v1/invitations/accept`,
    json("POST", { token: "A".repeat(1_100) }),
  );
  const missingEmail = await app(repo, {
    id: actorId,
    userEmail: null,
    jwtEmail: null,
  }).request(
    `${origin}/meo-workspace/v1/invitations/accept`,
    json("POST", { token: invitationToken }),
  );
  const mismatchedEmail = await app(repo, {
    id: actorId,
    userEmail: actorEmail,
    jwtEmail: "other@example.test",
  }).request(
    `${origin}/meo-workspace/v1/invitations/accept`,
    json("POST", { token: invitationToken }),
  );
  const malformedReadback = await app(repository({
    acceptInvitation: () => Promise.resolve({ accepted: true }),
  })).request(
    `${origin}/meo-workspace/v1/invitations/accept`,
    json("POST", { token: invitationToken }),
  );

  assertEquals(invalidToken.status, 400);
  assertEquals((await invalidToken.json()).error.code, "INVALID_INPUT");
  assertEquals(oversized.status, 413);
  assertEquals((await oversized.json()).error.code, "PAYLOAD_TOO_LARGE");
  assertEquals(missingEmail.status, 403);
  assertEquals(
    (await missingEmail.json()).error.code,
    "VERIFIED_EMAIL_REQUIRED",
  );
  assertEquals(mismatchedEmail.status, 403);
  assertEquals(
    (await mismatchedEmail.json()).error.code,
    "VERIFIED_EMAIL_REQUIRED",
  );
  assertEquals(malformedReadback.status, 502);
  assertEquals(
    (await malformedReadback.json()).error.code,
    "INVALID_INVITATION_READBACK",
  );
  assertEquals(acceptances, 0);
});

Deno.test("invitation repository failures use an oracle-safe public error mapping", async () => {
  const response = await app(repository({
    acceptInvitation: () =>
      Promise.reject(new Error("INVITATION_INVALID database-detail")),
  })).request(
    `${origin}/meo-workspace/v1/invitations/accept`,
    json("POST", { token: invitationToken }),
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    success: false,
    error: {
      code: "INVITATION_INVALID",
      message: "有効な招待を確認できませんでした。",
      retryable: false,
    },
  });
});

Deno.test("actor-only routes reject unauthenticated requests before repository calls", async () => {
  let reads = 0;
  const repo = repository({
    accessibleStores: () => {
      reads += 1;
      return Promise.resolve({ stores: [] });
    },
    acceptInvitation: () => {
      reads += 1;
      return Promise.resolve({ store_id: storeId });
    },
  });
  const stores = await app(repo, null).request(
    `${origin}/meo-workspace/v1/stores`,
    { headers: { Origin: origin } },
  );
  const accept = await app(repo, null).request(
    `${origin}/meo-workspace/v1/invitations/accept`,
    json("POST", { token: invitationToken }),
  );

  assertEquals(stores.status, 401);
  assertEquals(accept.status, 401);
  assertEquals(reads, 0);
});

Deno.test("workspace authorization fails closed before repository reads", async () => {
  let reads = 0;
  const response = await app(repository({
    authorize: () => Promise.reject(new Error("STORE_ACCESS_DENIED")),
    list: () => {
      reads += 1;
      return Promise.resolve([]);
    },
  })).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/reviews`,
    {
      headers: { Origin: origin },
    },
  );

  assertEquals(response.status, 403);
  assertEquals(reads, 0);
  assertEquals((await response.json()).error.code, "STORE_ACCESS_DENIED");
});

Deno.test("missing authenticated user is rejected before tenant authorization", async () => {
  let authorizations = 0;
  const response = await app(
    repository({
      authorize: () => {
        authorizations += 1;
        return Promise.resolve(authorization());
      },
    }),
    null,
  ).request(`${origin}/meo-workspace/v1/stores/${storeId}/snapshot`, {
    headers: { Origin: origin },
  });

  assertEquals(response.status, 401);
  assertEquals((await response.json()).error.code, "UNAUTHORIZED");
  assertEquals(authorizations, 0);
});

Deno.test("resource list bounds pagination and passes only allowed filters", async () => {
  let read: unknown;
  const response = await app(repository({
    list: (input) => {
      read = input;
      return Promise.resolve({ items: [], nextCursor: null });
    },
  })).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/reviews?limit=25&rating=4&status=unread&ignored=secret`,
    { headers: { Origin: origin } },
  );

  assertEquals(response.status, 200);
  assertEquals(read, {
    actorId,
    storeId,
    resource: "reviews",
    cursor: null,
    limit: 25,
    filters: { status: "unread", rating: 4 },
  });

  const tooLarge = await app().request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/reviews?limit=101`,
    { headers: { Origin: origin } },
  );
  assertEquals(tooLarge.status, 400);
  assertEquals((await tooLarge.json()).error.code, "INVALID_LIMIT");

  const invalidCursor = await app().request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/reviews?cursor=not-a-timestamp`,
    { headers: { Origin: origin } },
  );
  assertEquals(invalidCursor.status, 400);
  assertEquals((await invalidCursor.json()).error.code, "INVALID_CURSOR");
});

Deno.test("generic mutation rejects resources and actions outside the closed contract", async () => {
  let mutations = 0;
  const repo = repository({
    mutate: () => {
      mutations += 1;
      return Promise.resolve({});
    },
  });
  const unknownResource = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/secrets/create`,
    json("POST", { payload: {} }),
  );
  const unknownAction = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/reviews/publish_everything`,
    json("POST", { payload: {} }),
  );

  assertEquals(unknownResource.status, 400);
  assertEquals(unknownAction.status, 400);
  assertEquals(mutations, 0);
});

Deno.test("generic review create validates input before persistence", async () => {
  let saved: WorkspaceMutationInput | undefined;
  const repo = repository({
    mutate: (input) => {
      saved = input;
      return Promise.resolve({ id: recordId });
    },
  });
  const invalid = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/reviews/create`,
    json("POST", { payload: { rating: 6 } }),
  );
  assertEquals(invalid.status, 400);
  assertEquals(saved, undefined);

  const valid = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/reviews/create`,
    json("POST", {
      payload: {
        provider: "manual",
        rating: 5,
        comment: "丁寧でした",
        reviewedAt: "2026-08-13T00:00:00Z",
      },
    }),
  );
  assertEquals(valid.status, 201);
  assertEquals(saved, {
    actorId,
    storeId,
    resource: "reviews",
    action: "create",
    recordId: null,
    payload: {
      provider: "manual",
      rating: 5,
      review_text: "丁寧でした",
      language: "ja",
      status: "unread",
      reviewed_at: "2026-08-13T00:00:00Z",
      native_analysis_input: {},
    },
  });
});

Deno.test("Analyst is read-only even when the database adapter is mocked permissively", async () => {
  let mutations = 0;
  const response = await app(repository({
    authorize: () => Promise.resolve(authorization("analyst")),
    mutate: () => {
      mutations += 1;
      return Promise.resolve({});
    },
  })).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/reviews/update`,
    json("POST", {
      recordId,
      payload: { status: "read" },
    }),
  );

  assertEquals(response.status, 403);
  assertEquals((await response.json()).error.code, "READ_ONLY_ROLE");
  assertEquals(mutations, 0);
});

Deno.test("Editor under two-person policy receives an accepted change request result", async () => {
  const response = await app(repository({
    authorize: () => Promise.resolve(authorization("editor", true)),
    mutate: () => Promise.resolve({ queued: true, changeRequestId: recordId }),
  })).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/posts/create`,
    json("POST", {
      payload: {
        topicType: "update",
        summary: "本日の営業情報です",
      },
    }),
  );

  assertEquals(response.status, 202);
  assertEquals((await response.json()).data, {
    queued: true,
    changeRequestId: recordId,
  });
});

Deno.test("publish confirmation only records manual provider readback", async () => {
  let saved: WorkspaceMutationInput | undefined;
  const repo = repository({
    mutate: (input) => {
      saved = input;
      return Promise.resolve({ recorded: true });
    },
  });
  const invalid = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/posts/record_publish_confirmation`,
    json("POST", {
      recordId,
      payload: {
        provider: "google_business",
        confirmedAt: "2026-08-13T01:00:00Z",
      },
    }),
  );
  assertEquals(invalid.status, 400);
  assertEquals(saved, undefined);

  const response = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/posts/record_publish_confirmation`,
    json("POST", {
      recordId,
      payload: {
        provider: "google_business",
        confirmedAt: "2026-08-13T01:00:00Z",
        revision: 2,
        revisionFingerprint: "A".repeat(64),
        providerResourceName: "accounts/a/locations/l/localPosts/p",
        readback: { status: "LIVE" },
      },
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(saved?.resource, "posts");
  assertEquals(saved?.action, "record_publish_confirmation");
  assertEquals(saved?.recordId, recordId);
  assertEquals(saved?.payload, {
    confirmed_at: "2026-08-13T01:00:00Z",
    revision: 2,
    revision_fingerprint: "a".repeat(64),
    provider_resource_name: "accounts/a/locations/l/localPosts/p",
    outcome: "confirmed",
    safe_readback: {
      provider: "google_business",
      provider_url: undefined,
      readback: { status: "LIVE" },
      notes: undefined,
    },
  });
});

Deno.test("publish confirmation rejects automation input and read-only actors", async () => {
  let mutations = 0;
  const automationPayload = {
    confirmedAt: "2026-08-13T01:00:00Z",
    provider: "google_business",
    revision: 2,
    revisionFingerprint: "a".repeat(64),
    automaticPublish: true,
    providerAccessToken: "must-not-be-accepted",
  };
  const permissiveRepository = repository({
    mutate: () => {
      mutations += 1;
      return Promise.resolve({ recorded: true });
    },
  });

  const automation = await app(permissiveRepository).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/posts/${recordId}/publish-confirmation`,
    json("POST", automationPayload),
  );
  const analyst = await app(repository({
    authorize: () => Promise.resolve(authorization("analyst")),
    mutate: () => {
      mutations += 1;
      return Promise.resolve({ recorded: true });
    },
  })).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/posts/${recordId}/publish-confirmation`,
    json("POST", {
      confirmedAt: "2026-08-13T01:00:00Z",
      provider: "google_business",
      revision: 2,
      revisionFingerprint: "a".repeat(64),
    }),
  );

  assertEquals(automation.status, 400);
  assertEquals((await automation.json()).error.code, "INVALID_INPUT");
  assertEquals(analyst.status, 403);
  assertEquals((await analyst.json()).error.code, "READ_ONLY_ROLE");
  assertEquals(mutations, 0);
});

Deno.test("generic member deletion preserves a store-scoped removal", async () => {
  let saved: WorkspaceMutationInput | undefined;
  const response = await app(repository({
    mutate: (input) => {
      saved = input;
      return Promise.resolve({ removed: true });
    },
  })).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/members/delete`,
    json("POST", { recordId, payload: { scope: "store" } }),
  );

  assertEquals(response.status, 200);
  assertEquals(saved?.payload, { user_id: recordId, scope: "store" });
});

Deno.test("unsupported non-empty member group scopes fail before persistence", async () => {
  let mutations = 0;
  const response = await app(repository({
    mutate: () => {
      mutations += 1;
      return Promise.resolve({});
    },
  })).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/members/create`,
    json("POST", {
      payload: {
        userId: recordId,
        role: "editor",
        scope: "organization",
        groupIds: [organizationId],
      },
    }),
  );

  assertEquals(response.status, 400);
  assertEquals((await response.json()).error.code, "INVALID_INPUT");
  assertEquals(mutations, 0);
});

Deno.test("HTTP camelCase contracts are normalized to the database allowlist", async () => {
  const calls: WorkspaceMutationInput[] = [];
  const repo = repository({
    mutate: (input) => {
      calls.push(input);
      return Promise.resolve({ saved: true });
    },
  });

  const profile = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/profile/save`,
    json("POST", {
      payload: {
        businessName: "クチトル",
        primaryCategory: "レストラン",
      },
    }),
  );
  const citation = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/aio_citations/create`,
    json("POST", {
      payload: {
        directory: "Apple Business Connect",
        status: "inconsistent",
      },
    }),
  );
  const jsonld = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/jsonld/save`,
    json("POST", { payload: { type: "Restaurant", name: "クチトル" } }),
  );

  assertEquals(profile.status, 200);
  assertEquals(citation.status, 201);
  assertEquals(jsonld.status, 201);
  assertEquals(calls[0]?.payload, {
    profile: {
      businessName: "クチトル",
      primaryCategory: "レストラン",
      additionalCategories: [],
      languageCode: "ja",
    },
    source: "manual",
  });
  assertEquals(calls[1]?.payload, {
    source_name: "Apple Business Connect",
    source_type: "directory",
    consistency_status: "mismatch",
    nap_snapshot: {
      business_name: undefined,
      address: undefined,
      phone: undefined,
      website_url: undefined,
    },
  });
  assertEquals(calls[2]?.payload, {
    schema_type: "Restaurant",
    document: {
      "@context": "https://schema.org",
      "@type": "Restaurant",
      name: "クチトル",
    },
    validation_errors: [],
    status: "valid",
  });
});

Deno.test("email member creation stores only a token hash and returns the token once", async () => {
  let saved: WorkspaceMutationInput | undefined;
  const response = await app(repository({
    mutate: (input) => {
      saved = input;
      return Promise.resolve({ invitation_id: recordId });
    },
  })).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/members/create`,
    json("POST", {
      payload: {
        email: "editor@example.test",
        role: "editor",
        scope: "store",
      },
    }),
  );

  assertEquals(response.status, 201);
  const payload = await response.json();
  const token = payload.data.invitation.token as string;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error("invalid invitation token");
  }
  if (!/^[0-9a-f]{64}$/.test(String(saved?.payload.token_hash))) {
    throw new Error("invitation hash was not persisted");
  }
  assertEquals(saved?.payload.email, "editor@example.test");
  assertEquals(saved?.payload.role, "editor");
  assertEquals(saved?.payload.scope, "store");
  assertEquals(saved?.payload.token, undefined);
  assertEquals(payload.data.result, { invitation_id: recordId });
});

Deno.test("AIO observations persist manual evidence while audit stays read-only", async () => {
  const mutations: WorkspaceMutationInput[] = [];
  const reads: string[] = [];
  const repo = repository({
    list: (input) => {
      reads.push(input.resource);
      return Promise.resolve({ items: [] });
    },
    mutate: (input) => {
      mutations.push(input);
      return Promise.resolve({ saved: true });
    },
  });
  const created = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/aio_observations/create`,
    json("POST", {
      payload: {
        prompt: "東京駅周辺のおすすめ店は？",
        engine: "chatgpt",
        mentioned: true,
        position: 2,
        citedUrls: ["https://example.test/citation"],
        observedAt: "2026-08-13T02:00:00Z",
      },
    }),
  );
  const updated = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/aio_observations/update`,
    json("POST", { recordId, payload: { mentioned: false, position: null } }),
  );
  const removed = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/aio_observations/delete`,
    json("POST", { recordId, payload: {} }),
  );
  const audit = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/audit`,
    { headers: { Origin: origin } },
  );
  const auditMutation = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/audit/create`,
    json("POST", { payload: {} }),
  );

  assertEquals(created.status, 201);
  assertEquals(updated.status, 200);
  assertEquals(removed.status, 200);
  assertEquals(audit.status, 200);
  assertEquals(auditMutation.status, 400);
  assertEquals(reads, ["audit"]);
  assertEquals(mutations[0]?.payload, {
    prompt: "東京駅周辺のおすすめ店は？",
    engine: "chatgpt",
    mentioned: true,
    position: 2,
    cited_urls: ["https://example.test/citation"],
    observed_at: "2026-08-13T02:00:00Z",
  });
  assertEquals(mutations[1]?.payload, { mentioned: false, position: null });
  assertEquals(mutations[2]?.payload, {});
});

Deno.test("P0 review and insight payloads normalize without UI-specific database keys", async () => {
  const mutations: WorkspaceMutationInput[] = [];
  const repo = repository({
    mutate: (input) => {
      mutations.push(input);
      return Promise.resolve({ saved: true });
    },
  });
  const review = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/reviews/update`,
    json("POST", {
      recordId,
      payload: {
        replyText: "返信案",
        replyLanguageCode: "ja",
        status: "needs_reply",
      },
    }),
  );
  const insights = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/insights/create`,
    json("POST", {
      payload: {
        periodStart: "2026-08-01",
        periodEnd: "2026-08-07",
        source: "manual",
        metrics: {
          website_clicks: 4,
          calls: 3,
          directions: 2,
          views: 10,
          searches: 8,
        },
      },
    }),
  );

  assertEquals(review.status, 200);
  assertEquals(insights.status, 201);
  assertEquals(mutations[0]?.payload, {
    status: "needs_reply",
    reply: "返信案",
    reply_language: "ja",
  });
  assertEquals(mutations[1]?.payload, {
    period_start: "2026-08-01",
    period_end: "2026-08-07",
    metrics: {
      searches: 8,
      views: 10,
      websiteClicks: 4,
      calls: 3,
      directionRequests: 2,
    },
    source: "manual",
    input_method: "manual",
  });
});

Deno.test("profile, post, and rank UI payloads reach the database contract unchanged in meaning", async () => {
  const mutations: WorkspaceMutationInput[] = [];
  const repo = repository({
    mutate: (input) => {
      mutations.push(input);
      return Promise.resolve({ saved: true });
    },
  });

  const profile = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/profile/save`,
    json("POST", {
      payload: {
        businessName: "クチトル食堂",
        primaryCategory: "レストラン",
        phoneNumbers: {
          primaryPhone: "03-1234-5678",
          additionalPhones: ["03-9876-5432"],
        },
        websiteUri: "https://example.test/",
        languageCode: "ja",
      },
    }),
  );
  const post = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/posts/create`,
    json("POST", {
      payload: {
        topicType: "event",
        title: "夏祭り",
        summary: "週末に開催します。",
        languageCode: "ja",
        callToAction: {
          actionType: "learn_more",
          url: "https://example.test/event",
        },
        mediaAssetIds: [recordId],
        event: { startDate: "2026-08-15" },
        offer: null,
        status: "ready_for_manual_publish",
      },
    }),
  );
  const rank = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/rank_observations/create`,
    json("POST", {
      payload: {
        keyword: "新宿 ランチ",
        rank: 3,
        targetPlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
        matchedUrl: "https://example.test/menu",
        locationLabel: "新宿駅東口",
        latitude: 35.691,
        longitude: 139.701,
        observedAt: "2026-08-13T02:00:00Z",
        source: "manual",
      },
    }),
  );

  assertEquals(profile.status, 200);
  assertEquals(post.status, 201);
  assertEquals(rank.status, 201);
  assertEquals(mutations[0]?.payload, {
    profile: {
      businessName: "クチトル食堂",
      primaryCategory: "レストラン",
      additionalCategories: [],
      phoneNumbers: {
        primaryPhone: "03-1234-5678",
        additionalPhones: ["03-9876-5432"],
      },
      websiteUri: "https://example.test/",
      languageCode: "ja",
    },
    source: "manual",
  });
  assertEquals(mutations[1]?.payload, {
    post_type: "event",
    title: "夏祭り",
    summary: "週末に開催します。",
    call_to_action: "learn_more",
    call_to_action_url: "https://example.test/event",
    media_asset_ids: [recordId],
    status: "ready",
    details: {
      language: "ja",
      event: { startDate: "2026-08-15" },
      offer: null,
    },
  });
  assertEquals(mutations[2]?.payload, {
    keyword: "新宿 ランチ",
    position: 3,
    target_place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    matched_url: "https://example.test/menu",
    competitor_positions: [],
    observed_at: "2026-08-13T02:00:00Z",
    input_method: "manual",
    source: "manual",
    location: {
      label: "新宿駅東口",
      latitude: 35.691,
      longitude: 139.701,
    },
  });
});

Deno.test("change requests reuse target schemas and persist normalized payloads", async () => {
  const mutations: WorkspaceMutationInput[] = [];
  const response = await app(repository({
    authorize: () => Promise.resolve(authorization("editor", true)),
    mutate: (input) => {
      mutations.push(input);
      return Promise.resolve({ saved: true });
    },
  })).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/change_requests/create`,
    json("POST", {
      payload: {
        resource: "groups",
        action: "update",
        recordId,
        payload: { storeIds: [storeId] },
        reason: "店舗構成の更新",
      },
    }),
  );

  assertEquals(response.status, 201);
  assertEquals(mutations[0]?.payload, {
    resource: "groups",
    action: "update",
    record_id: recordId,
    payload: { store_ids: [storeId] },
    reason: "店舗構成の更新",
  });
});

Deno.test("change requests reject privilege targets and invalid nested payloads", async () => {
  let mutations = 0;
  const testApp = app(repository({
    authorize: () => Promise.resolve(authorization("editor", true)),
    mutate: () => {
      mutations += 1;
      return Promise.resolve({ saved: true });
    },
  }));
  const privileged = await testApp.request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/change_requests/create`,
    json("POST", {
      payload: {
        resource: "members",
        action: "create",
        payload: { userId: recordId, role: "admin" },
      },
    }),
  );
  const malformed = await testApp.request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/change_requests/create`,
    json("POST", {
      payload: {
        resource: "groups",
        action: "update",
        recordId,
        payload: { storeIds: ["not-a-uuid"] },
      },
    }),
  );

  assertEquals(privileged.status, 400);
  assertEquals(malformed.status, 400);
  assertEquals(mutations, 0);
});

Deno.test("the dedicated change-request route uses the same closed normalizer", async () => {
  const mutations: WorkspaceMutationInput[] = [];
  const testApp = app(repository({
    authorize: () => Promise.resolve(authorization("editor", true)),
    mutate: (input) => {
      mutations.push(input);
      return Promise.resolve({ saved: true });
    },
  }));
  const accepted = await testApp.request(
    `${origin}/meo-workspace/v1/stores/${storeId}/change-requests`,
    json("POST", {
      resource: "groups",
      action: "update",
      recordId,
      payload: { storeIds: [storeId] },
      reason: "専用経路も正規化",
    }),
  );
  const rejected = await testApp.request(
    `${origin}/meo-workspace/v1/stores/${storeId}/change-requests`,
    json("POST", {
      resource: "members",
      action: "create",
      payload: { userId: recordId, role: "admin" },
    }),
  );

  assertEquals(accepted.status, 201);
  assertEquals(rejected.status, 400);
  assertEquals(mutations.length, 1);
  assertEquals(mutations[0]?.payload, {
    resource: "groups",
    action: "update",
    record_id: recordId,
    payload: { store_ids: [storeId] },
    reason: "専用経路も正規化",
  });
});

Deno.test("payload size and cross-origin requests are rejected before mutation", async () => {
  let mutations = 0;
  const repo = repository({
    mutate: () => {
      mutations += 1;
      return Promise.resolve({});
    },
  });
  const crossOrigin = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/reviews/create`,
    {
      ...json("POST", { payload: {} }),
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
    },
  );
  assertEquals(crossOrigin.status, 403);

  const oversized = await app(repo).request(
    `${origin}/meo-workspace/v1/stores/${storeId}/resources/reviews/create`,
    json("POST", { payload: { comment: "x".repeat(70_000) } }),
  );
  assertEquals(oversized.status, 413);
  assertEquals(mutations, 0);
});
