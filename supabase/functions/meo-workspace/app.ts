import { type Context, Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import {
  appError,
  configureHttp,
  readJsonObject,
  requireString,
  requireUuid,
  sha256Hex,
  success,
} from "../_shared/http.ts";
import type { AppEnv, SupabaseRequestContext } from "../_shared/types.ts";
import {
  acceptInvitationSchema,
  aioObservationCreateSchema,
  aioObservationPatchSchema,
  changeRequestCreateSchema,
  changeRequestDecisionSchema,
  changeRequestResources,
  citationCreateSchema,
  citationPatchSchema,
  groupCreateSchema,
  groupPatchSchema,
  insightSchema,
  jsonLdSchema,
  localBusinessJsonLd,
  mediaCreateSchema,
  mediaPatchSchema,
  memberCreateSchema,
  memberDeleteSchema,
  memberPatchSchema,
  mutationEnvelopeSchema,
  organizationCreateSchema,
  organizationPatchSchema,
  postCreateSchema,
  postPatchSchema,
  profileSchema,
  publishConfirmationSchema,
  rankObservationSchema,
  reviewCreateSchema,
  reviewPatchSchema,
  reviewTemplateCreateSchema,
  reviewTemplatePatchSchema,
  type WorkspaceResource,
  workspaceResources,
  type WorkspaceRole,
} from "./contracts.ts";
import type {
  WorkspaceAuthorization,
  WorkspaceRepositoryPort,
} from "./repository.ts";

export type WorkspaceAppDependencies = {
  allowedOrigins: ReadonlySet<string>;
  authMiddleware: MiddlewareHandler<AppEnv>;
  repository(
    c: { var: { supabaseContext: SupabaseRequestContext } },
  ): WorkspaceRepositoryPort;
};

type Schema<T> = {
  safeParse(input: unknown):
    | { success: true; data: T }
    | {
      success: false;
      error: { issues: Array<{ path: PropertyKey[]; message: string }> };
    };
};

type MutationOptions = {
  recordId?: string | null;
  allowedRoles?: readonly WorkspaceRole[];
  directStatus?: number;
};

const BASE = "/meo-workspace/v1";
const ADMIN_ROLES: readonly WorkspaceRole[] = ["owner", "admin"];
const EDIT_ROLES: readonly WorkspaceRole[] = ["owner", "admin", "editor"];
const RFC3339_CURSOR_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const RESOURCE_SET = new Set<WorkspaceResource>(workspaceResources);

function actorId(context: SupabaseRequestContext): string {
  const value = context.userClaims?.id;
  if (!value) throw appError("UNAUTHORIZED", "ログインが必要です。", 401);
  return requireUuid(value, "INVALID_ACTOR_ID");
}

function paramStoreId(c: Context<AppEnv>): string {
  return requireUuid(c.req.param("storeId"), "INVALID_STORE_ID");
}

function recordId(c: Context<AppEnv>, name: string): string {
  return requireUuid(c.req.param(name), "INVALID_RECORD_ID");
}

function queryStoreId(c: Context<AppEnv>): string {
  return requireUuid(c.req.query("store_id"), "INVALID_STORE_ID");
}

function resourceParam(c: Context<AppEnv>): WorkspaceResource {
  const value = c.req.param("resource") as WorkspaceResource;
  if (!RESOURCE_SET.has(value)) {
    throw appError("INVALID_RESOURCE", "対象データを確認してください。", 400);
  }
  return value;
}

function parse<T>(schema: Schema<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue?.path.length ? ` (${issue.path.join(".")})` : "";
  throw appError(
    "INVALID_INPUT",
    `入力内容を確認してください${field}。`,
    400,
  );
}

async function body<T>(
  c: Context<AppEnv>,
  schema: Schema<T>,
  maxBytes = 64 * 1024,
): Promise<T> {
  return parse(schema, await readJsonObject(c, maxBytes));
}

function verifiedActorEmail(
  context: SupabaseRequestContext,
  expectedActorId: string,
): string {
  const userEmail = context.userClaims?.email?.trim().toLowerCase() ?? "";
  const jwtEmail = typeof context.jwtClaims?.email === "string"
    ? context.jwtClaims.email.trim().toLowerCase()
    : "";
  const jwtSubject = context.jwtClaims?.sub;
  if (
    !userEmail || userEmail.length > 320 || !userEmail.includes("@") ||
    userEmail !== jwtEmail || jwtSubject !== expectedActorId
  ) {
    throw appError(
      "VERIFIED_EMAIL_REQUIRED",
      "確認済みのメールアドレスでログインしてください。",
      403,
    );
  }
  return userEmail;
}

function invitationAcceptance(value: unknown): unknown {
  const row = value !== null && !Array.isArray(value) &&
      typeof value === "object"
    ? value as Record<string, unknown>
    : null;
  if (typeof row?.store_id !== "string") {
    throw appError(
      "INVALID_INVITATION_READBACK",
      "招待の承認結果を確認できませんでした。",
      502,
      true,
    );
  }
  try {
    requireUuid(row.store_id, "INVALID_INVITATION_READBACK");
  } catch {
    throw appError(
      "INVALID_INVITATION_READBACK",
      "招待の承認結果を確認できませんでした。",
      502,
      true,
    );
  }
  return value;
}

function limit(c: Context<AppEnv>): number {
  const raw = c.req.query("limit");
  if (raw === undefined || raw === "") return 50;
  if (!/^[1-9][0-9]{0,2}$/.test(raw)) {
    throw appError("INVALID_LIMIT", "取得件数を確認してください。", 400);
  }
  const value = Number(raw);
  if (value > 100) {
    throw appError("INVALID_LIMIT", "取得件数は100件以下にしてください。", 400);
  }
  return value;
}

function cursor(c: Context<AppEnv>): string | null {
  const value = c.req.query("cursor")?.trim();
  if (!value) return null;
  if (
    !RFC3339_CURSOR_PATTERN.test(value) || !Number.isFinite(Date.parse(value))
  ) {
    throw appError("INVALID_CURSOR", "続きを取得できませんでした。", 400);
  }
  return value;
}

function filters(
  c: Context<AppEnv>,
  resource: WorkspaceResource,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const allow = new Set<string>([
    "status",
    "language_code",
    "topic_type",
    "keyword",
    "directory",
    "period_start",
    "period_end",
    "search",
  ]);
  if (resource === "reviews") allow.add("rating");
  for (const key of allow) {
    const value = c.req.query(key)?.trim();
    if (!value) continue;
    if (value.length > 250) {
      throw appError("INVALID_FILTER", "絞り込み条件を確認してください。", 400);
    }
    if (key === "rating") {
      if (!/^[1-5]$/.test(value)) {
        throw appError("INVALID_FILTER", "評価を確認してください。", 400);
      }
      result[key] = Number(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function authorize(
  c: Context<AppEnv>,
  dependencies: WorkspaceAppDependencies,
  storeId: string,
): Promise<{
  actorId: string;
  repository: WorkspaceRepositoryPort;
  authorization: WorkspaceAuthorization;
}> {
  const id = actorId(c.var.supabaseContext);
  const repository = dependencies.repository(c);
  let authorization: WorkspaceAuthorization;
  try {
    authorization = await repository.authorize(id, storeId);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown })?.message === "string"
      ? String((error as { message: string }).message)
      : "";
    if (
      message.includes("STORE_ACCESS_DENIED") ||
      message.includes("WORKSPACE_AUTHORIZATION_DENIED")
    ) {
      throw appError(
        "STORE_ACCESS_DENIED",
        "この店舗を操作する権限がありません。",
        403,
      );
    }
    throw error;
  }
  return { actorId: id, repository, authorization };
}

async function listResource(
  c: Context<AppEnv>,
  dependencies: WorkspaceAppDependencies,
  resource: WorkspaceResource,
): Promise<Response> {
  const storeId = paramStoreId(c);
  const access = await authorize(c, dependencies, storeId);
  const data = await access.repository.list({
    actorId: access.actorId,
    storeId,
    resource,
    cursor: cursor(c),
    limit: limit(c),
    filters: filters(c, resource),
  });
  return success(c, data);
}

async function mutate(
  c: Context<AppEnv>,
  dependencies: WorkspaceAppDependencies,
  resource: WorkspaceResource,
  action: string,
  payload: Record<string, unknown>,
  options: MutationOptions = {},
): Promise<Response> {
  const storeId = paramStoreId(c);
  const access = await authorize(c, dependencies, storeId);
  const roles = options.allowedRoles ?? EDIT_ROLES;
  if (!roles.includes(access.authorization.role)) {
    throw appError(
      access.authorization.role === "analyst" ? "READ_ONLY_ROLE" : "FORBIDDEN",
      access.authorization.role === "analyst"
        ? "Analyst権限は閲覧専用です。"
        : "この操作は許可されていません。",
      403,
    );
  }
  const normalizedPayload =
    resource === "change_requests" && action === "create"
      ? normalizeChangeRequest(payload)
      : payload;
  const persistedPayload = databasePayload(
    resource,
    action,
    normalizedPayload,
    options.recordId ?? null,
  );
  let invitation: { token: string; expiresAt: string } | null = null;
  if (
    resource === "members" && action === "create" &&
    !persistedPayload.user_id && persistedPayload.email
  ) {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000)
      .toISOString();
    persistedPayload.token_hash = await sha256Hex(token);
    persistedPayload.expires_at = expiresAt;
    invitation = { token, expiresAt };
  }
  let data: unknown;
  try {
    data = await access.repository.mutate({
      actorId: access.actorId,
      storeId,
      resource,
      action,
      recordId: options.recordId ?? null,
      payload: persistedPayload,
    });
  } catch (error) {
    throw safeRepositoryError(error);
  }
  const status = access.authorization.approvalRequired &&
      access.authorization.role === "editor" && resource !== "change_requests"
    ? 202
    : (options.directStatus ?? 200);
  return success(c, invitation ? { result: data, invitation } : data, status);
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

function safeRepositoryError(error: unknown): Error {
  const message = error instanceof Error
    ? error.message
    : typeof (error as { message?: unknown })?.message === "string"
    ? String((error as { message: string }).message)
    : "";
  if (
    message.includes("INVITATION_INVALID") ||
    message.includes("INVITATION_EXPIRED") ||
    message.includes("INVITATION_EMAIL_MISMATCH") ||
    message.includes("INVITATION_ALREADY_USED") ||
    message.includes("INVITATION_ACCEPTED") ||
    message.includes("INVITATION_NOT_FOUND")
  ) {
    return appError(
      "INVITATION_INVALID",
      "有効な招待を確認できませんでした。",
      400,
    );
  }
  if (
    message.includes("RESOURCE_NOT_FOUND") || message.includes("_NOT_FOUND")
  ) {
    return appError("RESOURCE_NOT_FOUND", "対象データが見つかりません。", 404);
  }
  if (
    message.includes("READ_ONLY_ROLE") ||
    message.includes("APPROVAL_FORBIDDEN") ||
    message.includes("ADMIN_REQUIRED") || message.includes("OWNER_REQUIRED")
  ) {
    return appError("FORBIDDEN", "この操作は許可されていません。", 403);
  }
  if (message.includes("OWNER_CANNOT_BE_REMOVED")) {
    return appError("OWNER_CANNOT_BE_REMOVED", "Ownerは削除できません。", 409);
  }
  if (message.includes("INVALID_") || message.includes("UNSUPPORTED_")) {
    return appError("INVALID_INPUT", "入力内容を確認してください。", 400);
  }
  return error instanceof Error
    ? error
    : new Error("WORKSPACE_REPOSITORY_ERROR");
}

function present<T>(
  target: Record<string, unknown>,
  key: string,
  value: T | undefined,
): void {
  if (value !== undefined) target[key] = value;
}

function databasePayload(
  resource: WorkspaceResource,
  action: string,
  input: Record<string, unknown>,
  id: string | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (resource === "profile" && action === "save") {
    return { profile: input, source: "manual" };
  }
  if (resource === "reviews" && action === "create") {
    present(out, "provider", input.provider);
    present(out, "provider_review_id", input.providerReviewId);
    present(out, "reviewer_display_name", input.authorName);
    present(out, "rating", input.rating);
    present(out, "review_text", input.comment);
    present(out, "language", input.languageCode);
    present(out, "status", input.status);
    present(out, "reviewed_at", input.reviewedAt);
    out.native_analysis_input = {};
    return out;
  }
  if (resource === "reviews" && action === "update") {
    present(out, "status", input.status);
    present(out, "language", input.languageCode);
    present(out, "tags", input.tags);
    present(out, "reply", input.replyText);
    present(out, "reply_language", input.replyLanguageCode);
    return out;
  }
  if (resource === "review_templates") {
    present(out, "name", input.name);
    present(out, "body", input.body);
    present(out, "language", input.languageCode);
    present(out, "min_rating", input.minRating);
    present(out, "max_rating", input.maxRating);
    return out;
  }
  if (resource === "media" && action === "create") {
    present(out, "storage_path", input.url);
    present(out, "media_type", input.kind);
    present(
      out,
      "mime_type",
      input.mimeType ?? (input.kind === "video" ? "video/mp4" : "image/jpeg"),
    );
    present(out, "alt_text", input.altText);
    present(out, "byte_size", input.byteSize);
    out.safe_metadata = {
      source: input.source,
      thumbnail_url: input.thumbnailUrl,
      width: input.width,
      height: input.height,
    };
    return out;
  }
  if (resource === "media" && action === "update") {
    present(out, "alt_text", input.altText);
    if (input.archived !== undefined) {
      out.status = input.archived ? "archived" : "active";
    }
    return out;
  }
  if (resource === "posts" && (action === "create" || action === "update")) {
    present(out, "post_type", input.topicType);
    present(out, "title", input.title);
    present(out, "summary", input.summary);
    const callToAction = input.callToAction as
      | Record<string, unknown>
      | null
      | undefined;
    if (callToAction !== undefined) {
      out.call_to_action = callToAction?.actionType ?? null;
      out.call_to_action_url = callToAction?.url ?? null;
    }
    present(out, "media_asset_ids", input.mediaAssetIds);
    if (input.status !== undefined) {
      out.status = input.status === "ready_for_manual_publish"
        ? "ready"
        : input.status;
    }
    out.details = {
      language: input.languageCode,
      event: input.event,
      offer: input.offer,
    };
    return out;
  }
  if (resource === "posts" && action === "record_publish_confirmation") {
    present(out, "confirmed_at", input.confirmedAt);
    present(out, "revision", input.revision);
    present(out, "revision_fingerprint", input.revisionFingerprint);
    present(out, "provider_resource_name", input.providerResourceName);
    out.outcome = "confirmed";
    out.safe_readback = {
      provider: input.provider,
      provider_url: input.providerUrl,
      readback: input.readback,
      notes: input.notes,
    };
    return out;
  }
  if (resource === "rank_observations" && action === "create") {
    present(out, "keyword", input.keyword);
    present(out, "position", input.rank);
    present(out, "target_place_id", input.targetPlaceId);
    present(out, "matched_url", input.matchedUrl);
    present(out, "competitor_positions", input.competitorPositions ?? []);
    present(out, "observed_at", input.observedAt);
    present(out, "result_count", input.resultCount);
    out.input_method = input.source === "owner_provider"
      ? "provider"
      : input.source;
    out.source = input.source === "owner_provider"
      ? "owner_provider"
      : "manual";
    out.location = {
      label: input.locationLabel,
      latitude: input.latitude,
      longitude: input.longitude,
    };
    return out;
  }
  if (resource === "insights" && action === "create") {
    present(out, "period_start", input.periodStart);
    present(out, "period_end", input.periodEnd);
    const metrics = input.metrics as Record<string, unknown>;
    out.metrics = {
      searches: metrics.searches ?? 0,
      views: metrics.views ?? 0,
      websiteClicks: metrics.websiteClicks ?? metrics.website_clicks ?? 0,
      calls: metrics.calls ?? 0,
      directionRequests: metrics.directionRequests ?? metrics.directions ?? 0,
      ...(metrics.bookings !== undefined ? { bookings: metrics.bookings } : {}),
      ...(metrics.orders !== undefined ? { orders: metrics.orders } : {}),
      ...(metrics.messages !== undefined ? { messages: metrics.messages } : {}),
    };
    out.source = input.source === "csv" ? "manual" : input.source;
    out.input_method = input.source === "google_business"
      ? "provider"
      : input.source;
    return out;
  }
  if (
    resource === "aio_citations" && (action === "create" || action === "update")
  ) {
    present(out, "source_name", input.directory);
    present(out, "source_type", input.sourceType);
    present(out, "url", input.listingUrl);
    const statusMap: Record<string, string> = {
      unknown: "unchecked",
      consistent: "consistent",
      inconsistent: "mismatch",
      missing: "missing",
    };
    if (typeof input.status === "string") {
      out.consistency_status = statusMap[input.status];
    }
    present(out, "last_checked_at", input.checkedAt);
    present(out, "notes", input.notes);
    out.nap_snapshot = {
      business_name: input.businessName,
      address: input.address,
      phone: input.phone,
      website_url: input.websiteUrl,
    };
    return out;
  }
  if (
    resource === "aio_observations" &&
    (action === "create" || action === "update")
  ) {
    present(out, "prompt", input.prompt);
    present(out, "engine", input.engine);
    present(out, "mentioned", input.mentioned);
    present(out, "position", input.position);
    present(out, "cited_urls", input.citedUrls);
    present(out, "observed_at", input.observedAt);
    present(out, "notes", input.notes);
    return out;
  }
  if (
    resource === "organizations" && (action === "create" || action === "update")
  ) {
    present(out, "name", input.name);
    if (input.approvalPolicy !== undefined) {
      out.approval_policy = input.approvalPolicy;
    }
    present(out, "slug", input.slug);
    return out;
  }
  if (resource === "groups" && (action === "create" || action === "update")) {
    present(out, "name", input.name);
    present(out, "description", input.description);
    present(out, "parent_group_id", input.parentGroupId);
    present(out, "store_ids", input.storeIds);
    return out;
  }
  if (resource === "members" && (action === "create" || action === "update")) {
    present(out, "user_id", input.userId ?? id ?? undefined);
    present(out, "email", input.email);
    present(out, "role", input.role);
    present(out, "scope", input.scope);
    present(out, "group_ids", input.groupIds);
    return out;
  }
  if (resource === "members" && action === "delete") {
    return { user_id: id, scope: input.scope ?? "organization" };
  }
  if (resource === "change_requests" && action === "create") {
    present(out, "resource", input.resource);
    present(out, "action", input.action);
    present(out, "record_id", input.recordId);
    present(out, "payload", input.payload);
    present(out, "reason", input.reason);
    return out;
  }
  if (
    resource === "change_requests" &&
    (action === "approve" || action === "reject")
  ) {
    present(out, "note", input.comment);
    return out;
  }
  if (resource === "jsonld" && action === "save") {
    const raw = input.input !== null && typeof input.input === "object" &&
        !Array.isArray(input.input)
      ? input.input as Parameters<typeof localBusinessJsonLd>[0]
      : input as Parameters<typeof localBusinessJsonLd>[0];
    return {
      schema_type: raw.type,
      document: input.document ?? localBusinessJsonLd(raw),
      validation_errors: [],
      status: "valid",
    };
  }
  return input;
}

type GenericMutationSpec = {
  schema: Schema<Record<string, unknown>>;
  needsRecordId?: boolean;
  allowedRoles?: readonly WorkspaceRole[];
  directStatus?: number;
};

const GENERIC_MUTATIONS: Readonly<Record<string, GenericMutationSpec>> = {
  "profile/save": { schema: profileSchema },
  "snapshots/restore": {
    schema: {
      safeParse: (input) => ({
        success: true,
        data: input as Record<string, unknown>,
      }),
    },
    needsRecordId: true,
  },
  "reviews/create": { schema: reviewCreateSchema, directStatus: 201 },
  "reviews/update": { schema: reviewPatchSchema, needsRecordId: true },
  "review_templates/create": {
    schema: reviewTemplateCreateSchema,
    directStatus: 201,
  },
  "review_templates/update": {
    schema: reviewTemplatePatchSchema,
    needsRecordId: true,
  },
  "review_templates/delete": {
    schema: {
      safeParse: (input) => ({
        success: true,
        data: input as Record<string, unknown>,
      }),
    },
    needsRecordId: true,
  },
  "media/create": { schema: mediaCreateSchema, directStatus: 201 },
  "media/update": { schema: mediaPatchSchema, needsRecordId: true },
  "posts/create": { schema: postCreateSchema, directStatus: 201 },
  "posts/update": { schema: postPatchSchema, needsRecordId: true },
  "posts/delete": {
    schema: {
      safeParse: (input) => ({
        success: true,
        data: input as Record<string, unknown>,
      }),
    },
    needsRecordId: true,
  },
  "posts/record_publish_confirmation": {
    schema: publishConfirmationSchema,
    needsRecordId: true,
  },
  "rank_observations/create": {
    schema: rankObservationSchema,
    directStatus: 201,
  },
  "insights/create": { schema: insightSchema, directStatus: 201 },
  "aio_citations/create": { schema: citationCreateSchema, directStatus: 201 },
  "aio_citations/update": { schema: citationPatchSchema, needsRecordId: true },
  "aio_citations/delete": {
    schema: {
      safeParse: (input) => ({
        success: true,
        data: input as Record<string, unknown>,
      }),
    },
    needsRecordId: true,
  },
  "aio_observations/create": {
    schema: aioObservationCreateSchema,
    directStatus: 201,
  },
  "aio_observations/update": {
    schema: aioObservationPatchSchema,
    needsRecordId: true,
  },
  "aio_observations/delete": {
    schema: {
      safeParse: (input) => ({
        success: true,
        data: input as Record<string, unknown>,
      }),
    },
    needsRecordId: true,
  },
  "jsonld/save": { schema: jsonLdSchema, directStatus: 201 },
  "organizations/create": {
    schema: organizationCreateSchema,
    allowedRoles: ["owner"],
    directStatus: 201,
  },
  "organizations/update": {
    schema: organizationPatchSchema,
    needsRecordId: true,
    allowedRoles: ["owner"],
  },
  "groups/create": {
    schema: groupCreateSchema,
    allowedRoles: ADMIN_ROLES,
    directStatus: 201,
  },
  "groups/update": {
    schema: groupPatchSchema,
    needsRecordId: true,
    allowedRoles: ADMIN_ROLES,
  },
  "groups/delete": {
    schema: {
      safeParse: (input) => ({
        success: true,
        data: input as Record<string, unknown>,
      }),
    },
    needsRecordId: true,
    allowedRoles: ADMIN_ROLES,
  },
  "members/create": {
    schema: memberCreateSchema,
    allowedRoles: ADMIN_ROLES,
    directStatus: 201,
  },
  "members/update": {
    schema: memberPatchSchema,
    needsRecordId: true,
    allowedRoles: ADMIN_ROLES,
  },
  "members/delete": {
    schema: memberDeleteSchema,
    needsRecordId: true,
    allowedRoles: ADMIN_ROLES,
  },
  "change_requests/create": {
    schema: changeRequestCreateSchema,
    directStatus: 201,
  },
  "change_requests/approve": {
    schema: changeRequestDecisionSchema,
    needsRecordId: true,
    allowedRoles: ADMIN_ROLES,
  },
  "change_requests/reject": {
    schema: changeRequestDecisionSchema,
    needsRecordId: true,
    allowedRoles: ADMIN_ROLES,
  },
};

const CHANGE_REQUEST_RESOURCES = new Set<WorkspaceResource>(
  changeRequestResources,
);

function normalizeChangeRequest(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const resource = input.resource as WorkspaceResource;
  const action = String(input.action ?? "");
  if (!CHANGE_REQUEST_RESOURCES.has(resource)) {
    throw appError(
      "INVALID_CHANGE_REQUEST_TARGET",
      "この対象は変更申請に含められません。",
      400,
    );
  }

  const targetSpec = GENERIC_MUTATIONS[`${resource}/${action}`];
  if (!targetSpec || resource === "change_requests" || resource === "audit") {
    throw appError(
      "INVALID_CHANGE_REQUEST_TARGET",
      "この操作は変更申請に含められません。",
      400,
    );
  }

  const rawRecordId = input.recordId;
  const recordId = typeof rawRecordId === "string"
    ? requireUuid(rawRecordId, "INVALID_RECORD_ID")
    : null;
  if (targetSpec.needsRecordId && !recordId) {
    throw appError("RECORD_ID_REQUIRED", "対象データを確認してください。", 400);
  }

  const targetPayload = parse(
    targetSpec.schema,
    input.payload as Record<string, unknown>,
  );
  return {
    resource,
    action,
    recordId,
    payload: databasePayload(resource, action, targetPayload, recordId),
    reason: input.reason,
  };
}

async function genericMutation(
  c: Context<AppEnv>,
  dependencies: WorkspaceAppDependencies,
): Promise<Response> {
  const resource = resourceParam(c);
  const action = requireString(c.req.param("action"), {
    code: "INVALID_ACTION",
    message: "操作を確認してください。",
    min: 1,
    max: 80,
    pattern: /^[a-z][a-z0-9_]*$/,
  });
  const spec = GENERIC_MUTATIONS[`${resource}/${action}`];
  if (!spec) {
    throw appError("INVALID_ACTION", "この操作は許可されていません。", 400);
  }
  const envelope = await body(c, mutationEnvelopeSchema);
  const payload = parse(spec.schema, envelope.payload);
  let id = envelope.recordId ?? null;
  if (id) id = requireUuid(id, "INVALID_RECORD_ID");
  if (spec.needsRecordId && !id) {
    throw appError("RECORD_ID_REQUIRED", "対象データを確認してください。", 400);
  }
  return mutate(c, dependencies, resource, action, payload, {
    recordId: id,
    allowedRoles: spec.allowedRoles,
    directStatus: spec.directStatus,
  });
}

export function createWorkspaceApp(
  dependencies: WorkspaceAppDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  configureHttp(app, dependencies.allowedOrigins);
  app.use(`${BASE}/*`, dependencies.authMiddleware);

  const workspaceHandler = async (c: Context<AppEnv>, storeId: string) => {
    const access = await authorize(c, dependencies, storeId);
    return success(
      c,
      await access.repository.workspaceSnapshot(access.actorId, storeId),
    );
  };
  app.get(`${BASE}/stores`, async (c) => {
    const id = actorId(c.var.supabaseContext);
    try {
      return success(c, await dependencies.repository(c).accessibleStores(id));
    } catch (error) {
      throw safeRepositoryError(error);
    }
  });
  app.post(`${BASE}/invitations/accept`, async (c) => {
    const context = c.var.supabaseContext;
    const id = actorId(context);
    const email = verifiedActorEmail(context, id);
    const input = await body(c, acceptInvitationSchema, 1_024);
    const tokenHash = await sha256Hex(input.token);
    try {
      const data = await dependencies.repository(c).acceptInvitation(
        id,
        email,
        tokenHash,
      );
      return success(c, invitationAcceptance(data));
    } catch (error) {
      throw safeRepositoryError(error);
    }
  });
  app.get(`${BASE}/workspace`, (c) => workspaceHandler(c, queryStoreId(c)));
  app.get(
    `${BASE}/stores/:storeId/workspace`,
    (c) => workspaceHandler(c, paramStoreId(c)),
  );
  app.get(
    `${BASE}/stores/:storeId/snapshot`,
    (c) => workspaceHandler(c, paramStoreId(c)),
  );
  app.get(
    `${BASE}/stores/:storeId/resources/:resource`,
    (c) => listResource(c, dependencies, resourceParam(c)),
  );
  app.post(
    `${BASE}/stores/:storeId/resources/:resource/:action`,
    (c) => genericMutation(c, dependencies),
  );

  app.get(
    `${BASE}/stores/:storeId/profile`,
    (c) => listResource(c, dependencies, "profile"),
  );
  app.put(
    `${BASE}/stores/:storeId/profile`,
    async (c) =>
      mutate(c, dependencies, "profile", "save", await body(c, profileSchema)),
  );
  app.get(
    `${BASE}/stores/:storeId/profile/snapshots`,
    (c) => listResource(c, dependencies, "snapshots"),
  );
  app.post(
    `${BASE}/stores/:storeId/profile/snapshots/:snapshotId/restore`,
    (c) =>
      mutate(c, dependencies, "snapshots", "restore", {}, {
        recordId: recordId(c, "snapshotId"),
      }),
  );

  app.get(
    `${BASE}/stores/:storeId/reviews`,
    (c) => listResource(c, dependencies, "reviews"),
  );
  app.post(
    `${BASE}/stores/:storeId/reviews`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "reviews",
        "create",
        await body(c, reviewCreateSchema),
        {
          directStatus: 201,
        },
      ),
  );
  app.patch(
    `${BASE}/stores/:storeId/reviews/:reviewId`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "reviews",
        "update",
        await body(c, reviewPatchSchema),
        {
          recordId: recordId(c, "reviewId"),
        },
      ),
  );

  app.get(
    `${BASE}/stores/:storeId/review-templates`,
    (c) => listResource(c, dependencies, "review_templates"),
  );
  app.post(`${BASE}/stores/:storeId/review-templates`, async (c) =>
    mutate(
      c,
      dependencies,
      "review_templates",
      "create",
      await body(c, reviewTemplateCreateSchema),
      { directStatus: 201 },
    ));
  app.patch(
    `${BASE}/stores/:storeId/review-templates/:templateId`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "review_templates",
        "update",
        await body(c, reviewTemplatePatchSchema),
        { recordId: recordId(c, "templateId") },
      ),
  );
  app.delete(
    `${BASE}/stores/:storeId/review-templates/:templateId`,
    (c) =>
      mutate(c, dependencies, "review_templates", "delete", {}, {
        recordId: recordId(c, "templateId"),
      }),
  );

  app.get(
    `${BASE}/stores/:storeId/media`,
    (c) => listResource(c, dependencies, "media"),
  );
  app.post(
    `${BASE}/stores/:storeId/media`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "media",
        "create",
        await body(c, mediaCreateSchema),
        {
          directStatus: 201,
        },
      ),
  );
  app.patch(
    `${BASE}/stores/:storeId/media/:mediaId`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "media",
        "update",
        await body(c, mediaPatchSchema),
        {
          recordId: recordId(c, "mediaId"),
        },
      ),
  );

  app.get(
    `${BASE}/stores/:storeId/posts`,
    (c) => listResource(c, dependencies, "posts"),
  );
  app.post(
    `${BASE}/stores/:storeId/posts`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "posts",
        "create",
        await body(c, postCreateSchema),
        {
          directStatus: 201,
        },
      ),
  );
  app.patch(
    `${BASE}/stores/:storeId/posts/:postId`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "posts",
        "update",
        await body(c, postPatchSchema),
        {
          recordId: recordId(c, "postId"),
        },
      ),
  );
  app.delete(
    `${BASE}/stores/:storeId/posts/:postId`,
    (c) =>
      mutate(c, dependencies, "posts", "delete", {}, {
        recordId: recordId(c, "postId"),
      }),
  );
  app.post(
    `${BASE}/stores/:storeId/posts/:postId/publish-confirmation`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "posts",
        "record_publish_confirmation",
        await body(c, publishConfirmationSchema),
        { recordId: recordId(c, "postId") },
      ),
  );

  app.get(
    `${BASE}/stores/:storeId/rank-observations`,
    (c) => listResource(c, dependencies, "rank_observations"),
  );
  app.post(`${BASE}/stores/:storeId/rank-observations`, async (c) =>
    mutate(
      c,
      dependencies,
      "rank_observations",
      "create",
      await body(c, rankObservationSchema),
      { directStatus: 201 },
    ));

  app.get(
    `${BASE}/stores/:storeId/insights`,
    (c) => listResource(c, dependencies, "insights"),
  );
  app.post(
    `${BASE}/stores/:storeId/insights`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "insights",
        "create",
        await body(c, insightSchema),
        {
          directStatus: 201,
        },
      ),
  );

  app.get(
    `${BASE}/stores/:storeId/aio/citations`,
    (c) => listResource(c, dependencies, "aio_citations"),
  );
  app.post(`${BASE}/stores/:storeId/aio/citations`, async (c) =>
    mutate(
      c,
      dependencies,
      "aio_citations",
      "create",
      await body(c, citationCreateSchema),
      { directStatus: 201 },
    ));
  app.patch(
    `${BASE}/stores/:storeId/aio/citations/:citationId`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "aio_citations",
        "update",
        await body(c, citationPatchSchema),
        { recordId: recordId(c, "citationId") },
      ),
  );
  app.delete(
    `${BASE}/stores/:storeId/aio/citations/:citationId`,
    (c) =>
      mutate(c, dependencies, "aio_citations", "delete", {}, {
        recordId: recordId(c, "citationId"),
      }),
  );
  app.get(
    `${BASE}/stores/:storeId/aio/observations`,
    (c) => listResource(c, dependencies, "aio_observations"),
  );
  app.post(`${BASE}/stores/:storeId/aio/observations`, async (c) =>
    mutate(
      c,
      dependencies,
      "aio_observations",
      "create",
      await body(c, aioObservationCreateSchema),
      { directStatus: 201 },
    ));
  app.patch(
    `${BASE}/stores/:storeId/aio/observations/:observationId`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "aio_observations",
        "update",
        await body(c, aioObservationPatchSchema),
        { recordId: recordId(c, "observationId") },
      ),
  );
  app.delete(
    `${BASE}/stores/:storeId/aio/observations/:observationId`,
    (c) =>
      mutate(c, dependencies, "aio_observations", "delete", {}, {
        recordId: recordId(c, "observationId"),
      }),
  );
  app.get(
    `${BASE}/stores/:storeId/audit`,
    (c) => listResource(c, dependencies, "audit"),
  );
  app.get(
    `${BASE}/stores/:storeId/aio/jsonld`,
    (c) => listResource(c, dependencies, "jsonld"),
  );
  app.post(`${BASE}/stores/:storeId/aio/jsonld`, async (c) => {
    const input = await body(c, jsonLdSchema);
    return mutate(c, dependencies, "jsonld", "save", {
      input,
      document: localBusinessJsonLd(input),
    }, { directStatus: 201 });
  });

  app.get(
    `${BASE}/stores/:storeId/organizations`,
    (c) => listResource(c, dependencies, "organizations"),
  );
  app.post(`${BASE}/stores/:storeId/organizations`, async (c) =>
    mutate(
      c,
      dependencies,
      "organizations",
      "create",
      await body(c, organizationCreateSchema),
      { allowedRoles: ["owner"], directStatus: 201 },
    ));
  app.patch(
    `${BASE}/stores/:storeId/organizations/:organizationId`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "organizations",
        "update",
        await body(c, organizationPatchSchema),
        { recordId: recordId(c, "organizationId"), allowedRoles: ["owner"] },
      ),
  );

  app.get(
    `${BASE}/stores/:storeId/groups`,
    (c) => listResource(c, dependencies, "groups"),
  );
  app.post(
    `${BASE}/stores/:storeId/groups`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "groups",
        "create",
        await body(c, groupCreateSchema),
        {
          allowedRoles: ADMIN_ROLES,
          directStatus: 201,
        },
      ),
  );
  app.patch(
    `${BASE}/stores/:storeId/groups/:groupId`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "groups",
        "update",
        await body(c, groupPatchSchema),
        {
          recordId: recordId(c, "groupId"),
          allowedRoles: ADMIN_ROLES,
        },
      ),
  );
  app.delete(
    `${BASE}/stores/:storeId/groups/:groupId`,
    (c) =>
      mutate(c, dependencies, "groups", "delete", {}, {
        recordId: recordId(c, "groupId"),
        allowedRoles: ADMIN_ROLES,
      }),
  );

  app.get(
    `${BASE}/stores/:storeId/members`,
    (c) => listResource(c, dependencies, "members"),
  );
  app.post(
    `${BASE}/stores/:storeId/members`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "members",
        "create",
        await body(c, memberCreateSchema),
        {
          allowedRoles: ADMIN_ROLES,
          directStatus: 201,
        },
      ),
  );
  app.patch(
    `${BASE}/stores/:storeId/members/:memberId`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "members",
        "update",
        await body(c, memberPatchSchema),
        {
          recordId: recordId(c, "memberId"),
          allowedRoles: ADMIN_ROLES,
        },
      ),
  );
  app.delete(
    `${BASE}/stores/:storeId/members/:memberId`,
    (c) =>
      mutate(c, dependencies, "members", "delete", {}, {
        recordId: recordId(c, "memberId"),
        allowedRoles: ADMIN_ROLES,
      }),
  );

  app.get(
    `${BASE}/stores/:storeId/change-requests`,
    (c) => listResource(c, dependencies, "change_requests"),
  );
  app.post(`${BASE}/stores/:storeId/change-requests`, async (c) =>
    mutate(
      c,
      dependencies,
      "change_requests",
      "create",
      await body(c, changeRequestCreateSchema),
      { directStatus: 201 },
    ));
  app.post(
    `${BASE}/stores/:storeId/change-requests/:requestId/approve`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "change_requests",
        "approve",
        await body(c, changeRequestDecisionSchema),
        { recordId: recordId(c, "requestId"), allowedRoles: ADMIN_ROLES },
      ),
  );
  app.post(
    `${BASE}/stores/:storeId/change-requests/:requestId/reject`,
    async (c) =>
      mutate(
        c,
        dependencies,
        "change_requests",
        "reject",
        await body(c, changeRequestDecisionSchema),
        { recordId: recordId(c, "requestId"), allowedRoles: ADMIN_ROLES },
      ),
  );

  return app;
}
