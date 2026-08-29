import { type Context, Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { CredentialStore } from "../_shared/credential-store.ts";
import type { CredentialCipher } from "../_shared/ai-credentials.ts";
import { safeZeroFeatureCapabilities } from "../_shared/feature-rollout.ts";
import {
  AppError,
  appError,
  configureHttp,
  optionalString,
  readJsonObject,
  requestHashes,
  requireMutationKey,
  requireString,
  requireUuid,
  success,
} from "../_shared/http.ts";
import { normalizeGoogleReviewUrl } from "../_shared/google-review-url.ts";
import type { ProviderFactory, ProviderModels } from "../_shared/providers.ts";
import {
  AiRuntime,
  defaultProviderFactory,
  providerModelsConfigured,
} from "../_shared/providers.ts";
import { isValidProviderModel } from "../_shared/model-catalog.ts";
import {
  materializeSurveyDefinition,
  normalizeSurveyConfigV3,
  normalizeSurveyDefinitionV4,
  requireSurveyDefinitionV4,
  storedSurveyConfigV3,
  storedSurveyDefinitionV4,
  SURVEY_GROUP_ID_PATTERN,
  SURVEY_PRESETS,
  SURVEY_QUESTION_ID_PATTERN,
  type SurveyDefinitionV4,
  upcastSurveyConfigV3,
} from "../_shared/survey-config.ts";
import type { SupabaseRepository } from "../_shared/supabase.ts";
import type {
  AppEnv,
  JsonObject,
  ProviderName,
  SupabaseRequestContext,
} from "../_shared/types.ts";

type OwnerRepository = Pick<
  SupabaseRepository,
  | "ownerStores"
  | "ownerStore"
  | "ownerSurveyConfig"
  | "ownerSurveyRevisions"
  | "ownerInterviewSurveySnapshots"
  | "ownerFeatureCapabilities"
  | "requireFeature"
  | "claimOwnerOperation"
  | "claimStoreOperation"
  | "completeOwnerOperation"
  | "purgeOwnerIdempotency"
  | "failOperation"
  | "createStore"
  | "updateStore"
  | "updateSurveyConfig"
  | "setStoreStatus"
  | "aiConnections"
  | "getConnection"
  | "getActiveConnection"
  | "saveConnection"
  | "deleteConnection"
  | "markConnection"
  | "selectProvider"
  | "selectModel"
  | "getInterviewContext"
>;

const COMMUNITY_VERSION = "1.0.0";
const COMMUNITY_DB_SCHEMA_VERSION = "20260829000000";
const COMMUNITY_PROVIDERS: ProviderName[] = [
  "openai",
  "gemini",
  "deepseek",
  "xai",
  "anthropic",
];

export type OwnerAppDependencies = {
  allowedOrigins: ReadonlySet<string>;
  authMiddleware: MiddlewareHandler<AppEnv>;
  repository(
    c: { var: { supabaseContext: SupabaseRequestContext } },
  ): OwnerRepository;
  credentialCipher: CredentialCipher;
  models: ProviderModels;
  providerFactory?: ProviderFactory;
  now?: () => number;
  gitSha?: string;
};

function provider(value: unknown): ProviderName {
  if (
    value !== "openai" && value !== "gemini" && value !== "deepseek" &&
    value !== "xai" && value !== "anthropic"
  ) {
    throw appError("INVALID_PROVIDER", "AI Providerを確認してください。", 400);
  }
  return value;
}

function selectedModel(
  provider: ProviderName,
  value: unknown,
  models: ProviderModels,
): string {
  if (!providerModelsConfigured(models, provider)) {
    throw appError(
      "AI_PROVIDER_NOT_CONFIGURED",
      "このAI Providerのモデル設定が完了していません。",
      503,
    );
  }
  const configuredModels = Object.values(models[provider]);
  const model = typeof value === "string" && value.length > 0
    ? value
    : configuredModels[0];
  if (!isValidProviderModel(model) || !configuredModels.includes(model)) {
    throw appError(
      "INVALID_PROVIDER_MODEL",
      "AIモデルを確認してください。",
      400,
    );
  }
  return model;
}

function ownerId(context: SupabaseRequestContext): string {
  const id = context.userClaims?.id;
  if (!id) throw appError("UNAUTHORIZED", "ログインが必要です。", 401);
  return id;
}

function storeId(c: Context<AppEnv>): string {
  return requireString(c.req.param("storeId"), {
    code: "INVALID_STORE_ID",
    message: "店舗を確認してください。",
    min: 36,
    max: 36,
    pattern:
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  });
}

function safeConnection(value: JsonObject): JsonObject {
  return {
    provider: value.provider,
    status: value.status,
    keyLast4: value.key_last4,
    model: value.model,
  };
}

function safeSavedConnection(value: unknown): JsonObject {
  const row = value as JsonObject;
  return {
    provider: row.provider,
    status: row.status,
    keyLast4: row.key_last4,
    model: row.model,
  };
}

function recentReauthentication(
  jwtClaims: Record<string, unknown> | null,
  nowMs: number,
): boolean {
  const amr = jwtClaims?.amr;
  if (!Array.isArray(amr)) return false;
  const allowed = new Set([
    "password",
    "oauth",
    "otp",
    "totp",
    "sso",
    "saml",
    "magiclink",
  ]);
  const nowSeconds = Math.floor(nowMs / 1000);
  return amr.some((entry) => {
    if (entry === null || Array.isArray(entry) || typeof entry !== "object") {
      return false;
    }
    const value = entry as { method?: unknown; timestamp?: unknown };
    return typeof value.method === "string" && allowed.has(value.method) &&
      typeof value.timestamp === "number" &&
      value.timestamp <= nowSeconds + 30 && value.timestamp >= nowSeconds - 300;
  });
}

function newSurveyEntityId(prefix: "q" | "g", usedIds: Set<string>): string {
  let id: string;
  do {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    id = `${prefix}_${
      Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
    }`;
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

function assignSurveyDefinitionIds(
  input: SurveyDefinitionV4,
  stored: unknown,
): SurveyDefinitionV4 {
  const current = normalizeSurveyDefinitionV4(stored) ??
    storedSurveyDefinitionV4(stored);
  const currentGroupIds = new Set(
    current.questionGroups.map((group) => group.id),
  );
  const currentVariantIds = new Set(
    current.questionGroups.flatMap((group) =>
      group.variants.map((variant) => String(variant.id))
    ),
  );
  const usedGroupIds = new Set<string>();
  const usedVariantIds = new Set<string>();
  return {
    ...structuredClone(input),
    questionGroups: input.questionGroups.map((group) => {
      const id = SURVEY_GROUP_ID_PATTERN.test(group.id) &&
          currentGroupIds.has(group.id) && !usedGroupIds.has(group.id)
        ? group.id
        : newSurveyEntityId("g", usedGroupIds);
      usedGroupIds.add(id);
      return {
        ...structuredClone(group),
        id,
        variants: group.variants.map((variant) => {
          const variantId = typeof variant.id === "string" &&
              SURVEY_QUESTION_ID_PATTERN.test(variant.id) &&
              currentVariantIds.has(variant.id) &&
              !usedVariantIds.has(variant.id)
            ? variant.id
            : newSurveyEntityId("q", usedVariantIds);
          usedVariantIds.add(variantId);
          return { ...structuredClone(variant), id: variantId };
        }),
      };
    }),
  };
}

function requireSurveyDefinitionInput(input: unknown): SurveyDefinitionV4 {
  const v3 = normalizeSurveyConfigV3(input);
  return normalizeSurveyDefinitionV4(input) ??
    (v3 ? upcastSurveyConfigV3(v3) : requireSurveyDefinitionV4(input));
}

function mergeStoreInput(
  body: JsonObject,
  current: JsonObject | null,
): JsonObject {
  const name = requireString(body.name ?? current?.name, {
    code: "INVALID_STORE_INPUT",
    message: "店舗名を入力してください。",
    min: 1,
    max: 120,
  });
  const publicSlug = requireString(
    current?.public_slug ?? crypto.randomUUID().replaceAll("-", ""),
    {
      code: "INVALID_PUBLIC_SLUG",
      message: "公開URLを確認してください。",
      min: 16,
      max: 128,
      pattern: /^[a-z0-9][a-z0-9-]+$/,
    },
  );
  const rawGoogleUrl = body.googleReviewUrl ?? current?.google_review_url;
  const googleReviewUrl =
    rawGoogleUrl === undefined || rawGoogleUrl === null || rawGoogleUrl === ""
      ? null
      : normalizeGoogleReviewUrl(
        requireString(rawGoogleUrl, {
          code: "INVALID_GOOGLE_REVIEW_URL",
          message: "Google口コミURLを確認してください。",
          min: 1,
          max: 2048,
        }),
      );
  const googlePlaceId = optionalString(
    body.googlePlaceId ?? current?.google_place_id,
    255,
  );
  if (
    googlePlaceId !== null && !/^[A-Za-z0-9_-]{10,255}$/.test(googlePlaceId)
  ) {
    throw appError(
      "INVALID_GOOGLE_PLACE_ID",
      "GoogleマップのPlace IDを確認してください。",
      400,
    );
  }
  const websiteUrl = optionalString(
    body.websiteUrl ?? current?.website_url,
    2048,
  );
  if (websiteUrl !== null) {
    let parsed: URL;
    try {
      parsed = new URL(websiteUrl);
    } catch {
      throw appError(
        "INVALID_WEBSITE_URL",
        "WebサイトURLを確認してください。",
        400,
      );
    }
    if (!["https:", "http:"].includes(parsed.protocol)) {
      throw appError(
        "INVALID_WEBSITE_URL",
        "WebサイトURLを確認してください。",
        400,
      );
    }
  }
  return {
    publicSlug,
    name,
    industry: optionalString(body.industry ?? current?.industry, 120),
    address: optionalString(body.address ?? current?.address, 500),
    description: optionalString(body.description ?? current?.description, 2000),
    websiteUrl,
    iconPath: optionalString(body.iconPath ?? current?.icon_path, 1024),
    welcomeMessage: optionalString(
      body.welcomeMessage ?? current?.welcome_message,
      1000,
    ),
    closingMessage: optionalString(
      body.closingMessage ?? current?.closing_message,
      1000,
    ),
    googleReviewUrl,
    googlePlaceId,
  };
}

type OwnerScope =
  | "owner_store"
  | "owner_store_create"
  | "owner_publish"
  | "owner_pause"
  | "owner_connection_save"
  | "owner_connection_revalidate"
  | "owner_connection_select"
  | "owner_connection_model_select"
  | "owner_connection_delete"
  | "owner_account_delete";

type StoreScope =
  | "owner_store_update"
  | "owner_publish"
  | "owner_pause"
  | "owner_survey_update"
  | "owner_connection_save"
  | "owner_connection_revalidate"
  | "owner_connection_select"
  | "owner_connection_model"
  | "owner_connection_delete";

async function ownerMutation<T>(input: {
  c: Context<AppEnv>;
  repository: OwnerRepository;
  ownerId: string;
  scope: OwnerScope;
  logicalBody: unknown;
  execute(operationId: string): Promise<T>;
  afterComplete?(operationId: string): Promise<void>;
}): Promise<Response> {
  const key = requireMutationKey(input.c);
  const hashes = await requestHashes(
    key,
    input.c.req.method,
    input.c.req.path,
    input.logicalBody,
  );
  const claim = await input.repository.claimOwnerOperation({
    ownerId: input.ownerId,
    scope: input.scope,
    keyHash: hashes.keyHash,
    requestHash: hashes.requestHash,
  });
  if (claim.replayed === true) return success(input.c, claim.result_json as T);
  const operationId = typeof claim.operation_id === "string"
    ? claim.operation_id
    : "";
  if (!operationId) {
    throw appError("INTERNAL_ERROR", "処理を完了できませんでした。", 500, true);
  }
  try {
    const result = await input.execute(operationId);
    await input.repository.completeOwnerOperation(operationId, result);
    await input.afterComplete?.(operationId);
    return success(input.c, result);
  } catch (error) {
    await input.repository.failOperation(operationId, "OWNER_OPERATION_FAILED")
      .catch(() => undefined);
    throw error;
  }
}

async function storeMutation<T>(input: {
  c: Context<AppEnv>;
  repository: OwnerRepository;
  ownerId: string;
  storeId: string;
  scope: StoreScope;
  logicalBody: unknown;
  execute(operationId: string): Promise<T>;
}): Promise<Response> {
  const key = requireMutationKey(input.c);
  const hashes = await requestHashes(
    key,
    input.c.req.method,
    input.c.req.path,
    input.logicalBody,
  );
  const claim = await input.repository.claimStoreOperation({
    ownerId: input.ownerId,
    storeId: input.storeId,
    scope: input.scope,
    keyHash: hashes.keyHash,
    requestHash: hashes.requestHash,
  });
  if (claim.replayed === true) return success(input.c, claim.result_json as T);
  const operationId = typeof claim.operation_id === "string"
    ? claim.operation_id
    : "";
  if (!operationId) {
    throw appError("INTERNAL_ERROR", "処理を完了できませんでした。", 500, true);
  }
  try {
    const result = await input.execute(operationId);
    await input.repository.completeOwnerOperation(operationId, result);
    return success(input.c, result);
  } catch (error) {
    await input.repository.failOperation(operationId, "OWNER_OPERATION_FAILED")
      .catch(() => undefined);
    throw error;
  }
}

export function createOwnerApp(
  dependencies: OwnerAppDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  configureHttp(app, dependencies.allowedOrigins);
  app.use("/owner-api/*", dependencies.authMiddleware);

  app.get("/owner-api/system-capabilities", (c) =>
    success(c, {
      edition: "community",
      aiMode: "byok",
      providers: COMMUNITY_PROVIDERS.map((provider) => ({
        provider,
        available: providerModelsConfigured(dependencies.models, provider),
      })),
      integrations: {
        googleBusiness: true,
        instagram: true,
        dataForSeo: true,
      },
    }));

  app.get("/owner-api/version", (c) =>
    success(c, {
      version: COMMUNITY_VERSION,
      gitSha: dependencies.gitSha ?? "unknown",
      dbSchemaVersion: COMMUNITY_DB_SCHEMA_VERSION,
    }));

  app.get("/owner-api/v2/stores", async (c) => {
    const context = c.var.supabaseContext;
    return success(
      c,
      await dependencies.repository(c).ownerStores(ownerId(context)),
    );
  });

  app.post("/owner-api/v2/stores", async (c) => {
    const body = await readJsonObject(c);
    const context = c.var.supabaseContext;
    const repository = dependencies.repository(c);
    const owner = ownerId(context);
    return await ownerMutation({
      c,
      repository,
      ownerId: owner,
      scope: "owner_store_create",
      logicalBody: body,
      execute: (operationId) =>
        repository.createStore(
          owner,
          operationId,
          mergeStoreInput(body, null),
        ),
    });
  });

  app.get("/owner-api/v2/stores/:storeId", async (c) => {
    const context = c.var.supabaseContext;
    const store = await dependencies.repository(c).ownerStore(
      ownerId(context),
      storeId(c),
    );
    if (!store) {
      throw appError("STORE_NOT_FOUND", "店舗情報が見つかりません。", 404);
    }
    return success(c, store);
  });

  app.patch("/owner-api/v2/stores/:storeId", async (c) => {
    const body = await readJsonObject(c);
    const context = c.var.supabaseContext;
    const repository = dependencies.repository(c);
    const owner = ownerId(context);
    const selectedStoreId = storeId(c);
    return await storeMutation({
      c,
      repository,
      ownerId: owner,
      storeId: selectedStoreId,
      scope: "owner_store_update",
      logicalBody: body,
      execute: async () => {
        const current = await repository.ownerStore(owner, selectedStoreId);
        if (!current) {
          throw appError("STORE_NOT_FOUND", "店舗情報が見つかりません。", 404);
        }
        return await repository.updateStore(
          owner,
          selectedStoreId,
          mergeStoreInput(body, current),
        );
      },
    });
  });

  app.get("/owner-api/v2/stores/:storeId/survey-config", async (c) => {
    const context = c.var.supabaseContext;
    const config = await dependencies.repository(c).ownerSurveyConfig(
      ownerId(context),
      storeId(c),
    );
    if (!config) {
      throw appError(
        "STORE_NOT_FOUND",
        "先に店舗情報を保存してください。",
        404,
      );
    }
    const definition = normalizeSurveyDefinitionV4(config);
    return success(
      c,
      definition
        ? materializeSurveyDefinition(definition, () => 0).config
        : storedSurveyConfigV3(config),
    );
  });

  app.get("/owner-api/v3/stores/:storeId/survey-config", async (c) => {
    const context = c.var.supabaseContext;
    const config = await dependencies.repository(c).ownerSurveyConfig(
      ownerId(context),
      storeId(c),
    );
    if (!config) {
      throw appError(
        "STORE_NOT_FOUND",
        "先に店舗情報を保存してください。",
        404,
      );
    }
    return success(c, storedSurveyDefinitionV4(config));
  });

  app.get("/owner-api/v2/survey-presets", (c) => {
    ownerId(c.var.supabaseContext);
    return success(c, structuredClone(SURVEY_PRESETS));
  });

  app.get("/owner-api/v2/stores/:storeId/survey-revisions", async (c) => {
    const context = c.var.supabaseContext;
    return success(
      c,
      await dependencies.repository(c).ownerSurveyRevisions(
        ownerId(context),
        storeId(c),
      ),
    );
  });

  app.post(
    "/owner-api/v2/stores/:storeId/interview-survey-snapshots",
    async (c) => {
      const body = await readJsonObject(c, 2_048);
      if (!Array.isArray(body.sessionIds) || body.sessionIds.length > 21) {
        throw appError(
          "INVALID_SESSION_IDS",
          "回答セッションの指定が正しくありません。",
          400,
        );
      }
      const sessionIds = [
        ...new Set(
          body.sessionIds.map((value) =>
            requireUuid(value, "INVALID_SESSION_IDS")
          ),
        ),
      ];
      const context = c.var.supabaseContext;
      return success(
        c,
        await dependencies.repository(c).ownerInterviewSurveySnapshots(
          ownerId(context),
          storeId(c),
          sessionIds,
        ),
      );
    },
  );

  app.put("/owner-api/v2/stores/:storeId/survey-config", async (c) => {
    const body = await readJsonObject(c, 32_768);
    const config = requireSurveyDefinitionInput(body);
    const context = c.var.supabaseContext;
    const repository = dependencies.repository(c);
    const owner = ownerId(context);
    const selectedStoreId = storeId(c);
    return await storeMutation({
      c,
      repository,
      ownerId: owner,
      storeId: selectedStoreId,
      scope: "owner_survey_update",
      logicalBody: config,
      execute: async () => {
        const current = await repository.ownerSurveyConfig(
          owner,
          selectedStoreId,
        );
        if (
          normalizeSurveyDefinitionV4(current) && normalizeSurveyConfigV3(body)
        ) {
          throw appError(
            "SURVEY_EDITOR_UPGRADE_REQUIRED",
            "新しいアンケート編集画面へ更新してから保存してください。",
            409,
          );
        }
        const configWithServerIds = assignSurveyDefinitionIds(config, current);
        const saved = storedSurveyDefinitionV4(
          await repository.updateSurveyConfig(
            owner,
            selectedStoreId,
            configWithServerIds,
          ),
        );
        return materializeSurveyDefinition(saved, () => 0).config;
      },
    });
  });

  app.put("/owner-api/v3/stores/:storeId/survey-config", async (c) => {
    const body = await readJsonObject(c, 32_768);
    const config = requireSurveyDefinitionInput(body);
    const context = c.var.supabaseContext;
    const repository = dependencies.repository(c);
    const owner = ownerId(context);
    const selectedStoreId = storeId(c);
    return await storeMutation({
      c,
      repository,
      ownerId: owner,
      storeId: selectedStoreId,
      scope: "owner_survey_update",
      logicalBody: config,
      execute: async () => {
        const current = await repository.ownerSurveyConfig(
          owner,
          selectedStoreId,
        );
        const configWithServerIds = assignSurveyDefinitionIds(config, current);
        return storedSurveyDefinitionV4(
          await repository.updateSurveyConfig(
            owner,
            selectedStoreId,
            configWithServerIds,
          ),
        );
      },
    });
  });

  app.get("/owner-api/v2/feature-capabilities", async (c) => {
    const context = c.var.supabaseContext;
    const owner = ownerId(context);
    const stores = await dependencies.repository(c).ownerStores(owner);
    const selectedStore = stores[0];
    if (!selectedStore || typeof selectedStore.id !== "string") {
      throw appError("STORE_NOT_FOUND", "店舗情報が見つかりません。", 404);
    }
    const evaluatedAt = new Date((dependencies.now ?? Date.now)())
      .toISOString();
    const capabilities = await dependencies.repository(c)
      .ownerFeatureCapabilities(
        owner,
        selectedStore.id,
        evaluatedAt,
      );
    return success(
      c,
      safeZeroFeatureCapabilities(
        capabilities,
        evaluatedAt,
      ),
    );
  });

  app.get("/owner-api/v2/stores/:storeId/feature-capabilities", async (c) => {
    const repository = dependencies.repository(c);
    const owner = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    if (!await repository.ownerStore(owner, selectedStoreId)) {
      throw appError("STORE_NOT_FOUND", "店舗情報が見つかりません。", 404);
    }
    const evaluatedAt = new Date((dependencies.now ?? Date.now)())
      .toISOString();
    const capabilities = await repository.ownerFeatureCapabilities(
      owner,
      selectedStoreId,
      evaluatedAt,
    );
    return success(
      c,
      safeZeroFeatureCapabilities(
        capabilities,
        evaluatedAt,
      ),
    );
  });

  app.post("/owner-api/v2/stores/:storeId/publish", async (c) => {
    const context = c.var.supabaseContext;
    const repository = dependencies.repository(c);
    const owner = ownerId(context);
    const selectedStoreId = storeId(c);
    return await storeMutation({
      c,
      repository,
      ownerId: owner,
      storeId: selectedStoreId,
      scope: "owner_publish",
      logicalBody: {},
      execute: () =>
        repository.setStoreStatus(owner, selectedStoreId, "published"),
    });
  });

  app.post("/owner-api/v2/stores/:storeId/pause", async (c) => {
    const context = c.var.supabaseContext;
    const repository = dependencies.repository(c);
    const owner = ownerId(context);
    const selectedStoreId = storeId(c);
    return await storeMutation({
      c,
      repository,
      ownerId: owner,
      storeId: selectedStoreId,
      scope: "owner_pause",
      logicalBody: {},
      execute: () =>
        repository.setStoreStatus(owner, selectedStoreId, "paused"),
    });
  });

  app.get("/owner-api/v2/stores/:storeId/ai-connection", async (c) => {
    const context = c.var.supabaseContext;
    const connections = await dependencies.repository(c).aiConnections(
      ownerId(context),
      storeId(c),
    );
    const active = connections.find((connection) =>
      connection.is_active === true
    ) ?? connections[0];
    return success(c, active ? safeConnection(active) : null);
  });

  app.get("/owner-api/v2/stores/:storeId/ai-connections", async (c) => {
    const context = c.var.supabaseContext;
    const connections = await dependencies.repository(c).aiConnections(
      ownerId(context),
      storeId(c),
    );
    return success(c, connections.map(safeConnection));
  });

  app.post(
    "/owner-api/v2/stores/:storeId/ai-connection/validate-and-save",
    async (c) => {
      const body = await readJsonObject(c, 8_192);
      const selectedProvider = provider(body.provider);
      const model = selectedModel(
        selectedProvider,
        body.model,
        dependencies.models,
      );
      const activate = body.activate === false ? false : true;
      const apiKey = requireString(body.apiKey, {
        code: "INVALID_API_KEY",
        message: "APIキーを確認してください。",
        min: 12,
        max: 4096,
      });
      const context = c.var.supabaseContext;
      const owner = ownerId(context);
      const selectedStoreId = storeId(c);
      const repository = dependencies.repository(c);
      return await storeMutation({
        c,
        repository,
        ownerId: owner,
        storeId: selectedStoreId,
        scope: "owner_connection_save",
        logicalBody: body,
        execute: async () => {
          const store = await repository.ownerStore(owner, selectedStoreId);
          if (!store || typeof store.id !== "string") {
            throw appError(
              "STORE_NOT_FOUND",
              "先に店舗情報を保存してください。",
              404,
            );
          }
          const runtime = new AiRuntime(
            repository,
            dependencies.models,
            dependencies.providerFactory ?? defaultProviderFactory,
          );
          await runtime.provider(selectedProvider, apiKey, model)
            .validateCredential(apiKey, c.get("requestId"));
          const credentialStore = new CredentialStore(
            repository,
            dependencies.credentialCipher,
          );
          return safeSavedConnection(
            await credentialStore.save(
              owner,
              store.id,
              selectedProvider,
              model,
              apiKey,
              activate,
            ),
          );
        },
      });
    },
  );

  app.post(
    "/owner-api/v2/stores/:storeId/ai-connection/revalidate",
    async (c) => {
      const body = await readJsonObject(c, 2_048);
      const selectedProvider = provider(body.provider);
      const context = c.var.supabaseContext;
      const owner = ownerId(context);
      const selectedStoreId = storeId(c);
      const repository = dependencies.repository(c);
      return await storeMutation({
        c,
        repository,
        ownerId: owner,
        storeId: selectedStoreId,
        scope: "owner_connection_revalidate",
        logicalBody: { provider: selectedProvider },
        execute: async () => {
          const credentialStore = new CredentialStore(
            repository,
            dependencies.credentialCipher,
          );
          const credential = await credentialStore.getOwnerCredential(
            owner,
            selectedStoreId,
            selectedProvider,
          );
          if (!credential) {
            throw appError(
              "AI_CONNECTION_NOT_FOUND",
              "AI接続が見つかりません。",
              404,
            );
          }
          const runtime = new AiRuntime(
            repository,
            dependencies.models,
            dependencies.providerFactory ?? defaultProviderFactory,
          );
          try {
            await runtime.provider(
              selectedProvider,
              credential.apiKey,
              credential.value.model,
            )
              .validateCredential(credential.apiKey, c.get("requestId"));
            return safeSavedConnection(
              await repository.markConnection(
                owner,
                selectedStoreId,
                selectedProvider,
                "active",
                null,
              ),
            );
          } catch (error) {
            if (
              error instanceof AppError &&
              error.code === "AI_CREDENTIAL_INVALID"
            ) {
              await repository.markConnection(
                owner,
                selectedStoreId,
                selectedProvider,
                "invalid",
                "AI_CREDENTIAL_INVALID",
              );
            }
            throw error;
          }
        },
      });
    },
  );

  app.post(
    "/owner-api/v2/stores/:storeId/ai-connection/select-provider",
    async (c) => {
      const body = await readJsonObject(c, 2_048);
      const context = c.var.supabaseContext;
      const repository = dependencies.repository(c);
      const owner = ownerId(context);
      const selectedStoreId = storeId(c);
      const selectedProvider = provider(body.provider);
      return await storeMutation({
        c,
        repository,
        ownerId: owner,
        storeId: selectedStoreId,
        scope: "owner_connection_select",
        logicalBody: { provider: selectedProvider },
        execute: async () =>
          safeSavedConnection(
            await repository.selectProvider(
              owner,
              selectedStoreId,
              selectedProvider,
            ),
          ),
      });
    },
  );

  app.post(
    "/owner-api/v2/stores/:storeId/ai-connection/select-model",
    async (c) => {
      const body = await readJsonObject(c, 2_048);
      const context = c.var.supabaseContext;
      const repository = dependencies.repository(c);
      const owner = ownerId(context);
      const selectedStoreId = storeId(c);
      const selectedProvider = provider(body.provider);
      const model = selectedModel(
        selectedProvider,
        body.model,
        dependencies.models,
      );
      return await storeMutation({
        c,
        repository,
        ownerId: owner,
        storeId: selectedStoreId,
        scope: "owner_connection_model",
        logicalBody: { provider: selectedProvider, model },
        execute: async () =>
          safeSavedConnection(
            await repository.selectModel(
              owner,
              selectedStoreId,
              selectedProvider,
              model,
            ),
          ),
      });
    },
  );

  app.delete("/owner-api/v2/stores/:storeId/ai-connection", async (c) => {
    const selectedProvider = provider(c.req.query("provider"));
    const context = c.var.supabaseContext;
    const repository = dependencies.repository(c);
    const owner = ownerId(context);
    const selectedStoreId = storeId(c);
    return await storeMutation({
      c,
      repository,
      ownerId: owner,
      storeId: selectedStoreId,
      scope: "owner_connection_delete",
      logicalBody: { provider: selectedProvider },
      execute: async () => {
        await new CredentialStore(repository, dependencies.credentialCipher)
          .delete(owner, selectedStoreId, selectedProvider);
        return { deleted: true, provider: selectedProvider };
      },
    });
  });

  app.delete("/owner-api/account", async (c) => {
    const context = c.var.supabaseContext;
    if (
      !recentReauthentication(
        context.jwtClaims,
        (dependencies.now ?? Date.now)(),
      )
    ) {
      throw appError(
        "REAUTHENTICATION_REQUIRED",
        "アカウント削除の前に再認証してください。",
        409,
      );
    }
    const owner = ownerId(context);
    const authorization = c.req.header("Authorization") ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    if (!token) throw appError("UNAUTHORIZED", "ログインが必要です。", 401);
    const repository = dependencies.repository(c);
    return await ownerMutation({
      c,
      repository,
      ownerId: owner,
      scope: "owner_account_delete",
      logicalBody: {},
      execute: async (operationId) => {
        await repository.purgeOwnerIdempotency(owner, operationId);
        const signOut = await context.supabaseAdmin.auth.admin.signOut(
          token,
          "global",
        );
        if (signOut.error) {
          throw appError(
            "ACCOUNT_DELETE_FAILED",
            "アカウントを削除できませんでした。",
            503,
            true,
          );
        }
        const deleted = await context.supabaseAdmin.auth.admin.deleteUser(
          owner,
        );
        if (deleted.error) {
          throw appError(
            "ACCOUNT_DELETE_FAILED",
            "アカウントを削除できませんでした。",
            503,
            true,
          );
        }
        return { deleted: true };
      },
      afterComplete: async () => {
        await repository.purgeOwnerIdempotency(owner, null);
      },
    });
  });

  return app;
}

export const ownerInternals = {
  assignSurveyQuestionIds: assignSurveyDefinitionIds,
  recentReauthentication,
};
