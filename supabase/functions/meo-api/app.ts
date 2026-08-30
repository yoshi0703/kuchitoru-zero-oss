import { type Context, Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { CredentialCipher } from "../_shared/ai-credentials.ts";
import {
  defaultProviderFactory,
  type ProviderFactory,
} from "../_shared/providers.ts";
import {
  AppError,
  appError,
  configureHttp,
  optionalString,
  readJsonObject,
  requestHashes,
  requireMutationKey,
  requireString,
  sha256Hex,
  success,
} from "../_shared/http.ts";
import {
  comparePerformance,
  createGbpPostDraft,
  createReviewReplyDraft,
  evaluateGbpHealth,
  type HealthMetrics,
  type PerformanceMetrics,
  type ReviewReplyTone,
} from "../_shared/meo-core.ts";
import {
  DataForSeoClient,
  type DataForSeoCredential,
  decryptExternalCredential,
  encryptExternalCredential,
  type ExternalProvider,
  googleAuthorizationUrl,
  GoogleBusinessClient,
  type GoogleLocalPostPage,
  type GoogleMediaPage,
  type GoogleReviewPage,
  type GoogleToken,
  instagramAuthorizationUrl,
  InstagramClient,
  type InstagramToken,
} from "../_shared/meo-provider.ts";
import type { MeoRepository } from "../_shared/meo-repository.ts";
import type { SupabaseRepository } from "../_shared/supabase.ts";
import type {
  AppEnv,
  JsonObject,
  ReviewReplyDraftInput,
  SupabaseRequestContext,
} from "../_shared/types.ts";

type MeoRepositoryPort = Pick<
  MeoRepository,
  | "requireFeature"
  | "reserveProviderCall"
  | "settleProviderCall"
  | "claimHealthDiagnosis"
  | "settleHealthDiagnosis"
  | "saveManualHealthDiagnosis"
  | "latestHealthResult"
  | "createOauthState"
  | "prepareOauthCallback"
  | "consumeOauthState"
  | "connections"
  | "connection"
  | "saveConnection"
  | "selectGoogleLocation"
  | "deleteConnection"
  | "externalWriteSettings"
  | "setExternalWrites"
  | "updateCredential"
  | "claimExternalAction"
  | "completeExternalAction"
  | "attentionExternalAction"
  | "failExternalAction"
  | "reserveAiDraft"
  | "settleAiDraft"
  | "saveManualRank"
  | "rankHistory"
  | "reserveRankMeasurement"
  | "markRankSubmitted"
  | "failRankMeasurement"
  | "saveInsights"
  | "insightHistory"
>;

export type MeoAppDependencies = {
  allowedOrigins: ReadonlySet<string>;
  authMiddleware: MiddlewareHandler<AppEnv>;
  callbackAuthMiddleware: MiddlewareHandler<AppEnv>;
  repository(
    c: { var: { supabaseContext: SupabaseRequestContext } },
  ): MeoRepositoryPort;
  ownerAiRepository?: (
    c: { var: { supabaseContext: SupabaseRequestContext } },
  ) => Pick<SupabaseRepository, "getActiveConnection">;
  credentialCipher: CredentialCipher;
  appOrigin: string;
  google?: {
    clientId: string;
    redirectUri: string;
    client: GoogleBusinessClient;
  };
  instagram?: {
    appId: string;
    redirectUri: string;
    client: InstagramClient;
  };
  dataForSeoFactory?: (credential: DataForSeoCredential) => DataForSeoClient;
  providerFactory?: ProviderFactory;
  aiDraftStoreDailyLimit?: number;
  aiDraftGlobalDailyLimit?: number;
  rankStoreDailyLimit?: number;
  rankGlobalDailyPointLimit?: number;
  now?: () => number;
};

type FeatureKey =
  | "review_reply"
  | "meo_rank"
  | "gbp_insights"
  | "gbp_health"
  | "instagram_to_gbp";

type FeatureExecutionMode = "native" | "owner_provider";

type ProviderCallOperation =
  | "google_oauth_start"
  | "instagram_oauth_start"
  | "google_oauth_exchange"
  | "instagram_oauth_exchange"
  | "google_reviews_list"
  | "google_review_reply_write"
  | "google_locations_list"
  | "google_insights_sync"
  | "google_health_read"
  | "instagram_media_list"
  | "google_post_write"
  | "dataforseo_credential_validate";

type ProviderCallQuota = {
  windowSeconds: number;
  storeWindowLimit: number;
  globalWindowLimit: number;
  storeDailyLimit: number;
  globalDailyLimit: number;
};

const PROVIDER_CALL_QUOTAS: Record<ProviderCallOperation, ProviderCallQuota> = {
  google_oauth_start: {
    windowSeconds: 600,
    storeWindowLimit: 5,
    globalWindowLimit: 500,
    storeDailyLimit: 20,
    globalDailyLimit: 10_000,
  },
  instagram_oauth_start: {
    windowSeconds: 600,
    storeWindowLimit: 5,
    globalWindowLimit: 500,
    storeDailyLimit: 20,
    globalDailyLimit: 10_000,
  },
  google_oauth_exchange: {
    windowSeconds: 600,
    storeWindowLimit: 5,
    globalWindowLimit: 500,
    storeDailyLimit: 20,
    globalDailyLimit: 10_000,
  },
  instagram_oauth_exchange: {
    windowSeconds: 600,
    storeWindowLimit: 5,
    globalWindowLimit: 500,
    storeDailyLimit: 20,
    globalDailyLimit: 10_000,
  },
  google_reviews_list: {
    windowSeconds: 300,
    storeWindowLimit: 10,
    globalWindowLimit: 1_000,
    storeDailyLimit: 100,
    globalDailyLimit: 50_000,
  },
  google_review_reply_write: {
    windowSeconds: 300,
    storeWindowLimit: 5,
    globalWindowLimit: 500,
    storeDailyLimit: 50,
    globalDailyLimit: 20_000,
  },
  google_locations_list: {
    windowSeconds: 600,
    storeWindowLimit: 5,
    globalWindowLimit: 500,
    storeDailyLimit: 20,
    globalDailyLimit: 10_000,
  },
  google_insights_sync: {
    windowSeconds: 600,
    storeWindowLimit: 3,
    globalWindowLimit: 500,
    storeDailyLimit: 24,
    globalDailyLimit: 20_000,
  },
  google_health_read: {
    windowSeconds: 600,
    storeWindowLimit: 6,
    globalWindowLimit: 1_000,
    storeDailyLimit: 72,
    globalDailyLimit: 50_000,
  },
  instagram_media_list: {
    windowSeconds: 600,
    storeWindowLimit: 6,
    globalWindowLimit: 1_000,
    storeDailyLimit: 72,
    globalDailyLimit: 50_000,
  },
  google_post_write: {
    windowSeconds: 600,
    storeWindowLimit: 3,
    globalWindowLimit: 300,
    storeDailyLimit: 20,
    globalDailyLimit: 10_000,
  },
  dataforseo_credential_validate: {
    windowSeconds: 600,
    storeWindowLimit: 3,
    globalWindowLimit: 300,
    storeDailyLimit: 10,
    globalDailyLimit: 5_000,
  },
};

const encoder = new TextEncoder();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GOOGLE_LOCATION_PATTERN =
  /^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+$/;
const GOOGLE_REVIEW_PATTERN =
  /^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+\/reviews\/[A-Za-z0-9_-]+$/;
const GOOGLE_LOCAL_POST_PATTERN =
  /^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+\/localPosts\/[A-Za-z0-9_-]+$/;
const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,255}$/;
const OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const OAUTH_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const OAUTH_VERIFIER_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

class ExternalActionOutcomeUnknown extends Error {
  constructor() {
    super("EXTERNAL_ACTION_OUTCOME_UNKNOWN");
    this.name = "ExternalActionOutcomeUnknown";
  }
}

function ownerId(context: SupabaseRequestContext): string {
  const id = context.userClaims?.id;
  if (!id) throw appError("UNAUTHORIZED", "ログインが必要です。", 401);
  return id;
}

function storeId(c: Context<AppEnv>): string {
  const value = c.req.param("storeId");
  if (!value || !UUID_PATTERN.test(value)) {
    throw appError("INVALID_STORE_ID", "店舗を確認してください。", 400);
  }
  return value;
}

function bool(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") {
    throw appError(code, "入力内容を確認してください。", 400);
  }
  return value;
}

function count(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw appError(code, "数値を確認してください。", 400);
  }
  return value;
}

function nullableCount(value: unknown, code: string): number | null {
  return value === null || value === undefined ? null : count(value, code);
}

function object(value: unknown, code: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw appError(code, "入力内容を確認してください。", 400);
  }
  return value as JsonObject;
}

function hasNonEmptyText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasPhoneNumber(value: unknown): boolean {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const phoneNumbers = value as JsonObject;
  if (hasNonEmptyText(phoneNumbers.primaryPhone)) return true;
  return Array.isArray(phoneNumbers.additionalPhones) &&
    phoneNumbers.additionalPhones.some(hasNonEmptyText);
}

function hasPrimaryCategory(value: unknown): boolean {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const category = value as JsonObject;
  return hasNonEmptyText(category.name) ||
    hasNonEmptyText(category.displayName);
}

function hasBusinessHours(value: unknown): boolean {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const periods = (value as JsonObject).periods;
  return Array.isArray(periods) && periods.length > 0;
}

function date(value: unknown, code: string): string {
  const result = requireString(value, {
    code,
    message: "日付を確認してください。",
    min: 10,
    max: 10,
    pattern: /^\d{4}-\d{2}-\d{2}$/,
  });
  const parsed = new Date(`${result}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== result
  ) {
    throw appError(code, "日付を確認してください。", 400);
  }
  return result;
}

function provider(value: string): ExternalProvider {
  if (
    value !== "google_business" && value !== "instagram" &&
    value !== "dataforseo"
  ) {
    throw appError(
      "INVALID_CONNECTION_PROVIDER",
      "連携先を確認してください。",
      400,
    );
  }
  return value;
}

function safeConnection(row: JsonObject): JsonObject {
  return {
    provider: row.provider,
    status: row.status,
    displayName: row.display_name ?? null,
    locationName: row.location_name ?? null,
    expiresAt: row.expires_at ?? null,
    connectedAt: row.connected_at ?? null,
    safeErrorCode: row.last_error_code ?? null,
  };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/u,
    "",
  );
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64Url(new Uint8Array(digest));
}

async function requireFeature(
  repository: MeoRepositoryPort,
  actorId: string,
  selectedStoreId: string,
  key: FeatureKey,
): Promise<JsonObject> {
  try {
    return await repository.requireFeature(actorId, selectedStoreId, key);
  } catch (error) {
    const mapped = featureAccessError(error);
    if (mapped) throw mapped;
    throw error;
  }
}

function featureAccessError(error: unknown): AppError | null {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("FEATURE_HIDDEN")) {
    return appError(
      "FEATURE_HIDDEN",
      "この機能はまだ公開されていません。",
      404,
    );
  }
  if (message.includes("FEATURE_PAUSED")) {
    return appError(
      "FEATURE_PAUSED",
      "ただいま一時停止しています。",
      503,
      true,
    );
  }
  if (message.includes("FEATURE_NOT_RELEASED")) {
    return appError("FEATURE_NOT_RELEASED", "公開日までお待ちください。", 425);
  }
  if (message.includes("FEATURE_EXECUTION_MODE_MISMATCH")) {
    return appError(
      "FEATURE_EXECUTION_MODE_MISMATCH",
      "この機能の実行方式を確認できませんでした。",
      503,
      true,
    );
  }
  return null;
}

const GOOGLE_CONNECTION_FEATURES: readonly FeatureKey[] = [
  "review_reply",
  "gbp_insights",
  "gbp_health",
  "instagram_to_gbp",
];

async function requireConnectionFeature(
  repository: MeoRepositoryPort,
  actorId: string,
  selectedStoreId: string,
  selectedProvider: ExternalProvider,
): Promise<void> {
  const featureKeys = selectedProvider === "instagram"
    ? ["instagram_to_gbp"] as const
    : selectedProvider === "google_business"
    ? GOOGLE_CONNECTION_FEATURES
    : ["meo_rank"] as const;
  const unavailable: AppError[] = [];
  for (const featureKey of featureKeys) {
    try {
      await requireFeature(repository, actorId, selectedStoreId, featureKey);
      return;
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === "FEATURE_HIDDEN" ||
          error.code === "FEATURE_PAUSED" ||
          error.code === "FEATURE_NOT_RELEASED")
      ) {
        unavailable.push(error);
        continue;
      }
      throw error;
    }
  }
  throw unavailable.find((error) => error.code === "FEATURE_PAUSED") ??
    unavailable.find((error) => error.code === "FEATURE_NOT_RELEASED") ??
    unavailable[0] ??
    appError(
      "FEATURE_HIDDEN",
      "この機能はまだ公開されていません。",
      404,
    );
}

function providerCallService(
  operation: ProviderCallOperation,
): "dataforseo_api" | "google_business_api" | "instagram_graph_api" {
  if (operation === "dataforseo_credential_validate") {
    return "dataforseo_api";
  }
  return operation.startsWith("instagram_")
    ? "instagram_graph_api"
    : "google_business_api";
}

function safeProviderCallError(error: unknown): string {
  const code = error instanceof AppError ? error.code : "PROVIDER_CALL_FAILED";
  return /^[A-Z0-9_:-]{2,100}$/.test(code) ? code : "PROVIDER_CALL_FAILED";
}

function healthDiagnosisReplay(value: unknown): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw appError(
      "HEALTH_DIAGNOSIS_REPLAY_INVALID",
      "保存済みの診断結果を確認できませんでした。",
      503,
      true,
    );
  }
  const result = value as JsonObject;
  if (
    !Number.isSafeInteger(result.score) || Number(result.score) < 0 ||
    Number(result.score) > 100 || !Array.isArray(result.checks) ||
    result.checks.length !== 9
  ) {
    throw appError(
      "HEALTH_DIAGNOSIS_REPLAY_INVALID",
      "保存済みの診断結果を確認できませんでした。",
      503,
      true,
    );
  }
  return result;
}

function latestHealthDiagnosis(value: unknown): JsonObject | null {
  if (value === null) return null;
  if (Array.isArray(value) || typeof value !== "object") {
    throw appError(
      "LATEST_HEALTH_RESULT_INVALID",
      "保存済みの診断結果を確認できませんでした。",
      503,
      true,
    );
  }
  const latest = value as JsonObject;
  if (
    (latest.source !== "manual" && latest.source !== "google_business") ||
    typeof latest.diagnosedAt !== "string" ||
    !Number.isFinite(new Date(latest.diagnosedAt).getTime())
  ) {
    throw appError(
      "LATEST_HEALTH_RESULT_INVALID",
      "保存済みの診断結果を確認できませんでした。",
      503,
      true,
    );
  }
  return {
    source: latest.source,
    diagnosedAt: latest.diagnosedAt,
    result: healthDiagnosisReplay(latest.result),
  };
}

function completedHealthDiagnosis(
  source: "manual" | "google_business",
  value: unknown,
): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw appError(
      "HEALTH_DIAGNOSIS_COMPLETION_INVALID",
      "保存済みの診断結果を確認できませんでした。",
      503,
      true,
    );
  }
  const saved = value as JsonObject;
  if (
    typeof saved.diagnosedAt !== "string" ||
    !Number.isFinite(new Date(saved.diagnosedAt).getTime())
  ) {
    throw appError(
      "HEALTH_DIAGNOSIS_COMPLETION_INVALID",
      "保存済みの診断結果を確認できませんでした。",
      503,
      true,
    );
  }
  return {
    source,
    diagnosedAt: saved.diagnosedAt,
    result: healthDiagnosisReplay(saved.result),
  };
}

async function meteredProviderCall<T>(input: {
  c: Context<AppEnv>;
  repository: MeoRepositoryPort;
  actorId: string;
  storeId: string;
  operation: ProviderCallOperation;
  credentialSource?: FeatureExecutionMode;
  logicalBody?: unknown;
  execute: () => Promise<T>;
}): Promise<T> {
  const quota = PROVIDER_CALL_QUOTAS[input.operation];
  const reservation = await input.repository.reserveProviderCall({
    actorId: input.actorId,
    storeId: input.storeId,
    keyHash: await sha256(crypto.randomUUID()),
    requestHash: await sha256(JSON.stringify({
      method: input.c.req.method,
      path: input.c.req.path,
      operation: input.operation,
      logicalBody: input.logicalBody ?? null,
    })),
    service: providerCallService(input.operation),
    operation: input.operation,
    credentialSource: input.credentialSource ?? "native",
    ...quota,
  });
  if (reservation.authorized !== true) {
    throw appError(
      "PROVIDER_RATE_LIMITED",
      "短時間に操作が集中したため、しばらく待ってからもう一度お試しください。",
      429,
      true,
    );
  }
  const reservationId = typeof reservation.reservation_id === "string"
    ? reservation.reservation_id
    : "";
  if (!UUID_PATTERN.test(reservationId)) {
    throw appError(
      "INTERNAL_ERROR",
      "外部サービスへの接続を開始できませんでした。",
      500,
      true,
    );
  }
  let result: T;
  try {
    result = await input.execute();
  } catch (error) {
    await input.repository.settleProviderCall({
      reservationId,
      outcome: error instanceof ExternalActionOutcomeUnknown
        ? "attention_required"
        : "failed",
      safeErrorCode: safeProviderCallError(error),
    }).catch(() => undefined);
    throw error;
  }
  try {
    await input.repository.settleProviderCall({
      reservationId,
      outcome: "success",
      safeErrorCode: null,
    });
  } catch {
    throw appError(
      "PROVIDER_RESULT_SETTLEMENT_FAILED",
      "外部サービスの取得結果を記録できませんでした。再実行せず、管理者へお問い合わせください。",
      503,
      true,
    );
  }
  return result;
}

function featureExecutionMode(capability: JsonObject): FeatureExecutionMode {
  const value = capability.execution_mode;
  if (
    value !== "native" && value !== "owner_provider"
  ) {
    throw appError(
      "INVALID_FEATURE_CONFIGURATION",
      "機能の設定を確認できませんでした。",
      503,
      true,
    );
  }
  return value;
}

function appRedirect(
  origin: string,
  returnPath: string,
  status: string,
  parameters: Readonly<Record<string, string>> = {},
): Response {
  const url = new URL(returnPath, origin);
  url.searchParams.set("connection", status);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: url.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function appFragmentRedirect(
  origin: string,
  returnPath: string,
  parameters: Readonly<Record<string, string>>,
): Response {
  const url = new URL(returnPath, origin);
  url.hash = new URLSearchParams(parameters).toString();
  return new Response(null, {
    status: 303,
    headers: {
      Location: url.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

type OauthFailureReason = "generic" | "expired";
type OauthFailureLocale = "ja" | "en";

const OAUTH_FAILURE_COPY: Record<
  OauthFailureLocale,
  Record<"title" | "heading" | OauthFailureReason | "guidance", string>
> = {
  ja: {
    title: "接続エラー",
    heading: "接続を完了できませんでした",
    generic: "外部サービスとの接続を完了できませんでした。",
    expired: "接続の有効時間が切れています。",
    guidance: "クチトルZeroへ戻り、もう一度お試しください。",
  },
  en: {
    title: "Connection error",
    heading: "We couldn't complete the connection",
    generic: "We couldn't complete the connection to the external service.",
    expired: "This connection attempt has expired.",
    guidance: "Return to Kuchitoru Zero and try again.",
  },
};

function oauthFailureLocale(
  acceptLanguage: string | undefined,
): OauthFailureLocale {
  if (!acceptLanguage) return "ja";
  let selected:
    | { locale: OauthFailureLocale; quality: number; order: number }
    | undefined;
  for (const [order, preference] of acceptLanguage.split(",").entries()) {
    const parts = preference.trim().split(";");
    const language = parts.shift()?.trim().toLowerCase();
    if (!language || !/^[a-z]{1,8}(?:-[a-z0-9]{1,8})*$/.test(language)) {
      continue;
    }
    const locale = language.split("-")[0];
    if (locale !== "ja" && locale !== "en") continue;
    let quality = 1;
    for (const parameter of parts) {
      const match = /^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i.exec(
        parameter.trim(),
      );
      if (!match) {
        quality = -1;
        break;
      }
      quality = Number(match[1]);
    }
    if (quality <= 0) continue;
    if (
      !selected || quality > selected.quality ||
      (quality === selected.quality && order < selected.order)
    ) {
      selected = { locale, quality, order };
    }
  }
  return selected?.locale ?? "ja";
}

function oauthFailure(
  c: Context,
  reason: OauthFailureReason = "generic",
): Response {
  const locale = oauthFailureLocale(c.req.header("Accept-Language"));
  const copy = OAUTH_FAILURE_COPY[locale];
  return new Response(
    `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${copy.title}</title><body><main><h1>${copy.heading}</h1><p>${
      copy[reason]
    }</p><p>${copy.guidance}</p></main></body></html>`,
    {
      status: 400,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Language": locale,
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

function expiresSoon(value: unknown, nowMs: number): boolean {
  if (typeof value !== "string") return true;
  const parsed = new Date(value).getTime();
  return !Number.isFinite(parsed) || parsed <= nowMs + 5 * 60 * 1_000;
}

async function googleSession(input: {
  dependencies: MeoAppDependencies;
  repository: MeoRepositoryPort;
  actorId: string;
  storeId: string;
  requireLocation?: boolean;
}): Promise<{ token: GoogleToken; locationName: string | null }> {
  const integration = input.dependencies.google;
  if (!integration) {
    throw appError(
      "GOOGLE_INTEGRATION_UNAVAILABLE",
      "Google連携は現在準備中です。",
      503,
      true,
    );
  }
  const row = await input.repository.connection(
    input.actorId,
    input.storeId,
    "google_business",
  );
  if (!row || row.status !== "active") {
    throw appError(
      "GOOGLE_CONNECTION_REQUIRED",
      "先にGoogleビジネスプロフィールを接続してください。",
      409,
    );
  }
  let token = await decryptExternalCredential<GoogleToken>(
    input.dependencies.credentialCipher,
    input.storeId,
    row,
  );
  if (expiresSoon(token.expiresAt, (input.dependencies.now ?? Date.now)())) {
    token = await integration.client.refresh(token).catch(() => {
      throw appError(
        "GOOGLE_RECONNECT_REQUIRED",
        "Googleとの接続をやり直してください。",
        409,
      );
    });
    await input.repository.updateCredential({
      actorId: input.actorId,
      storeId: input.storeId,
      provider: "google_business",
      encrypted: await encryptExternalCredential(
        input.dependencies.credentialCipher,
        input.storeId,
        "google_business",
        token,
      ),
      expiresAt: token.expiresAt,
    });
  }
  const locationName = typeof row.location_name === "string"
    ? row.location_name
    : null;
  if (
    input.requireLocation &&
    (!locationName || !GOOGLE_LOCATION_PATTERN.test(locationName))
  ) {
    throw appError(
      "GOOGLE_LOCATION_REQUIRED",
      "使用するGoogle店舗を選んでください。",
      409,
    );
  }
  return { token, locationName };
}

async function instagramSession(input: {
  dependencies: MeoAppDependencies;
  repository: MeoRepositoryPort;
  actorId: string;
  storeId: string;
}): Promise<InstagramToken> {
  const integration = input.dependencies.instagram;
  if (!integration) {
    throw appError(
      "INSTAGRAM_INTEGRATION_UNAVAILABLE",
      "Instagram連携は現在準備中です。",
      503,
      true,
    );
  }
  const row = await input.repository.connection(
    input.actorId,
    input.storeId,
    "instagram",
  );
  if (!row || row.status !== "active") {
    throw appError(
      "INSTAGRAM_CONNECTION_REQUIRED",
      "先にInstagramを接続してください。",
      409,
    );
  }
  let token = await decryptExternalCredential<InstagramToken>(
    input.dependencies.credentialCipher,
    input.storeId,
    row,
  );
  if (expiresSoon(token.expiresAt, (input.dependencies.now ?? Date.now)())) {
    token = await integration.client.refresh(token).catch(() => {
      throw appError(
        "INSTAGRAM_RECONNECT_REQUIRED",
        "Instagramとの接続をやり直してください。",
        409,
      );
    });
    await input.repository.updateCredential({
      actorId: input.actorId,
      storeId: input.storeId,
      provider: "instagram",
      encrypted: await encryptExternalCredential(
        input.dependencies.credentialCipher,
        input.storeId,
        "instagram",
        token,
      ),
      expiresAt: token.expiresAt,
    });
  }
  return token;
}

async function externalAction<T extends JsonObject>(input: {
  c: Context<AppEnv>;
  repository: MeoRepositoryPort;
  actorId: string;
  storeId: string;
  action: "review_reply" | "gbp_post";
  logicalBody: unknown;
  execute: (effect: {
    keyHash: string;
    requestHash: string;
  }) => Promise<T>;
}): Promise<Response> {
  const key = requireMutationKey(input.c);
  const hashes = await requestHashes(
    key,
    input.c.req.method,
    input.c.req.path,
    input.logicalBody,
  );
  let claim: JsonObject;
  try {
    claim = await input.repository.claimExternalAction({
      actorId: input.actorId,
      storeId: input.storeId,
      action: input.action,
      keyHash: hashes.keyHash,
      requestHash: hashes.requestHash,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("EXTERNAL_ACTION_IN_PROGRESS")) {
      throw appError(
        "EXTERNAL_ACTION_IN_PROGRESS",
        "同じ内容を送信中です。再送せず、しばらく待ってからGoogle画面をご確認ください。",
        409,
      );
    }
    if (message.includes("EXTERNAL_ACTION_PREVIOUSLY_FAILED")) {
      throw appError(
        "EXTERNAL_ACTION_PREVIOUSLY_FAILED",
        "前回の送信は完了しませんでした。内容を確認してからやり直してください。",
        409,
      );
    }
    if (message.includes("IDEMPOTENCY_PAYLOAD_CONFLICT")) {
      throw appError(
        "IDEMPOTENCY_CONFLICT",
        "同じ操作キーを別の内容には利用できません。",
        409,
      );
    }
    throw error;
  }
  if (claim.outcome_unknown === true) {
    throw appError(
      "EXTERNAL_ACTION_OUTCOME_UNKNOWN",
      "Googleへの送信結果を自動確認できませんでした。重複を防ぐため再送せず、Google画面で状態を確認してください。",
      409,
    );
  }
  if (claim.replayed === true) return success(input.c, claim.result_json as T);
  const operationId = typeof claim.operation_id === "string"
    ? claim.operation_id
    : "";
  if (!UUID_PATTERN.test(operationId)) {
    throw appError("INTERNAL_ERROR", "処理を開始できませんでした。", 500, true);
  }
  const effectKeyHash = await sha256Hex(
    `meo_external_action:${input.action}:${operationId}`,
  );
  let result: T;
  try {
    result = await meteredProviderCall({
      c: input.c,
      repository: input.repository,
      actorId: input.actorId,
      storeId: input.storeId,
      operation: input.action === "review_reply"
        ? "google_review_reply_write"
        : "google_post_write",
      logicalBody: input.logicalBody,
      execute: () =>
        input.execute({
          keyHash: effectKeyHash,
          requestHash: hashes.requestHash,
        }),
    });
  } catch (error) {
    if (
      error instanceof ExternalActionOutcomeUnknown ||
      (error instanceof AppError &&
        error.code === "PROVIDER_RESULT_SETTLEMENT_FAILED")
    ) {
      await input.repository.attentionExternalAction(
        operationId,
        error instanceof ExternalActionOutcomeUnknown
          ? "PROVIDER_OUTCOME_UNKNOWN"
          : "PROVIDER_RESULT_SETTLEMENT_FAILED",
      ).catch(() => undefined);
      throw appError(
        "EXTERNAL_ACTION_OUTCOME_UNKNOWN",
        "Googleへの送信結果を自動確認できませんでした。重複を防ぐため再送せず、Google画面で状態を確認してください。",
        409,
      );
    }
    const code = error instanceof AppError
      ? error.code
      : "EXTERNAL_ACTION_FAILED";
    await input.repository.failExternalAction(operationId, code).catch(() =>
      undefined
    );
    throw error;
  }
  try {
    await input.repository.completeExternalAction(operationId, result);
  } catch {
    await input.repository.attentionExternalAction(
      operationId,
      "RECEIPT_PERSIST_FAILED",
    ).catch(() => undefined);
    throw appError(
      "EXTERNAL_ACTION_RECEIPT_FAILED",
      "Google上の送信は確認できましたが、実行記録を保存できませんでした。再送せず、管理者へお問い合わせください。",
      500,
      true,
    );
  }
  return success(input.c, result);
}

function providerWriteOutcomeIsUnknown(error: unknown): boolean {
  const status = (error as { httpStatus?: unknown } | null)?.httpStatus;
  return typeof status !== "number" || status >= 500;
}

function healthInput(body: JsonObject): HealthMetrics {
  const rate =
    body.reviewReplyRate === null || body.reviewReplyRate === undefined
      ? null
      : Number(body.reviewReplyRate);
  if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 1)) {
    throw appError("INVALID_HEALTH_METRICS", "返信率を確認してください。", 400);
  }
  return {
    hasBusinessDescription: bool(
      body.hasBusinessDescription,
      "INVALID_HEALTH_METRICS",
    ),
    hasWebsite: bool(body.hasWebsite, "INVALID_HEALTH_METRICS"),
    hasBusinessHours: bool(body.hasBusinessHours, "INVALID_HEALTH_METRICS"),
    hasPhoneNumber: bool(body.hasPhoneNumber, "INVALID_HEALTH_METRICS"),
    hasPrimaryCategory: bool(body.hasPrimaryCategory, "INVALID_HEALTH_METRICS"),
    photoCount: count(body.photoCount, "INVALID_HEALTH_METRICS"),
    videoCount: count(body.videoCount, "INVALID_HEALTH_METRICS"),
    daysSinceLastMedia: nullableCount(
      body.daysSinceLastMedia,
      "INVALID_HEALTH_METRICS",
    ),
    postCount: body.postCount === undefined
      ? body.daysSinceLastPost === null || body.daysSinceLastPost === undefined
        ? null
        : 1
      : nullableCount(body.postCount, "INVALID_HEALTH_METRICS"),
    daysSinceLastPost: nullableCount(
      body.daysSinceLastPost,
      "INVALID_HEALTH_METRICS",
    ),
    reviewReplyRate: rate,
    recentReviewCount: nullableCount(
      body.recentReviewCount,
      "INVALID_HEALTH_METRICS",
    ),
  };
}

function daysSinceLatestTimestamp(
  values: ReadonlyArray<string | null>,
  nowMs: number,
): number | null {
  const latest = values.reduce<number | null>((current, value) => {
    if (!value) return current;
    const parsed = new Date(value).getTime();
    if (!Number.isFinite(parsed) || parsed > nowMs + 5 * 60 * 1_000) {
      return current;
    }
    return current === null || parsed > current ? parsed : current;
  }, null);
  return latest === null
    ? null
    : Math.max(0, Math.floor((nowMs - latest) / 86_400_000));
}
function performanceInput(body: JsonObject): PerformanceMetrics {
  return {
    searches: count(body.searches, "INVALID_PERFORMANCE_METRICS"),
    views: count(body.views, "INVALID_PERFORMANCE_METRICS"),
    websiteClicks: count(body.websiteClicks, "INVALID_PERFORMANCE_METRICS"),
    calls: count(body.calls, "INVALID_PERFORMANCE_METRICS"),
    directionRequests: count(
      body.directionRequests,
      "INVALID_PERFORMANCE_METRICS",
    ),
  };
}

function performanceTotals(value: JsonObject): PerformanceMetrics {
  const totals: Record<string, number> = {};
  const series = Array.isArray(value.multiDailyMetricTimeSeries)
    ? value.multiDailyMetricTimeSeries
    : [];
  for (const raw of series) {
    if (raw === null || Array.isArray(raw) || typeof raw !== "object") continue;
    const row = raw as JsonObject;
    if (typeof row.dailyMetric !== "string") continue;
    const timeSeries = row.timeSeries && typeof row.timeSeries === "object" &&
        !Array.isArray(row.timeSeries)
      ? row.timeSeries as JsonObject
      : {};
    const values = Array.isArray(timeSeries.datedValues)
      ? timeSeries.datedValues
      : [];
    totals[row.dailyMetric] = values.reduce((sum: number, rawValue) => {
      if (
        rawValue === null || Array.isArray(rawValue) ||
        typeof rawValue !== "object"
      ) return sum;
      const metricValue = (rawValue as JsonObject).value;
      return sum +
        (typeof metricValue === "number" && Number.isFinite(metricValue)
          ? metricValue
          : 0);
    }, 0);
  }
  return {
    searches: Math.round(
      (totals.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH ?? 0) +
        (totals.BUSINESS_IMPRESSIONS_MOBILE_SEARCH ?? 0),
    ),
    views: Math.round(
      (totals.BUSINESS_IMPRESSIONS_DESKTOP_MAPS ?? 0) +
        (totals.BUSINESS_IMPRESSIONS_MOBILE_MAPS ?? 0),
    ),
    websiteClicks: Math.round(totals.WEBSITE_CLICKS ?? 0),
    calls: Math.round(totals.CALL_CLICKS ?? 0),
    directionRequests: Math.round(totals.BUSINESS_DIRECTION_REQUESTS ?? 0),
  };
}

export function createMeoApp(dependencies: MeoAppDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const now = dependencies.now ?? Date.now;
  configureHttp(app, dependencies.allowedOrigins);
  app.use("/meo-api/oauth/*", dependencies.callbackAuthMiddleware);
  app.use("/meo-api/v1/*", dependencies.authMiddleware);

  app.get("/meo-api/v1/stores/:storeId/connections", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const rows = await dependencies.repository(c).connections(
      actor,
      storeId(c),
    );
    return success(c, rows.map(safeConnection));
  });

  app.get("/meo-api/v1/stores/:storeId/external-writes", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const settings = await dependencies.repository(c).externalWriteSettings(
      actor,
      storeId(c),
    );
    return success(
      c,
      {
        enabled: settings.enabled === true,
        canManage: settings.can_manage === true,
        canExecute: settings.can_execute === true,
      },
    );
  });

  app.patch("/meo-api/v1/stores/:storeId/external-writes", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    requireMutationKey(c);
    const body = await readJsonObject(c, 1_024);
    const enabled = bool(body.enabled, "INVALID_EXTERNAL_WRITE_SETTING");
    const settings = await dependencies.repository(c).setExternalWrites({
      actorId: actor,
      storeId: selectedStoreId,
      enabled,
    });
    return success(c, {
      enabled: settings.enabled === true,
      canManage: settings.can_manage === true,
      canExecute: settings.can_execute === true,
    });
  });

  app.post(
    "/meo-api/v1/stores/:storeId/connections/:provider/start",
    async (c) => {
      const actor = ownerId(c.var.supabaseContext);
      const selectedStoreId = storeId(c);
      requireMutationKey(c);
      const selectedProvider = provider(c.req.param("provider"));
      if (selectedProvider === "dataforseo") {
        throw appError(
          "INVALID_CONNECTION_FLOW",
          "順位計測サービスはログイン情報を入力して接続してください。",
          400,
        );
      }
      const repository = dependencies.repository(c);
      await requireConnectionFeature(
        repository,
        actor,
        selectedStoreId,
        selectedProvider,
      );
      const body = await readJsonObject(c, 1_024);
      const challenge = requireString(body.challenge, {
        code: "INVALID_OAUTH_BROWSER_CHALLENGE",
        message:
          "接続を開始できませんでした。画面を更新してもう一度お試しください。",
        min: 43,
        max: 43,
        pattern: OAUTH_CHALLENGE_PATTERN,
      });
      if (Object.keys(body).some((key) => key !== "challenge")) {
        throw appError(
          "INVALID_OAUTH_BROWSER_CHALLENGE",
          "接続を開始できませんでした。画面を更新してもう一度お試しください。",
          400,
        );
      }
      if (selectedProvider === "google_business" && !dependencies.google) {
        throw appError(
          "GOOGLE_INTEGRATION_UNAVAILABLE",
          "Google連携は現在準備中です。",
          503,
          true,
        );
      }
      if (selectedProvider === "instagram" && !dependencies.instagram) {
        throw appError(
          "INSTAGRAM_INTEGRATION_UNAVAILABLE",
          "Instagram連携は現在準備中です。",
          503,
          true,
        );
      }
      const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
      const stateHash = await sha256(state);
      const returnPath = `/dashboard/stores/${selectedStoreId}/connections`;
      await meteredProviderCall({
        c,
        repository,
        actorId: actor,
        storeId: selectedStoreId,
        operation: selectedProvider === "google_business"
          ? "google_oauth_start"
          : "instagram_oauth_start",
        logicalBody: { provider: selectedProvider },
        execute: () =>
          repository.createOauthState({
            actorId: actor,
            storeId: selectedStoreId,
            provider: selectedProvider,
            stateHash,
            browserChallenge: challenge,
            returnPath,
            expiresAt: new Date(now() + 10 * 60 * 1_000).toISOString(),
          }),
      });
      if (selectedProvider === "google_business") {
        return success(c, {
          authorizationUrl: googleAuthorizationUrl({
            clientId: dependencies.google!.clientId,
            redirectUri: dependencies.google!.redirectUri,
            state,
            codeChallenge: challenge,
          }),
        });
      }
      return success(c, {
        authorizationUrl: instagramAuthorizationUrl({
          appId: dependencies.instagram!.appId,
          redirectUri: dependencies.instagram!.redirectUri,
          state,
        }),
      });
    },
  );

  app.post("/meo-api/v1/stores/:storeId/connections/dataforseo", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    const repository = dependencies.repository(c);
    await requireFeature(repository, actor, selectedStoreId, "meo_rank");
    requireMutationKey(c);
    if (!dependencies.dataForSeoFactory) {
      throw appError(
        "OWNER_RANK_PROVIDER_UNAVAILABLE",
        "順位計測サービスの接続は現在準備中です。",
        503,
        true,
      );
    }
    const body = await readJsonObject(c, 4_096);
    const credential: DataForSeoCredential = {
      login: requireString(body.login, {
        code: "INVALID_DATAFORSEO_LOGIN",
        message: "DataForSEOのログインを確認してください。",
        min: 3,
        max: 320,
      }),
      password: requireString(body.password, {
        code: "INVALID_DATAFORSEO_PASSWORD",
        message: "DataForSEOのパスワードを確認してください。",
        min: 8,
        max: 1_024,
      }),
    };
    await meteredProviderCall({
      c,
      repository,
      actorId: actor,
      storeId: selectedStoreId,
      operation: "dataforseo_credential_validate",
      credentialSource: "owner_provider",
      logicalBody: { loginHash: await sha256(credential.login) },
      execute: () =>
        dependencies.dataForSeoFactory!(credential).validate().catch(() => {
          throw appError(
            "DATAFORSEO_CREDENTIAL_INVALID",
            "DataForSEOへ接続できませんでした。",
            400,
          );
        }),
    });
    const saved = await repository.saveConnection({
      actorId: actor,
      storeId: selectedStoreId,
      provider: "dataforseo",
      encrypted: await encryptExternalCredential(
        dependencies.credentialCipher,
        selectedStoreId,
        "dataforseo",
        credential,
      ),
      expiresAt: null,
      externalAccountId: null,
      locationName: null,
      displayName: "DataForSEO",
    });
    return success(c, safeConnection(saved));
  });

  app.get("/meo-api/oauth/:provider/callback", async (c) => {
    const rawProvider = c.req.param("provider");
    const selectedProvider = rawProvider === "google"
      ? "google_business"
      : rawProvider;
    if (
      selectedProvider !== "google_business" && selectedProvider !== "instagram"
    ) {
      return oauthFailure(c);
    }
    const state = c.req.query("state");
    if (!state || !OAUTH_STATE_PATTERN.test(state)) return oauthFailure(c);
    const repository = dependencies.repository(c);
    let prepared: JsonObject;
    try {
      prepared = await repository.prepareOauthCallback({
        provider: selectedProvider,
        stateHash: await sha256(state),
      });
    } catch {
      return oauthFailure(c, "expired");
    }
    const selectedStoreId = typeof prepared.store_id === "string"
      ? prepared.store_id
      : "";
    const returnPath = typeof prepared.return_path === "string"
      ? prepared.return_path
      : "";
    if (
      !UUID_PATTERN.test(selectedStoreId) ||
      returnPath !== `/dashboard/stores/${selectedStoreId}/connections`
    ) {
      return oauthFailure(c);
    }
    if (c.req.query("error")) {
      return appRedirect(dependencies.appOrigin, returnPath, "cancelled");
    }
    const code = c.req.query("code");
    if (!code || code.length > 2_048) return oauthFailure(c);
    return appFragmentRedirect(
      dependencies.appOrigin,
      returnPath,
      { connection: "oauth_callback", provider: selectedProvider, state, code },
    );
  });

  app.post(
    "/meo-api/v1/stores/:storeId/connections/:provider/complete",
    async (c) => {
      const actor = ownerId(c.var.supabaseContext);
      const selectedStoreId = storeId(c);
      requireMutationKey(c);
      const selectedProvider = provider(c.req.param("provider"));
      if (selectedProvider === "dataforseo") {
        throw appError(
          "INVALID_CONNECTION_FLOW",
          "この接続方法は利用できません。",
          400,
        );
      }
      const repository = dependencies.repository(c);
      await requireConnectionFeature(
        repository,
        actor,
        selectedStoreId,
        selectedProvider,
      );
      if (selectedProvider === "google_business" && !dependencies.google) {
        throw appError(
          "GOOGLE_INTEGRATION_UNAVAILABLE",
          "Google連携は現在準備中です。",
          503,
          true,
        );
      }
      if (selectedProvider === "instagram" && !dependencies.instagram) {
        throw appError(
          "INSTAGRAM_INTEGRATION_UNAVAILABLE",
          "Instagram連携は現在準備中です。",
          503,
          true,
        );
      }
      const body = await readJsonObject(c, 4_096);
      if (
        Object.keys(body).some((key) =>
          key !== "state" && key !== "code" && key !== "verifier"
        )
      ) {
        throw appError(
          "INVALID_OAUTH_COMPLETION",
          "接続情報を確認できませんでした。もう一度接続してください。",
          400,
        );
      }
      const state = requireString(body.state, {
        code: "INVALID_OAUTH_COMPLETION",
        message: "接続情報を確認できませんでした。もう一度接続してください。",
        min: 43,
        max: 43,
        pattern: OAUTH_STATE_PATTERN,
      });
      const code = requireString(body.code, {
        code: "INVALID_OAUTH_COMPLETION",
        message: "接続情報を確認できませんでした。もう一度接続してください。",
        min: 1,
        max: 2_048,
      });
      const verifier = requireString(body.verifier, {
        code: "INVALID_OAUTH_COMPLETION",
        message:
          "この接続を開始したブラウザを確認できませんでした。最初からやり直してください。",
        min: 43,
        max: 128,
        pattern: OAUTH_VERIFIER_PATTERN,
      });
      try {
        return success(
          c,
          await meteredProviderCall({
            c,
            repository,
            actorId: actor,
            storeId: selectedStoreId,
            operation: selectedProvider === "google_business"
              ? "google_oauth_exchange"
              : "instagram_oauth_exchange",
            logicalBody: {
              provider: selectedProvider,
              stateHash: await sha256(state),
            },
            execute: async () => {
              try {
                await repository.consumeOauthState({
                  actorId: actor,
                  storeId: selectedStoreId,
                  provider: selectedProvider,
                  stateHash: await sha256(state),
                  browserChallenge: await sha256Base64Url(verifier),
                });
              } catch {
                throw appError(
                  "OAUTH_BROWSER_MISMATCH",
                  "この接続を開始したブラウザを確認できませんでした。最初からやり直してください。",
                  409,
                );
              }
              if (selectedProvider === "google_business") {
                const token = await dependencies.google!.client.exchangeCode(
                  code,
                  verifier,
                );
                const locations = await dependencies.google!.client.locations(
                  token.accessToken,
                );
                await repository.saveConnection({
                  actorId: actor,
                  storeId: selectedStoreId,
                  provider: "google_business",
                  encrypted: await encryptExternalCredential(
                    dependencies.credentialCipher,
                    selectedStoreId,
                    "google_business",
                    token,
                  ),
                  expiresAt: token.expiresAt,
                  externalAccountId: locations.length === 1
                    ? locations[0]?.accountName ?? null
                    : null,
                  locationName: null,
                  displayName: null,
                });
                // Even one returned location must be selected explicitly. The
                // UI shows its title and address so the staging operator can
                // stop before binding a merchant profile by mistake.
                return { connected: true, selectLocation: true };
              }
              const token = await dependencies.instagram!.client.exchangeCode(
                code,
              );
              await repository.saveConnection({
                actorId: actor,
                storeId: selectedStoreId,
                provider: "instagram",
                encrypted: await encryptExternalCredential(
                  dependencies.credentialCipher,
                  selectedStoreId,
                  "instagram",
                  token,
                ),
                expiresAt: token.expiresAt,
                externalAccountId: token.instagramUserId,
                locationName: null,
                displayName: null,
              });
              return { connected: true, selectLocation: false };
            },
          }),
        );
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw appError(
          "OAUTH_CONNECTION_FAILED",
          "外部サービスとの接続を完了できませんでした。もう一度お試しください。",
          502,
          true,
        );
      }
    },
  );

  app.get(
    "/meo-api/v1/stores/:storeId/connections/google_business/locations",
    async (c) => {
      const actor = ownerId(c.var.supabaseContext);
      const selectedStoreId = storeId(c);
      const repository = dependencies.repository(c);
      await requireConnectionFeature(
        repository,
        actor,
        selectedStoreId,
        "google_business",
      );
      return success(
        c,
        await meteredProviderCall({
          c,
          repository,
          actorId: actor,
          storeId: selectedStoreId,
          operation: "google_locations_list",
          execute: async () => {
            const session = await googleSession({
              dependencies,
              repository,
              actorId: actor,
              storeId: selectedStoreId,
            });
            return await dependencies.google!.client.locations(
              session.token.accessToken,
            );
          },
        }),
      );
    },
  );

  app.patch(
    "/meo-api/v1/stores/:storeId/connections/google_business/location",
    async (c) => {
      const actor = ownerId(c.var.supabaseContext);
      const selectedStoreId = storeId(c);
      const repository = dependencies.repository(c);
      requireMutationKey(c);
      await requireConnectionFeature(
        repository,
        actor,
        selectedStoreId,
        "google_business",
      );
      const body = await readJsonObject(c, 4_096);
      const locationName = requireString(body.locationName, {
        code: "INVALID_GOOGLE_LOCATION",
        message: "Google店舗を確認してください。",
        min: 10,
        max: 500,
        pattern: GOOGLE_LOCATION_PATTERN,
      });
      const locations = await meteredProviderCall({
        c,
        repository,
        actorId: actor,
        storeId: selectedStoreId,
        operation: "google_locations_list",
        logicalBody: { locationName },
        execute: async () => {
          const session = await googleSession({
            dependencies,
            repository,
            actorId: actor,
            storeId: selectedStoreId,
          });
          return await dependencies.google!.client.locations(
            session.token.accessToken,
          );
        },
      });
      const selected = locations.find((location) =>
        location.name === locationName
      );
      if (!selected) {
        throw appError(
          "GOOGLE_LOCATION_NOT_ALLOWED",
          "選択できないGoogle店舗です。",
          403,
        );
      }
      return success(
        c,
        safeConnection(
          await repository.selectGoogleLocation(
            actor,
            selectedStoreId,
            selected.name,
            selected.title,
          ),
        ),
      );
    },
  );

  app.delete("/meo-api/v1/stores/:storeId/connections/:provider", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    requireMutationKey(c);
    await dependencies.repository(c).deleteConnection(
      actor,
      storeId(c),
      provider(c.req.param("provider")),
    );
    return success(c, { disconnected: true });
  });

  app.post("/meo-api/v1/stores/:storeId/review-replies/draft", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    const repository = dependencies.repository(c);
    const feature = await requireFeature(
      repository,
      actor,
      selectedStoreId,
      "review_reply",
    );
    const executionMode = featureExecutionMode(feature);
    const body = await readJsonObject(c, 16_384);
    const rating = count(body.rating, "INVALID_REVIEW_RATING");
    const tone = body.tone === undefined ? "polite" : body.tone;
    const locale = body.locale === undefined ? "ja" : body.locale;
    if (locale !== "ja" && locale !== "en") {
      throw appError("INVALID_REVIEW_REPLY_LOCALE", "Invalid locale.", 400);
    }
    if (tone !== "polite" && tone !== "warm" && tone !== "short") {
      throw appError(
        "INVALID_REVIEW_REPLY_TONE",
        "返信の雰囲気を確認してください。",
        400,
      );
    }
    const reviewComment = optionalString(body.reviewComment, 2_000);
    const reviewerName = optionalString(body.reviewerName, 80);
    const storeName = optionalString(body.storeName, 120);
    const generationMode = body.generationMode === undefined
      ? "template"
      : body.generationMode;
    if (
      generationMode !== "template" && generationMode !== "owner_provider"
    ) {
      throw appError(
        "INVALID_REVIEW_REPLY_MODE",
        "返信案の作り方を確認してください。",
        400,
      );
    }
    let template: ReturnType<typeof createReviewReplyDraft>;
    try {
      template = createReviewReplyDraft({
        rating,
        reviewComment,
        reviewerName,
        storeName,
        tone: tone as ReviewReplyTone,
        locale,
      });
    } catch {
      throw appError(
        "INVALID_REVIEW_RATING",
        "星の数を1〜5で選んでください。",
        400,
      );
    }
    if (executionMode === "native" || generationMode === "template") {
      return success(c, template);
    }

    let ownerCredential: Awaited<
      ReturnType<SupabaseRepository["getActiveConnection"]>
    > = null;
    let ownerApiKey = "";
    if (!dependencies.ownerAiRepository) return success(c, template);
    ownerCredential = await dependencies.ownerAiRepository(c)
      .getActiveConnection(selectedStoreId);
    if (!ownerCredential) return success(c, template);
    try {
      ownerApiKey = await dependencies.credentialCipher.decrypt(
        ownerCredential,
        ownerCredential.storeId,
        ownerCredential.provider,
      );
    } catch {
      return success(c, template);
    }

    const key = requireMutationKey(c);
    const hashes = await requestHashes(key, c.req.method, c.req.path, body);
    const reservation = await repository.reserveAiDraft({
      actorId: actor,
      storeId: selectedStoreId,
      keyHash: hashes.keyHash,
      requestHash: hashes.requestHash,
      credentialSource: executionMode,
      dailyStoreLimit: dependencies.aiDraftStoreDailyLimit ?? 20,
      dailyGlobalLimit: dependencies.aiDraftGlobalDailyLimit ?? 500,
    });
    if (
      reservation.replayed === true && reservation.result_json !== null &&
      typeof reservation.result_json === "object" &&
      !Array.isArray(reservation.result_json)
    ) {
      return success(c, reservation.result_json);
    }
    if (reservation.authorized !== true || reservation.replayed === true) {
      return success(c, template);
    }
    const reservationId = typeof reservation.reservation_id === "string"
      ? reservation.reservation_id
      : "";
    if (!UUID_PATTERN.test(reservationId)) {
      throw appError(
        "INTERNAL_ERROR",
        "返信案を作成できませんでした。",
        500,
        true,
      );
    }
    const draftInput: ReviewReplyDraftInput = {
      locale,
      rating,
      reviewComment: reviewComment ?? "",
      storeName: storeName ?? (locale === "ja" ? "店舗" : ""),
      industry: null,
      tone: tone === "short" ? "concise" as const : tone,
    };
    const failureProvider = ownerCredential.provider;
    const failureModel = ownerCredential.model;
    let generated: {
      draft: string;
      provider: string;
      model: string;
      inputTokens: number | null;
      outputTokens: number | null;
    };
    try {
      const ownerResult =
        await (dependencies.providerFactory ?? defaultProviderFactory)(
          ownerCredential.provider,
          ownerApiKey,
          ownerCredential.model,
        ).draftReviewReply({
          draft: draftInput,
          model: ownerCredential.model,
          requestId: reservationId,
        });
      generated = { ...ownerResult, draft: ownerResult.text };
    } catch (error) {
      const code = error instanceof AppError
        ? error.code
        : "AI_PROVIDER_UNAVAILABLE";
      await repository.settleAiDraft({
        reservationId,
        outcome: "failed",
        credentialSource: executionMode,
        provider: failureProvider,
        model: failureModel,
        safeErrorCode: code,
        result: null,
      });
      return success(c, template);
    }
    const result = {
      reply: generated.draft,
      source: "owner_provider" as const,
      requiresReview: true as const,
    };
    await repository.settleAiDraft({
      reservationId,
      outcome: "success",
      credentialSource: executionMode,
      provider: generated.provider,
      model: generated.model,
      safeErrorCode: null,
      result,
    });
    return success(c, result);
  });

  app.get("/meo-api/v1/stores/:storeId/reviews", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    const repository = dependencies.repository(c);
    await requireFeature(repository, actor, selectedStoreId, "review_reply");
    return success(
      c,
      await meteredProviderCall({
        c,
        repository,
        actorId: actor,
        storeId: selectedStoreId,
        operation: "google_reviews_list",
        execute: async () => {
          const session = await googleSession({
            dependencies,
            repository,
            actorId: actor,
            storeId: selectedStoreId,
            requireLocation: true,
          });
          return (await dependencies.google!.client.reviews(
            session.token.accessToken,
            session.locationName!,
          )).reviews;
        },
      }),
    );
  });

  app.post("/meo-api/v1/stores/:storeId/reviews/reply", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    const repository = dependencies.repository(c);
    await requireFeature(repository, actor, selectedStoreId, "review_reply");
    const body = await readJsonObject(c, 16_384);
    if (body.confirmed !== true) {
      throw appError(
        "PUBLISH_CONFIRMATION_REQUIRED",
        "内容を確認してから送信してください。",
        409,
      );
    }
    const reviewName = requireString(body.reviewName, {
      code: "INVALID_GOOGLE_REVIEW",
      message: "口コミを確認してください。",
      min: 20,
      max: 500,
    });
    const comment = requireString(body.comment, {
      code: "INVALID_REVIEW_REPLY",
      message: "返信文を入力してください。",
      min: 1,
      max: 4_096,
    }).trim();
    if (comment.length === 0) {
      throw appError("INVALID_REVIEW_REPLY", "返信文を入力してください。", 400);
    }
    return await externalAction({
      c,
      repository,
      actorId: actor,
      storeId: selectedStoreId,
      action: "review_reply",
      logicalBody: { reviewName, comment, confirmed: true },
      execute: async () => {
        const session = await googleSession({
          dependencies,
          repository,
          actorId: actor,
          storeId: selectedStoreId,
          requireLocation: true,
        });
        if (
          !GOOGLE_REVIEW_PATTERN.test(reviewName) ||
          !reviewName.startsWith(`${session.locationName!}/reviews/`)
        ) {
          throw appError(
            "INVALID_GOOGLE_REVIEW",
            "この店舗の口コミを選び直してください。",
            400,
          );
        }
        let writeReturned = false;
        try {
          await dependencies.google!.client.reply(
            session.token.accessToken,
            session.locationName!,
            reviewName,
            comment,
          );
          writeReturned = true;
          const readback = await dependencies.google!.client.review(
            session.token.accessToken,
            session.locationName!,
            reviewName,
          );
          if (
            readback.name !== reviewName ||
            readback.replyComment?.trim() !== comment
          ) {
            throw new ExternalActionOutcomeUnknown();
          }
          return {
            sent: true,
            providerResourceName: readback.name,
            sentAt: readback.replyUpdateTime ?? new Date(now()).toISOString(),
            readBackAt: new Date(now()).toISOString(),
          };
        } catch (error) {
          if (
            error instanceof ExternalActionOutcomeUnknown || writeReturned ||
            providerWriteOutcomeIsUnknown(error)
          ) {
            throw new ExternalActionOutcomeUnknown();
          }
          throw error;
        }
      },
    });
  });

  app.get("/meo-api/v1/stores/:storeId/rank", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    const repository = dependencies.repository(c);
    await requireFeature(repository, actor, selectedStoreId, "meo_rank");
    return success(c, await repository.rankHistory(actor, selectedStoreId));
  });

  app.post("/meo-api/v1/stores/:storeId/rank/manual", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    const repository = dependencies.repository(c);
    await requireFeature(repository, actor, selectedStoreId, "meo_rank");
    requireMutationKey(c);
    const body = await readJsonObject(c, 8_192);
    const keyword = requireString(body.keyword, {
      code: "INVALID_RANK_KEYWORD",
      message: "検索キーワードを入力してください。",
      min: 1,
      max: 120,
    });
    const targetPlaceId = requireString(body.targetPlaceId, {
      code: "INVALID_PLACE_ID",
      message: "Place IDを確認してください。",
      min: 10,
      max: 255,
      pattern: PLACE_ID_PATTERN,
    });
    const position = body.position === null
      ? null
      : count(body.position, "INVALID_RANK_POSITION");
    if (position !== null && (position < 1 || position > 100)) {
      throw appError(
        "INVALID_RANK_POSITION",
        "順位を1〜100で入力してください。",
        400,
      );
    }
    let observedAt = new Date(now()).toISOString();
    if (typeof body.observedAt === "string") {
      const parsed = new Date(body.observedAt);
      if (Number.isNaN(parsed.getTime())) {
        throw appError(
          "INVALID_RANK_OBSERVED_AT",
          "確認した日時を確認してください。",
          400,
        );
      }
      observedAt = parsed.toISOString();
    }
    return success(
      c,
      await repository.saveManualRank({
        actorId: actor,
        storeId: selectedStoreId,
        keyword,
        targetPlaceId,
        position,
        observedAt,
      }),
    );
  });

  app.post("/meo-api/v1/stores/:storeId/rank/measure", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    const repository = dependencies.repository(c);
    const feature = await requireFeature(
      repository,
      actor,
      selectedStoreId,
      "meo_rank",
    );
    const executionMode = featureExecutionMode(feature);
    const body = await readJsonObject(c, 8_192);
    const keyword = requireString(body.keyword, {
      code: "INVALID_RANK_KEYWORD",
      message: "検索キーワードを入力してください。",
      min: 1,
      max: 120,
    });
    const targetPlaceId = requireString(body.targetPlaceId, {
      code: "INVALID_PLACE_ID",
      message: "Place IDを確認してください。",
      min: 10,
      max: 255,
      pattern: PLACE_ID_PATTERN,
    });
    const competitorPlaceIds = body.competitorPlaceIds === undefined
      ? []
      : Array.isArray(body.competitorPlaceIds)
      ? body.competitorPlaceIds
      : null;
    if (
      competitorPlaceIds === null || competitorPlaceIds.length > 3 ||
      competitorPlaceIds.some((value) =>
        typeof value !== "string" || !PLACE_ID_PATTERN.test(value)
      ) || new Set(competitorPlaceIds).size !== competitorPlaceIds.length ||
      competitorPlaceIds.includes(targetPlaceId)
    ) {
      throw appError(
        "INVALID_COMPETITOR_PLACE_IDS",
        "競合店のPlace IDを3件以内で確認してください。",
        400,
      );
    }
    const latitude = typeof body.latitude === "number"
      ? body.latitude
      : Number.NaN;
    const longitude = typeof body.longitude === "number"
      ? body.longitude
      : Number.NaN;
    const zoom = body.zoom === undefined
      ? 15
      : count(body.zoom, "INVALID_RANK_LOCATION");
    if (
      !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      zoom < 3 || zoom > 21
    ) {
      throw appError(
        "INVALID_RANK_LOCATION",
        "計測地点を確認してください。",
        400,
      );
    }
    if (executionMode === "native") {
      throw appError(
        "AUTOMATIC_RANK_DISABLED",
        "現在は手動チェックを利用できます。自動計測は公開設定に含まれていません。",
        409,
      );
    }
    if (
      body.credentialSource !== undefined &&
      body.credentialSource !== executionMode
    ) {
      throw appError(
        "FEATURE_EXECUTION_MODE_MISMATCH",
        "現在の公開方法と異なる利用枠は選べません。画面を再読み込みしてください。",
        409,
      );
    }
    const credentialSource = "owner_provider" as const;
    if (!dependencies.dataForSeoFactory) {
      throw appError(
        "OWNER_RANK_PROVIDER_UNAVAILABLE",
        "順位計測サービスを接続できません。",
        503,
        true,
      );
    }
    const connection = await repository.connection(
      actor,
      selectedStoreId,
      "dataforseo",
    );
    if (!connection || connection.status !== "active") {
      throw appError(
        "DATAFORSEO_CONNECTION_REQUIRED",
        "先にDataForSEOを接続してください。",
        409,
      );
    }
    const credential = await decryptExternalCredential<DataForSeoCredential>(
      dependencies.credentialCipher,
      selectedStoreId,
      connection,
    );
    const rankClient = dependencies.dataForSeoFactory(credential);
    const key = requireMutationKey(c);
    const hashes = await requestHashes(key, c.req.method, c.req.path, body);
    const reservation = await repository.reserveRankMeasurement({
      actorId: actor,
      storeId: selectedStoreId,
      keyHash: hashes.keyHash,
      requestHash: hashes.requestHash,
      storeDailyLimit: dependencies.rankStoreDailyLimit ?? 1,
      globalDailyLimit: dependencies.rankGlobalDailyPointLimit ?? 1_000,
      keyword,
      targetPlaceId,
      competitorPlaceIds,
      credentialSource,
    });
    if (reservation.authorized !== true) {
      throw appError(
        "RANK_DAILY_LIMIT_REACHED",
        "本日の自動計測上限に達しました。明日もう一度お試しください。",
        429,
      );
    }
    const jobId = typeof reservation.job_id === "string"
      ? reservation.job_id
      : "";
    if (!UUID_PATTERN.test(jobId)) {
      throw appError("INTERNAL_ERROR", "計測を開始できませんでした。", 500);
    }
    if (reservation.dispatch_authorized !== true) {
      if (reservation.status === "completed") {
        return success(c, reservation.result_json);
      }
      if (
        reservation.status === "failed" ||
        reservation.status === "attention_required" ||
        reservation.status === "dead_letter"
      ) {
        throw appError(
          "RANK_MEASUREMENT_ATTENTION_REQUIRED",
          "この計測は再送せず、接続状態を確認してください。過去の結果は残っています。",
          409,
        );
      }
      return success(c, {
        jobId,
        status: reservation.status ?? "in_progress",
        queued: true,
        replayed: true,
        previousResultsKept: true,
      });
    }
    try {
      const submitted = await rankClient.submitMapsTask({
        keyword,
        latitude,
        longitude,
        zoom,
        tag: jobId,
      });
      const job = await repository.markRankSubmitted({
        jobId,
        actorId: actor,
        storeId: selectedStoreId,
        providerTaskId: submitted.taskId,
      });
      return success(c, {
        ...job,
        queued: true,
        previousResultsKept: true,
      });
    } catch (error) {
      // Standard Queue submission is never retried automatically after an
      // ambiguous network outcome. An operator/worker must reconcile first.
      await repository.failRankMeasurement(
        jobId,
        "RANK_SUBMISSION_ATTENTION_REQUIRED",
      ).catch(() => undefined);
      throw error;
    }
  });

  app.get("/meo-api/v1/stores/:storeId/insights", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    const repository = dependencies.repository(c);
    await requireFeature(repository, actor, selectedStoreId, "gbp_insights");
    return success(c, await repository.insightHistory(actor, selectedStoreId));
  });

  app.post("/meo-api/v1/stores/:storeId/insights/manual", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    const repository = dependencies.repository(c);
    await requireFeature(repository, actor, selectedStoreId, "gbp_insights");
    requireMutationKey(c);
    const body = await readJsonObject(c, 16_384);
    const current = performanceInput(
      object(body.current, "INVALID_PERFORMANCE_METRICS"),
    );
    const previous = performanceInput(
      object(body.previous, "INVALID_PERFORMANCE_METRICS"),
    );
    const periodStart = date(body.periodStart, "INVALID_INSIGHTS_PERIOD");
    const periodEnd = date(body.periodEnd, "INVALID_INSIGHTS_PERIOD");
    if (periodEnd < periodStart) {
      throw appError(
        "INVALID_INSIGHTS_PERIOD",
        "集計期間を確認してください。",
        400,
      );
    }
    const saved = await repository.saveInsights({
      actorId: actor,
      storeId: selectedStoreId,
      periodStart,
      periodEnd,
      source: "manual",
      metrics: current,
    });
    return success(c, {
      snapshot: saved,
      comparison: comparePerformance(current, previous),
    });
  });

  app.post("/meo-api/v1/stores/:storeId/insights/sync", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    const repository = dependencies.repository(c);
    await requireFeature(repository, actor, selectedStoreId, "gbp_insights");
    requireMutationKey(c);
    const body = await readJsonObject(c, 2_048);
    const periodStart = date(body.periodStart, "INVALID_INSIGHTS_PERIOD");
    const periodEnd = date(body.periodEnd, "INVALID_INSIGHTS_PERIOD");
    const startMs = new Date(`${periodStart}T00:00:00.000Z`).getTime();
    const endMs = new Date(`${periodEnd}T00:00:00.000Z`).getTime();
    if (endMs < startMs || endMs - startMs > 31 * 86_400_000 || endMs > now()) {
      throw appError(
        "INVALID_INSIGHTS_PERIOD",
        "31日以内の過去期間を選んでください。",
        400,
      );
    }
    const raw = await meteredProviderCall({
      c,
      repository,
      actorId: actor,
      storeId: selectedStoreId,
      operation: "google_insights_sync",
      logicalBody: { periodStart, periodEnd },
      execute: async () => {
        const session = await googleSession({
          dependencies,
          repository,
          actorId: actor,
          storeId: selectedStoreId,
          requireLocation: true,
        });
        return await dependencies.google!.client.performance(
          session.token.accessToken,
          session.locationName!,
          periodStart,
          periodEnd,
        );
      },
    });
    const metrics = performanceTotals(raw);
    return success(
      c,
      await repository.saveInsights({
        actorId: actor,
        storeId: selectedStoreId,
        periodStart,
        periodEnd,
        source: "google_business",
        metrics,
      }),
    );
  });

  app.get("/meo-api/v1/stores/:storeId/health/latest", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    const repository = dependencies.repository(c);
    await requireFeature(repository, actor, selectedStoreId, "gbp_health");
    try {
      return success(
        c,
        latestHealthDiagnosis(
          await repository.latestHealthResult(actor, selectedStoreId),
        ),
      );
    } catch (error) {
      const mapped = featureAccessError(error);
      if (mapped) throw mapped;
      throw error;
    }
  });

  app.post("/meo-api/v1/stores/:storeId/health/check", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    const repository = dependencies.repository(c);
    await requireFeature(repository, actor, selectedStoreId, "gbp_health");
    const body = await readJsonObject(c, 16_384);
    if (body.useConnection !== true) {
      const key = requireMutationKey(c);
      const hashes = await requestHashes(key, c.req.method, c.req.path, body);
      const diagnosis = evaluateGbpHealth(healthInput(body));
      try {
        const saved = await repository.saveManualHealthDiagnosis({
          actorId: actor,
          storeId: selectedStoreId,
          keyHash: hashes.keyHash,
          requestHash: hashes.requestHash,
          result: diagnosis as unknown as JsonObject,
        });
        return success(c, completedHealthDiagnosis("manual", saved));
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("IDEMPOTENCY_PAYLOAD_CONFLICT")) {
          throw appError(
            "IDEMPOTENCY_CONFLICT",
            "同じ操作キーを別の内容には利用できません。",
            409,
          );
        }
        const mapped = featureAccessError(error);
        if (mapped) throw mapped;
        throw error;
      }
    }
    const key = requireMutationKey(c);
    const hashes = await requestHashes(key, c.req.method, c.req.path, body);
    const quota = PROVIDER_CALL_QUOTAS.google_health_read;
    let claim: JsonObject;
    try {
      claim = await repository.claimHealthDiagnosis({
        actorId: actor,
        storeId: selectedStoreId,
        keyHash: hashes.keyHash,
        requestHash: hashes.requestHash,
        ...quota,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("IDEMPOTENCY_PAYLOAD_CONFLICT")) {
        throw appError(
          "IDEMPOTENCY_CONFLICT",
          "同じ操作キーを別の内容には利用できません。",
          409,
        );
      }
      const mapped = featureAccessError(error);
      if (mapped) throw mapped;
      throw error;
    }
    const operationId = typeof claim.reservation_id === "string"
      ? claim.reservation_id
      : "";
    if (!UUID_PATTERN.test(operationId)) {
      throw appError(
        "INTERNAL_ERROR",
        "診断を開始できませんでした。",
        500,
        true,
      );
    }
    if (claim.status === "succeeded") {
      return success(c, completedHealthDiagnosis("google_business", claim));
    }
    if (claim.status === "expired") {
      throw appError(
        "HEALTH_DIAGNOSIS_RESULT_EXPIRED",
        "保存期間を過ぎたため前回の診断結果は破棄されました。新しい診断としてやり直してください。",
        410,
      );
    }
    if (claim.status === "processing" && claim.replayed === true) {
      throw appError(
        "HEALTH_DIAGNOSIS_IN_PROGRESS",
        "同じ診断を処理中です。再実行せず、少し待ってから確認してください。",
        409,
        true,
      );
    }
    if (claim.status === "attention_required") {
      throw appError(
        "HEALTH_DIAGNOSIS_ATTENTION_REQUIRED",
        "前回の診断結果を安全に確定できませんでした。再実行せず、管理者へお問い合わせください。",
        409,
      );
    }
    if (claim.status === "failed") {
      throw appError(
        "HEALTH_DIAGNOSIS_PREVIOUSLY_FAILED",
        "前回の診断は完了しませんでした。新しい操作としてやり直してください。",
        409,
      );
    }
    if (claim.authorized !== true) {
      throw appError(
        "PROVIDER_RATE_LIMITED",
        "短時間に操作が集中したため、しばらく待ってからもう一度お試しください。",
        429,
        true,
      );
    }
    if (claim.status !== "processing" || claim.replayed === true) {
      throw appError(
        "HEALTH_DIAGNOSIS_STATE_INVALID",
        "診断の状態を確認できませんでした。",
        503,
        true,
      );
    }

    let providerResult: [
      Record<string, unknown>,
      GoogleReviewPage,
      GoogleMediaPage,
      GoogleLocalPostPage,
    ];
    try {
      const session = await googleSession({
        dependencies,
        repository,
        actorId: actor,
        storeId: selectedStoreId,
        requireLocation: true,
      });
      providerResult = await Promise.all([
        dependencies.google!.client.profile(
          session.token.accessToken,
          session.locationName!,
        ),
        dependencies.google!.client.reviews(
          session.token.accessToken,
          session.locationName!,
        ),
        dependencies.google!.client.media(
          session.token.accessToken,
          session.locationName!,
        ),
        dependencies.google!.client.localPosts(
          session.token.accessToken,
          session.locationName!,
        ),
      ]);
    } catch (error) {
      await repository.settleHealthDiagnosis({
        operationId,
        outcome: error instanceof ExternalActionOutcomeUnknown
          ? "attention_required"
          : "failed",
        safeErrorCode: safeProviderCallError(error),
      }).catch(() => undefined);
      throw error;
    }
    const [profile, reviewPage, mediaPage, localPostPage] = providerResult;
    const nowMs = now();
    const recentCutoff = nowMs - 90 * 86_400_000;
    const replied = reviewPage.reviews.filter((review) =>
      Boolean(review.replyComment)
    ).length;
    const connectedMetrics: HealthMetrics = {
      hasBusinessDescription: hasNonEmptyText(
        (profile.profile as JsonObject | undefined)?.description,
      ),
      hasWebsite: hasNonEmptyText(profile.websiteUri),
      hasBusinessHours: hasBusinessHours(profile.regularHours),
      hasPhoneNumber: hasPhoneNumber(profile.phoneNumbers),
      hasPrimaryCategory: hasPrimaryCategory(
        (profile.categories as JsonObject | undefined)?.primaryCategory,
      ),
      photoCount: mediaPage.complete
        ? mediaPage.mediaItems.filter((item) => item.mediaFormat === "PHOTO")
          .length
        : null,
      videoCount: mediaPage.complete
        ? mediaPage.mediaItems.filter((item) => item.mediaFormat === "VIDEO")
          .length
        : null,
      daysSinceLastMedia: mediaPage.complete
        ? daysSinceLatestTimestamp(
          mediaPage.mediaItems.map((item) => item.createTime),
          nowMs,
        )
        : null,
      postCount: localPostPage.complete ? localPostPage.posts.length : null,
      daysSinceLastPost: localPostPage.complete
        ? daysSinceLatestTimestamp(
          localPostPage.posts.map((post) => post.createTime),
          nowMs,
        )
        : null,
      reviewReplyRate: reviewPage.complete && reviewPage.reviews.length > 0
        ? replied / reviewPage.reviews.length
        : null,
      recentReviewCount: reviewPage.complete
        ? reviewPage.reviews.filter((review) => {
          const created = review.createTime
            ? new Date(review.createTime).getTime()
            : 0;
          return Number.isFinite(created) && created >= recentCutoff;
        }).length
        : null,
    };
    const diagnosis = evaluateGbpHealth(connectedMetrics);
    try {
      const settled = await repository.settleHealthDiagnosis({
        operationId,
        outcome: "success",
        safeErrorCode: null,
        result: diagnosis as unknown as JsonObject,
      });
      return success(
        c,
        completedHealthDiagnosis("google_business", settled),
      );
    } catch {
      // The provider has already returned. The single RPC stores the bounded
      // result and settles the operation atomically; a failure leaves processing to
      // expire into attention_required, never eligible for a same-key rerun.
      throw appError(
        "PROVIDER_RESULT_SETTLEMENT_FAILED",
        "外部サービスの取得結果を記録できませんでした。再実行せず、管理者へお問い合わせください。",
        503,
        true,
      );
    }
  });

  app.post("/meo-api/v1/stores/:storeId/instagram/draft", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    const repository = dependencies.repository(c);
    await requireFeature(
      repository,
      actor,
      selectedStoreId,
      "instagram_to_gbp",
    );
    const body = await readJsonObject(c, 16_384);
    const excluded = Array.isArray(body.excludedHashtags)
      ? body.excludedHashtags.filter((item): item is string =>
        typeof item === "string"
      ).slice(0, 20)
      : [];
    try {
      return success(
        c,
        createGbpPostDraft({
          caption: requireString(body.caption, {
            code: "EMPTY_INSTAGRAM_CAPTION",
            message: "Instagramの文章を入力してください。",
            min: 1,
            max: 10_000,
          }),
          excludedHashtags: excluded,
        }),
      );
    } catch {
      throw appError(
        "INVALID_INSTAGRAM_CAPTION",
        "投稿文を確認してください。",
        400,
      );
    }
  });

  app.get("/meo-api/v1/stores/:storeId/instagram/media", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    const repository = dependencies.repository(c);
    await requireFeature(
      repository,
      actor,
      selectedStoreId,
      "instagram_to_gbp",
    );
    return success(
      c,
      await meteredProviderCall({
        c,
        repository,
        actorId: actor,
        storeId: selectedStoreId,
        operation: "instagram_media_list",
        execute: async () => {
          const token = await instagramSession({
            dependencies,
            repository,
            actorId: actor,
            storeId: selectedStoreId,
          });
          return await dependencies.instagram!.client.media(token);
        },
      }),
    );
  });

  app.post("/meo-api/v1/stores/:storeId/instagram/publish", async (c) => {
    const actor = ownerId(c.var.supabaseContext);
    const selectedStoreId = storeId(c);
    const repository = dependencies.repository(c);
    await requireFeature(
      repository,
      actor,
      selectedStoreId,
      "instagram_to_gbp",
    );
    const body = await readJsonObject(c, 16_384);
    if (body.confirmed !== true) {
      throw appError(
        "PUBLISH_CONFIRMATION_REQUIRED",
        "Googleへ投稿する内容を確認してください。",
        409,
      );
    }
    const summary = requireString(body.summary, {
      code: "INVALID_GBP_POST",
      message: "投稿文を入力してください。",
      min: 1,
      max: 1_500,
    });
    let imageUrl = optionalString(body.imageUrl, 2_048);
    if (imageUrl) {
      try {
        const parsed = new URL(imageUrl);
        if (
          parsed.protocol !== "https:" || parsed.username || parsed.password ||
          parsed.port || parsed.hash
        ) throw new Error();
        imageUrl = parsed.toString();
      } catch {
        throw appError(
          "INVALID_GBP_POST_IMAGE",
          "画像URLを確認してください。",
          400,
        );
      }
    }
    return await externalAction({
      c,
      repository,
      actorId: actor,
      storeId: selectedStoreId,
      action: "gbp_post",
      logicalBody: { summary, imageUrl, confirmed: true },
      execute: async () => {
        const session = await googleSession({
          dependencies,
          repository,
          actorId: actor,
          storeId: selectedStoreId,
          requireLocation: true,
        });
        let writeReturned = false;
        try {
          const created = await dependencies.google!.client.createLocalPost(
            session.token.accessToken,
            session.locationName!,
            { summary, imageUrl },
          );
          writeReturned = true;
          if (
            !GOOGLE_LOCAL_POST_PATTERN.test(created.name) ||
            !created.name.startsWith(`${session.locationName!}/localPosts/`)
          ) {
            throw new ExternalActionOutcomeUnknown();
          }
          const readback = await dependencies.google!.client.localPost(
            session.token.accessToken,
            session.locationName!,
            created.name,
          );
          const exactImageReadback = imageUrl === null || (
            Array.isArray(readback.media) && readback.media.length === 1 &&
            readback.media[0]?.sourceUrl === imageUrl
          );
          if (
            readback.name !== created.name ||
            readback.summary.trim() !== summary.trim() ||
            !exactImageReadback
          ) {
            throw new ExternalActionOutcomeUnknown();
          }
          return {
            published: true,
            providerResourceName: readback.name,
            publishedAt: new Date(now()).toISOString(),
            readBackAt: new Date(now()).toISOString(),
          };
        } catch (error) {
          if (
            error instanceof ExternalActionOutcomeUnknown || writeReturned ||
            providerWriteOutcomeIsUnknown(error)
          ) {
            throw new ExternalActionOutcomeUnknown();
          }
          throw error;
        }
      },
    });
  });

  return app;
}

export const meoAppInternals = {
  sha256,
  performanceTotals,
  performanceInput,
};
