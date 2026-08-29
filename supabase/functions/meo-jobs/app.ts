import { type Context, Hono } from "hono";
import type { CredentialCipher } from "../_shared/ai-credentials.ts";
import {
  type DataForSeoCredential,
  decryptExternalCredential,
  encryptExternalCredential,
  type GoogleToken,
  type MapsRankResult,
  type StoredExternalCredential,
} from "../_shared/meo-provider.ts";

export type IntegrationJobType = "rank_measurement" | "gbp_insights_sync";

export type ClaimedIntegrationJob = {
  jobId: string;
  storeId: string;
  actorId: string;
  jobType: IntegrationJobType;
  stage: "poll" | "execute";
  claimToken: string;
  attemptCount: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  providerTaskId: string | null;
  credentialSource: "owner_provider" | null;
};

export type WorkerConnection = StoredExternalCredential & {
  status: "active" | "invalid" | "revoked" | "error";
  expiresAt: string | null;
  externalAccountId: string | null;
  locationName: string | null;
};

export type PreparedIntegrationJob = {
  runnable: boolean;
  reasonCode: string | null;
  connections: Partial<
    Record<"google_business" | "dataforseo", WorkerConnection>
  >;
};

export interface MeoJobsRepository {
  enqueueDueJobs(evaluatedAt: string): Promise<Record<string, number>>;
  claimDueJobs(input: {
    jobTypes: IntegrationJobType[];
    limit: number;
    workerId: string;
    leaseSeconds: number;
  }): Promise<ClaimedIntegrationJob[]>;
  prepareJob(
    jobId: string,
    claimToken: string,
  ): Promise<PreparedIntegrationJob>;
  updateConnection(input: {
    jobId: string;
    claimToken: string;
    provider: "google_business";
    credential: StoredExternalCredential;
    expiresAt: string;
  }): Promise<void>;
  rescheduleJob(input: {
    jobId: string;
    claimToken: string;
    errorCode: string;
    availableAt: string;
  }): Promise<void>;
  finishJob(input: {
    jobId: string;
    claimToken: string;
    state: "completed" | "failed" | "dead_letter" | "attention_required";
    errorCode: string | null;
  }): Promise<void>;
  completeRank(input: {
    jobId: string;
    claimToken: string;
    ownPosition: number | null;
    competitorPositions: Array<{ placeId: string; position: number | null }>;
    observedAt: string;
    resultPlaceIds: string[];
  }): Promise<void>;
  completeInsights(input: {
    jobId: string;
    claimToken: string;
    periodStart: string;
    periodEnd: string;
    metrics: PerformanceMetrics;
    requestHash: string;
  }): Promise<void>;
}

export interface DataForSeoPoller {
  mapsTask(taskId: string): Promise<{
    ready: boolean;
    results: MapsRankResult[];
  }>;
}

export interface GoogleBusinessWorkerClient {
  refresh(token: GoogleToken): Promise<GoogleToken>;
  performance(
    accessToken: string,
    locationName: string,
    startDate: string,
    endDate: string,
  ): Promise<Record<string, unknown>>;
}

export type MeoJobsDependencies = {
  schedulerToken: string;
  repository: () => MeoJobsRepository;
  credentialCipher: CredentialCipher;
  google?: GoogleBusinessWorkerClient;
  dataForSeoFactory?: (credential: DataForSeoCredential) => DataForSeoPoller;
  now?: () => number;
  defaultLimit?: number;
  workerId?: string;
  leaseSeconds?: number;
};

export type PerformanceMetrics = {
  searches: number;
  views: number;
  websiteClicks: number;
  calls: number;
  directionRequests: number;
};

type JobOutcome =
  | "completed"
  | "retried"
  | "failed"
  | "deadLettered"
  | "attentionRequired";

class WorkerFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly ambiguousWrite = false,
  ) {
    super(code);
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9._:@/-]{1,255}$/;
const MAX_BODY_BYTES = 1_024;
const JOB_TYPES: IntegrationJobType[] = [
  "rank_measurement",
  "gbp_insights_sync",
];

function secureEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function requiredPayloadString(
  payload: Record<string, unknown>,
  key: string,
  pattern?: RegExp,
  maximum = 512,
): string {
  const value = payload[key];
  if (
    typeof value !== "string" || value.length === 0 || value.length > maximum ||
    (pattern && !pattern.test(value))
  ) {
    throw new WorkerFailure(`INVALID_JOB_${key.toUpperCase()}`, false);
  }
  return value;
}

function payloadStrings(
  payload: Record<string, unknown>,
  key: string,
  maximum: number,
): string[] {
  const value = payload[key];
  if (!Array.isArray(value) || value.length > maximum) {
    throw new WorkerFailure(`INVALID_JOB_${key.toUpperCase()}`, false);
  }
  const values = value.filter((item): item is string =>
    typeof item === "string" && item.length > 0 && item.length <= 255 &&
    SAFE_ID_PATTERN.test(item)
  );
  if (
    values.length !== value.length || new Set(values).size !== values.length
  ) {
    throw new WorkerFailure(`INVALID_JOB_${key.toUpperCase()}`, false);
  }
  return values;
}

function activeConnection(
  prepared: PreparedIntegrationJob,
  provider: "google_business" | "dataforseo",
): WorkerConnection {
  const connection = prepared.connections[provider];
  if (!connection || connection.status !== "active") {
    throw new WorkerFailure(
      `${provider.toUpperCase()}_CONNECTION_REQUIRED`,
      false,
    );
  }
  return connection;
}

function asCount(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d{1,12}$/.test(value)
    ? Number(value)
    : 0;
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(1_000_000_000, Math.round(parsed));
}

export function performanceTotals(
  value: Record<string, unknown>,
): PerformanceMetrics {
  const totals: Record<string, number> = {};
  const series = Array.isArray(value.multiDailyMetricTimeSeries)
    ? value.multiDailyMetricTimeSeries.slice(0, 64)
    : [];
  for (const raw of series) {
    if (raw === null || Array.isArray(raw) || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.dailyMetric !== "string") continue;
    const timeSeries = row.timeSeries && typeof row.timeSeries === "object" &&
        !Array.isArray(row.timeSeries)
      ? row.timeSeries as Record<string, unknown>
      : {};
    const values = Array.isArray(timeSeries.datedValues)
      ? timeSeries.datedValues.slice(0, 370)
      : [];
    totals[row.dailyMetric] = values.reduce((sum: number, rawValue) => {
      if (
        rawValue === null || Array.isArray(rawValue) ||
        typeof rawValue !== "object"
      ) return sum;
      return Math.min(
        1_000_000_000,
        sum + asCount((rawValue as Record<string, unknown>).value),
      );
    }, 0);
  }
  return {
    searches: Math.min(
      1_000_000_000,
      (totals.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH ?? 0) +
        (totals.BUSINESS_IMPRESSIONS_MOBILE_SEARCH ?? 0),
    ),
    views: Math.min(
      1_000_000_000,
      (totals.BUSINESS_IMPRESSIONS_DESKTOP_MAPS ?? 0) +
        (totals.BUSINESS_IMPRESSIONS_MOBILE_MAPS ?? 0),
    ),
    websiteClicks: totals.WEBSITE_CLICKS ?? 0,
    calls: totals.CALL_CLICKS ?? 0,
    directionRequests: totals.BUSINESS_DIRECTION_REQUESTS ?? 0,
  };
}

function errorCode(error: unknown): string {
  if (error instanceof WorkerFailure) return error.code;
  const message = error instanceof Error
    ? error.message
    : "PROVIDER_OPERATION_FAILED";
  return /^[A-Z0-9_:-]{2,100}$/.test(message)
    ? message
    : "PROVIDER_OPERATION_FAILED";
}

function readFailure(error: unknown): WorkerFailure {
  if (error instanceof WorkerFailure) return error;
  const status =
    typeof error === "object" && error !== null && "httpStatus" in error
      ? Number((error as { httpStatus?: unknown }).httpStatus)
      : 0;
  const code = errorCode(error);
  const retryable = code === "PROVIDER_TIMEOUT" || status === 408 ||
    status === 409 ||
    status === 425 || status === 429 || status >= 500 || status === 0;
  return new WorkerFailure(code, retryable);
}

export function nextRetryAt(
  attemptCount: number,
  maxAttempts: number,
  now: number,
  providerPending = false,
): string | null {
  if (attemptCount >= maxAttempts) return null;
  const delays = providerPending
    ? [15, 30, 60, 120, 300, 600]
    : [30, 120, 600, 1_800, 3_600];
  const delay =
    delays[Math.min(Math.max(0, attemptCount - 1), delays.length - 1)]!;
  return new Date(now + delay * 1_000).toISOString();
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function rankSnapshot(
  results: MapsRankResult[],
  ownPlaceId: string,
  competitorPlaceIds: string[],
) {
  const positions = new Map<string, number>();
  for (const result of results.slice(0, 100)) {
    if (result.placeId && !positions.has(result.placeId)) {
      positions.set(result.placeId, result.position);
    }
  }
  return {
    ownPosition: positions.get(ownPlaceId) ?? null,
    competitorPositions: competitorPlaceIds.map((placeId) => ({
      placeId,
      position: positions.get(placeId) ?? null,
    })),
    resultPlaceIds: [...positions.keys()].slice(0, 100),
  };
}

async function refreshedGoogleToken(input: {
  dependencies: MeoJobsDependencies;
  repository: MeoJobsRepository;
  job: ClaimedIntegrationJob;
  connection: WorkerConnection;
  now: number;
}): Promise<GoogleToken> {
  if (!input.dependencies.google) {
    throw new WorkerFailure("GOOGLE_PROVIDER_NOT_CONFIGURED", true);
  }
  let token = await decryptExternalCredential<GoogleToken>(
    input.dependencies.credentialCipher,
    input.job.storeId,
    input.connection,
  );
  if (Date.parse(token.expiresAt) <= input.now + 5 * 60_000) {
    try {
      token = await input.dependencies.google.refresh(token);
    } catch (error) {
      throw readFailure(error);
    }
    const encrypted = await encryptExternalCredential(
      input.dependencies.credentialCipher,
      input.job.storeId,
      "google_business",
      token,
    );
    await input.repository.updateConnection({
      jobId: input.job.jobId,
      claimToken: input.job.claimToken,
      provider: "google_business",
      credential: { provider: "google_business", ...encrypted },
      expiresAt: token.expiresAt,
    });
  }
  return token;
}

async function pollRank(
  dependencies: MeoJobsDependencies,
  repository: MeoJobsRepository,
  job: ClaimedIntegrationJob,
  prepared: PreparedIntegrationJob,
  now: number,
): Promise<JobOutcome> {
  if (job.stage !== "poll" || !job.providerTaskId) {
    throw new WorkerFailure("RANK_SUBMIT_OUTCOME_UNKNOWN", false, true);
  }
  if (job.credentialSource !== "owner_provider") {
    throw new WorkerFailure("DATAFORSEO_OWNER_CREDENTIAL_REQUIRED", false);
  }
  if (!dependencies.dataForSeoFactory) {
    throw new WorkerFailure("DATAFORSEO_PROVIDER_NOT_CONFIGURED", true);
  }
  const connection = activeConnection(prepared, "dataforseo");
  const credential = await decryptExternalCredential<DataForSeoCredential>(
    dependencies.credentialCipher,
    job.storeId,
    connection,
  );
  const client = dependencies.dataForSeoFactory(credential);
  let polled: Awaited<ReturnType<DataForSeoPoller["mapsTask"]>>;
  try {
    polled = await client.mapsTask(job.providerTaskId);
  } catch (error) {
    throw readFailure(error);
  }
  if (!polled.ready) {
    const retryAt = nextRetryAt(job.attemptCount, job.maxAttempts, now, true);
    if (!retryAt) {
      await repository.finishJob({
        jobId: job.jobId,
        claimToken: job.claimToken,
        state: "dead_letter",
        errorCode: "DATAFORSEO_RESULT_TIMEOUT",
      });
      return "deadLettered";
    }
    await repository.rescheduleJob({
      jobId: job.jobId,
      claimToken: job.claimToken,
      errorCode: "DATAFORSEO_RESULT_PENDING",
      availableAt: retryAt,
    });
    return "retried";
  }
  const ownPlaceId = requiredPayloadString(
    job.payload,
    "target_place_id",
    SAFE_ID_PATTERN,
    255,
  );
  const competitorPlaceIds = payloadStrings(
    job.payload,
    "competitor_place_ids",
    3,
  );
  const snapshot = rankSnapshot(polled.results, ownPlaceId, competitorPlaceIds);
  await repository.completeRank({
    jobId: job.jobId,
    claimToken: job.claimToken,
    ...snapshot,
    observedAt: new Date(now).toISOString(),
  });
  return "completed";
}

async function syncInsights(
  dependencies: MeoJobsDependencies,
  repository: MeoJobsRepository,
  job: ClaimedIntegrationJob,
  prepared: PreparedIntegrationJob,
  now: number,
): Promise<JobOutcome> {
  if (job.stage !== "execute") {
    throw new WorkerFailure("INVALID_INSIGHTS_JOB_STAGE", false);
  }
  let periodStart: string;
  let periodEnd: string;
  if (
    typeof job.payload.period_start === "string" &&
    typeof job.payload.period_end === "string"
  ) {
    periodStart = requiredPayloadString(
      job.payload,
      "period_start",
      DATE_PATTERN,
      10,
    );
    periodEnd = requiredPayloadString(
      job.payload,
      "period_end",
      DATE_PATTERN,
      10,
    );
  } else {
    const scheduledDate = requiredPayloadString(
      job.payload,
      "scheduled_date",
      DATE_PATTERN,
      10,
    );
    const scheduled = Date.parse(`${scheduledDate}T00:00:00.000Z`);
    if (!Number.isFinite(scheduled)) {
      throw new WorkerFailure("INVALID_INSIGHTS_PERIOD", false);
    }
    const completeDayEnd = scheduled - 86_400_000;
    periodEnd = new Date(completeDayEnd).toISOString().slice(0, 10);
    periodStart = new Date(completeDayEnd - 29 * 86_400_000).toISOString()
      .slice(0, 10);
  }
  const start = Date.parse(`${periodStart}T00:00:00.000Z`);
  const end = Date.parse(`${periodEnd}T00:00:00.000Z`);
  if (
    !Number.isFinite(start) || !Number.isFinite(end) || end < start ||
    end - start > 31 * 86_400_000
  ) {
    throw new WorkerFailure("INVALID_INSIGHTS_PERIOD", false);
  }
  const connection = activeConnection(prepared, "google_business");
  if (!connection.locationName) {
    throw new WorkerFailure("GOOGLE_LOCATION_REQUIRED", false);
  }
  const token = await refreshedGoogleToken({
    dependencies,
    repository,
    job,
    connection,
    now,
  });
  let raw: Record<string, unknown>;
  try {
    raw = await dependencies.google!.performance(
      token.accessToken,
      connection.locationName,
      periodStart,
      periodEnd,
    );
  } catch (error) {
    throw readFailure(error);
  }
  const metrics = performanceTotals(raw);
  await repository.completeInsights({
    jobId: job.jobId,
    claimToken: job.claimToken,
    periodStart,
    periodEnd,
    metrics,
    requestHash: await sha256Hex(
      JSON.stringify({ periodStart, periodEnd, metrics }),
    ),
  });
  return "completed";
}

async function handleFailure(
  repository: MeoJobsRepository,
  job: ClaimedIntegrationJob,
  error: unknown,
  now: number,
): Promise<JobOutcome> {
  const failure = error instanceof WorkerFailure ? error : readFailure(error);
  if (failure.ambiguousWrite) {
    await repository.finishJob({
      jobId: job.jobId,
      claimToken: job.claimToken,
      state: "attention_required",
      errorCode: failure.code,
    });
    return "attentionRequired";
  }
  if (failure.retryable) {
    const retryAt = nextRetryAt(job.attemptCount, job.maxAttempts, now);
    if (retryAt) {
      await repository.rescheduleJob({
        jobId: job.jobId,
        claimToken: job.claimToken,
        errorCode: failure.code,
        availableAt: retryAt,
      });
      return "retried";
    }
    await repository.finishJob({
      jobId: job.jobId,
      claimToken: job.claimToken,
      state: "dead_letter",
      errorCode: failure.code,
    });
    return "deadLettered";
  }
  await repository.finishJob({
    jobId: job.jobId,
    claimToken: job.claimToken,
    state: "failed",
    errorCode: failure.code,
  });
  return "failed";
}

export async function processIntegrationJob(
  dependencies: MeoJobsDependencies,
  repository: MeoJobsRepository,
  job: ClaimedIntegrationJob,
): Promise<JobOutcome> {
  const now = (dependencies.now ?? Date.now)();
  try {
    const prepared = await repository.prepareJob(job.jobId, job.claimToken);
    if (!prepared.runnable) {
      throw new WorkerFailure(
        prepared.reasonCode ?? "FEATURE_NOT_AVAILABLE",
        false,
      );
    }
    switch (job.jobType) {
      case "rank_measurement":
        return await pollRank(dependencies, repository, job, prepared, now);
      case "gbp_insights_sync":
        return await syncInsights(dependencies, repository, job, prepared, now);
    }
  } catch (error) {
    return await handleFailure(repository, job, error, now);
  }
}

async function boundedBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) return {};
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }
  if (!text) return {};
  const value = JSON.parse(text) as unknown;
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("INVALID_PAYLOAD");
  }
  return value as Record<string, unknown>;
}

export function createMeoJobsApp(dependencies: MeoJobsDependencies): Hono {
  const app = new Hono();
  const handler = async (c: Context) => {
    if (c.req.header("Origin")) return c.json({ error: "FORBIDDEN" }, 403);
    if (
      !secureEqual(
        c.req.header("Authorization") ?? "",
        `Bearer ${dependencies.schedulerToken}`,
      )
    ) {
      return c.json({ error: "UNAUTHORIZED" }, 401);
    }
    let body: Record<string, unknown>;
    try {
      body = await boundedBody(c.req.raw);
    } catch (error) {
      return c.json(
        { error: errorCode(error) },
        errorCode(error) === "PAYLOAD_TOO_LARGE" ? 413 : 400,
      );
    }
    const requestedLimit = body.limit === undefined
      ? dependencies.defaultLimit ?? 10
      : body.limit;
    if (
      !Number.isInteger(requestedLimit) || Number(requestedLimit) < 1 ||
      Number(requestedLimit) > 25
    ) {
      return c.json({ error: "INVALID_LIMIT" }, 400);
    }
    const repository = dependencies.repository();
    const evaluatedAt = new Date((dependencies.now ?? Date.now)())
      .toISOString();
    try {
      const scheduled = await repository.enqueueDueJobs(evaluatedAt);
      const jobs = await repository.claimDueJobs({
        jobTypes: JOB_TYPES,
        limit: Number(requestedLimit),
        workerId: dependencies.workerId ?? "meo-jobs",
        leaseSeconds: dependencies.leaseSeconds ?? 180,
      });
      const outcomes: JobOutcome[] = [];
      for (let index = 0; index < jobs.length; index += 3) {
        outcomes.push(
          ...await Promise.all(
            jobs.slice(index, index + 3).map((job) =>
              processIntegrationJob(dependencies, repository, job)
            ),
          ),
        );
      }
      return c.json({
        scheduled,
        claimed: jobs.length,
        completed: outcomes.filter((value) => value === "completed").length,
        retried: outcomes.filter((value) => value === "retried").length,
        failed: outcomes.filter((value) => value === "failed").length,
        deadLettered: outcomes.filter((value) =>
          value === "deadLettered"
        ).length,
        attentionRequired: outcomes.filter((value) =>
          value === "attentionRequired"
        ).length,
      });
    } catch {
      return c.json({ error: "WORKER_RUN_FAILED" }, 500);
    }
  };
  app.post("/", handler);
  app.post("/meo-jobs", handler);
  app.post("/meo-jobs/run", handler);
  return app;
}

export const meoJobsInternals = {
  secureEqual,
  rankSnapshot,
  maxBodyBytes: MAX_BODY_BYTES,
};
