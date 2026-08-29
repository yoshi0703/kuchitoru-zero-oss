import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, JsonObject } from "./types.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

type SafeError = {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
  answerSaved?: boolean;
  retryAfter?: number;
};

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly answerSaved?: boolean;
  readonly retryAfter?: number;

  constructor(input: SafeError) {
    super(input.message);
    this.name = "AppError";
    this.status = input.status;
    this.code = input.code;
    this.retryable = input.retryable;
    this.answerSaved = input.answerSaved;
    this.retryAfter = input.retryAfter;
  }
}

const SAFE_ERRORS: Record<string, SafeError> = {
  AI_CONNECTION_NOT_FOUND: {
    status: 404,
    code: "AI_CONNECTION_NOT_FOUND",
    message: "AI接続が見つかりません。",
    retryable: false,
  },
  AI_PROVIDER_NOT_CONFIGURED: {
    status: 409,
    code: "AI_PROVIDER_NOT_CONFIGURED",
    message: "店舗のAI接続が設定されていません。",
    retryable: false,
  },
  AI_PROVIDER_NOT_READY: {
    status: 409,
    code: "AI_PROVIDER_NOT_READY",
    message: "選択したAI接続を利用できません。",
    retryable: false,
  },
  GOOGLE_REVIEW_URL_UNAVAILABLE: {
    status: 409,
    code: "GOOGLE_REVIEW_URL_UNAVAILABLE",
    message: "Google口コミURLを利用できません。",
    retryable: false,
  },
  IDEMPOTENCY_KEY_REUSED: {
    status: 409,
    code: "IDEMPOTENCY_CONFLICT",
    message: "同じ操作キーが別の内容で使用されました。",
    retryable: false,
  },
  INVALID_HANDOFF_INPUT: {
    status: 400,
    code: "INVALID_HANDOFF_INPUT",
    message: "引き継ぎ内容を確認してください。",
    retryable: false,
  },
  INVALID_REVIEW_STATE: {
    status: 409,
    code: "INVALID_REVIEW_STATE",
    message: "現在の状態では口コミ文を操作できません。",
    retryable: false,
  },
  INVALID_REVIEW_TEXT: {
    status: 400,
    code: "INVALID_REVIEW_TEXT",
    message: "口コミ文は1〜800文字で入力してください。",
    retryable: false,
  },
  INVALID_SESSION_STATE: {
    status: 409,
    code: "INVALID_SESSION_STATE",
    message: "このインタビューは続行できません。",
    retryable: false,
  },
  INVALID_SURVEY_CONFIG: {
    status: 400,
    code: "INVALID_SURVEY_CONFIG",
    message: "アンケートの文言を確認してください。",
    retryable: false,
  },
  SURVEY_REVISION_NOT_FOUND: {
    status: 400,
    code: "SURVEY_REVISION_NOT_FOUND",
    message: "このアンケートの版を確認できません。最初からやり直してください。",
    retryable: false,
  },
  INVALID_TURN_INPUT: {
    status: 400,
    code: "INVALID_TURN_INPUT",
    message: "回答内容を確認してください。",
    retryable: false,
  },
  MAX_TURNS_REACHED: {
    status: 409,
    code: "MAX_TURNS_REACHED",
    message: "質問回数の上限に達しました。",
    retryable: false,
  },
  EXTERNAL_WRITES_DISABLED: {
    status: 409,
    code: "EXTERNAL_WRITES_DISABLED",
    message: "外部サービスへの書き込みは店舗設定で無効になっています。",
    retryable: false,
  },
  EXTERNAL_WRITE_ADMIN_REQUIRED: {
    status: 403,
    code: "EXTERNAL_WRITE_ADMIN_REQUIRED",
    message: "この設定を変更する権限がありません。",
    retryable: false,
  },
  EXTERNAL_WRITE_ROLE_REQUIRED: {
    status: 403,
    code: "EXTERNAL_WRITE_ROLE_REQUIRED",
    message: "閲覧専用の担当者は外部サービスへ送信できません。",
    retryable: false,
  },
  STORE_OPERATOR_REQUIRED: {
    status: 403,
    code: "STORE_OPERATOR_REQUIRED",
    message: "この店舗で操作を実行する権限がありません。",
    retryable: false,
  },
  OPERATION_IN_PROGRESS: {
    status: 409,
    code: "OPERATION_IN_PROGRESS",
    message: "同じ操作を処理中です。少し待って再度お試しください。",
    retryable: true,
  },
  OPERATION_LEASE_EXPIRED: {
    status: 409,
    code: "OPERATION_LEASE_EXPIRED",
    message: "処理の有効時間を超えました。もう一度お試しください。",
    retryable: true,
  },
  OPERATION_SUPERSEDED: {
    status: 409,
    code: "OPERATION_SUPERSEDED",
    message: "この処理は新しい再試行に置き換えられました。",
    retryable: false,
  },
  RATE_LIMIT_EXCEEDED: {
    status: 429,
    code: "RATE_LIMIT_EXCEEDED",
    message: "操作が集中しています。時間をおいて再度お試しください。",
    retryable: true,
    retryAfter: 60,
  },
  REWRITE_LIMIT_REACHED: {
    status: 409,
    code: "REWRITE_LIMIT_REACHED",
    message: "書き直し回数の上限に達しました。",
    retryable: false,
  },
  SESSION_EXPIRED: {
    status: 401,
    code: "SESSION_EXPIRED",
    message: "インタビューの有効期限が切れました。",
    retryable: false,
  },
  SESSION_INVALID: {
    status: 401,
    code: "SESSION_INVALID",
    message: "インタビューを確認できませんでした。",
    retryable: false,
  },
  STORE_NOT_AVAILABLE: {
    status: 404,
    code: "STORE_NOT_AVAILABLE",
    message: "このアンケートは現在利用できません。",
    retryable: false,
  },
  STORE_NOT_FOUND: {
    status: 404,
    code: "STORE_NOT_FOUND",
    message: "店舗情報が見つかりません。",
    retryable: false,
  },
  STORE_SLOT_EXHAUSTED: {
    status: 409,
    code: "STORE_SLOT_EXHAUSTED",
    message: "登録できる店舗は100件までです。",
    retryable: false,
  },
  STORE_NOT_READY: {
    status: 409,
    code: "STORE_NOT_READY",
    message: "公開に必要な設定を完了してください。",
    retryable: false,
  },
};

export function success<T>(
  c: Context<AppEnv>,
  data: T,
  status = 200,
): Response {
  return c.json({ success: true as const, data }, status as 200);
}

function errorBody(error: SafeError): JsonObject {
  const body: JsonObject = {
    success: false,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
  };
  if (error.answerSaved !== undefined) {
    body.data = { answerSaved: error.answerSaved };
  }
  return body;
}

export function appError(
  code: string,
  message: string,
  status = 400,
  retryable = false,
  answerSaved?: boolean,
): AppError {
  return new AppError({ code, message, status, retryable, answerSaved });
}

function normalizeError(error: unknown): SafeError {
  if (error instanceof AppError) return error;
  if (error instanceof HTTPException) {
    return {
      status: error.status === 401 || error.status === 403 ? error.status : 500,
      code: error.status === 403
        ? "FORBIDDEN"
        : error.status === 401
        ? "UNAUTHORIZED"
        : "INTERNAL_ERROR",
      message: error.status === 403
        ? "この操作は許可されていません。"
        : error.status === 401
        ? "ログインが必要です。"
        : "処理を完了できませんでした。",
      retryable: error.status >= 500,
    };
  }
  const candidate = error as { message?: unknown; code?: unknown };
  const rawMessage = typeof candidate?.message === "string"
    ? candidate.message
    : "";
  for (const [databaseCode, safe] of Object.entries(SAFE_ERRORS)) {
    if (rawMessage.includes(databaseCode)) return safe;
  }
  if (candidate?.code === "23505") {
    return {
      status: 409,
      code: "CONFLICT",
      message: "同じ内容がすでに登録されています。",
      retryable: false,
    };
  }
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    message: "処理を完了できませんでした。",
    retryable: true,
  };
}

function responseHeaders(
  c: Context<AppEnv>,
  response: Response,
  allowedOrigins: ReadonlySet<string>,
): void {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Vary", "Origin");
  response.headers.set(
    "X-Request-Id",
    c.get("requestId") ?? crypto.randomUUID(),
  );
  if (response.body !== null) {
    response.headers.set("Content-Type", "application/json; charset=utf-8");
  }
  const origin = c.req.header("Origin");
  if (origin !== undefined && allowedOrigins.has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set(
      "Access-Control-Expose-Headers",
      "X-Request-Id, Retry-After",
    );
  }
}

export function configureHttp(
  app: Hono<AppEnv>,
  allowedOrigins: ReadonlySet<string>,
): void {
  app.use("*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    const origin = c.req.header("Origin");
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      throw appError("ORIGIN_NOT_ALLOWED", "許可されていない送信元です。", 403);
    }
    if (c.req.method === "OPTIONS") {
      if (origin === undefined) {
        throw appError("ORIGIN_REQUIRED", "送信元を確認できません。", 403);
      }
      const response = new Response(null, { status: 204 });
      response.headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
      response.headers.set(
        "Access-Control-Allow-Headers",
        "apikey, authorization, content-type, idempotency-key, x-interview-token, x-request-id",
      );
      response.headers.set("Access-Control-Max-Age", "600");
      responseHeaders(c, response, allowedOrigins);
      return response;
    }
    await next();
    responseHeaders(c, c.res, allowedOrigins);
  });

  app.notFound((c) =>
    c.json(
      errorBody({
        status: 404,
        code: "NOT_FOUND",
        message: "ページが見つかりません。",
        retryable: false,
      }),
      404,
    )
  );
  app.onError((error, c) => {
    const safe = normalizeError(error);
    const response = c.json(errorBody(safe), safe.status as 400);
    if (safe.retryAfter !== undefined) {
      response.headers.set("Retry-After", String(safe.retryAfter));
    }
    responseHeaders(c, response, allowedOrigins);
    return response;
  });
}

export function parseAllowedOrigins(
  raw: string | undefined,
): ReadonlySet<string> {
  const entries = (raw ?? "").split(",").map((value) => value.trim()).filter(
    Boolean,
  );
  if (entries.length === 0) throw new Error("ALLOWED_ORIGINS_REQUIRED");
  const origins = new Set<string>();
  for (const entry of entries) {
    const url = new URL(entry);
    if (
      !(["https:", "http:"].includes(url.protocol)) || url.origin !== entry ||
      url.username || url.password
    ) {
      throw new Error("INVALID_ALLOWED_ORIGIN");
    }
    if (
      url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    ) {
      throw new Error("INSECURE_ALLOWED_ORIGIN");
    }
    origins.add(url.origin);
  }
  return origins;
}

async function readRequestTextWithinLimit(
  request: Request,
  maxBytes: number,
): Promise<string> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw appError(
          "PAYLOAD_TOO_LARGE",
          "送信内容が大きすぎます。",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw appError("INVALID_JSON", "入力内容を確認してください。", 400);
  }
}

export async function readJsonObject(
  c: Context<AppEnv>,
  maxBytes = 32_768,
): Promise<JsonObject> {
  const contentType = c.req.header("Content-Type")?.split(";", 1)[0].trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw appError(
      "UNSUPPORTED_MEDIA_TYPE",
      "JSON形式で送信してください。",
      415,
    );
  }
  const declared = Number(c.req.header("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw appError("PAYLOAD_TOO_LARGE", "送信内容が大きすぎます。", 413);
  }
  const text = await readRequestTextWithinLimit(c.req.raw, maxBytes);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw appError("INVALID_JSON", "入力内容を確認してください。", 400);
  }
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw appError("INVALID_JSON", "入力内容を確認してください。", 400);
  }
  return value as JsonObject;
}

export function requireMutationKey(c: Context<AppEnv>): string {
  const value = c.req.header("Idempotency-Key")?.trim() ?? "";
  if (!UUID_PATTERN.test(value)) {
    throw appError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "操作キーを確認してください。",
      400,
    );
  }
  return value.toLowerCase();
}

export function requireUuid(value: unknown, code = "INVALID_ID"): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw appError(code, "識別子を確認してください。", 400);
  }
  return value.toLowerCase();
}

export function requireString(
  value: unknown,
  input: {
    code: string;
    message: string;
    min?: number;
    max: number;
    pattern?: RegExp;
  },
): string {
  if (typeof value !== "string") throw appError(input.code, input.message, 400);
  const normalized = value.trim();
  if (
    normalized.length < (input.min ?? 0) || normalized.length > input.max ||
    (input.pattern && !input.pattern.test(normalized))
  ) {
    throw appError(input.code, input.message, 400);
  }
  return normalized;
}

export function optionalString(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max) {
    throw appError("INVALID_INPUT", "入力内容を確認してください。", 400);
  }
  return value.trim();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const result: JsonObject = {};
    for (const key of Object.keys(value as JsonObject).sort()) {
      result[key] = canonicalize((value as JsonObject)[key]);
    }
    return result;
  }
  return value;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function requestHashes(
  key: string,
  method: string,
  path: string,
  body: unknown,
): Promise<{ keyHash: string; requestHash: string }> {
  return {
    keyHash: await sha256Hex(key),
    requestHash: await sha256Hex(
      JSON.stringify(canonicalize({ method, path, body })),
    ),
  };
}

export function requestIp(c: Context<AppEnv>): string {
  const forwarded = c.req.header("X-Forwarded-For")?.split(",", 1)[0].trim();
  // Supabase's gateway supplies X-Forwarded-For. Do not accept alternate
  // proxy headers from callers: a forged CF-Connecting-IP/X-Real-IP value
  // must not become a rate-limit identity bypass.
  const value = forwarded || "unknown";
  return value.slice(0, 128);
}
