import type { JsonObject } from "../_shared/types.ts";
import type { StoredExternalCredential } from "../_shared/meo-provider.ts";
import type {
  ClaimedIntegrationJob,
  IntegrationJobType,
  MeoJobsRepository,
  PerformanceMetrics,
  PreparedIntegrationJob,
  WorkerConnection,
} from "./app.ts";

type RpcPort = {
  rpc<T = unknown>(name: string, params?: JsonObject): Promise<T>;
};

function object(
  value: unknown,
  code = "INVALID_WORKER_DATABASE_RESPONSE",
): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(code);
  }
  return value as JsonObject;
}

function objects(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) {
    throw new Error("INVALID_WORKER_DATABASE_RESPONSE");
  }
  return value.map((item) => object(item));
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`INVALID_WORKER_DATABASE_${field}`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integer(value: unknown, field: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`INVALID_WORKER_DATABASE_${field}`);
  }
  return Number(value);
}

function connection(
  value: unknown,
  expectedProvider: "google_business" | "dataforseo",
): WorkerConnection | undefined {
  if (value === null || value === undefined) return undefined;
  const row = object(value);
  const provider = string(row.provider, "CONNECTION_PROVIDER");
  if (provider !== expectedProvider) {
    throw new Error("INVALID_WORKER_DATABASE_CONNECTION_PROVIDER");
  }
  const keyVersion = integer(row.key_version, "CONNECTION_KEY_VERSION");
  if (keyVersion < 1) {
    throw new Error("INVALID_WORKER_DATABASE_CONNECTION_KEY_VERSION");
  }
  return {
    provider: expectedProvider,
    status: "active",
    ciphertext: string(row.credential_ciphertext, "CONNECTION_CIPHERTEXT"),
    iv: string(row.credential_iv, "CONNECTION_IV"),
    keyVersion,
    expiresAt: expectedProvider === "dataforseo"
      ? nullableString(row.expires_at)
      : string(row.expires_at, "CONNECTION_EXPIRY"),
    externalAccountId: nullableString(row.external_account_id),
    locationName: nullableString(row.location_name),
  };
}

function claimedJob(
  row: JsonObject,
  jobType: IntegrationJobType,
): ClaimedIntegrationJob {
  const stage = string(row.stage, "JOB_STAGE");
  if (stage !== "poll" && stage !== "execute") {
    throw new Error("INVALID_WORKER_DATABASE_JOB_STAGE");
  }
  const rawPayload = object(row.payload, "INVALID_WORKER_DATABASE_JOB_PAYLOAD");
  const rawCredential = nullableString(row.credential_source);
  const credentialSource = rawCredential === "owner_provider"
    ? rawCredential
    : null;
  return {
    jobId: string(row.job_id, "JOB_ID"),
    actorId: string(row.actor_id, "ACTOR_ID"),
    storeId: string(row.store_id, "STORE_ID"),
    jobType,
    stage,
    claimToken: string(row.claim_token, "CLAIM_TOKEN"),
    attemptCount: integer(row.attempt_count, "ATTEMPT_COUNT"),
    maxAttempts: integer(
      row.max_attempts,
      "MAX_ATTEMPTS",
      jobType === "rank_measurement" ? 12 : 5,
    ),
    payload: rawPayload,
    providerTaskId: nullableString(row.provider_task_id),
    credentialSource,
  };
}

export class MeoJobsSupabaseRepository implements MeoJobsRepository {
  readonly #rpc: RpcPort;
  readonly #jobTypes = new Map<string, IntegrationJobType>();

  constructor(rpc: RpcPort) {
    this.#rpc = rpc;
  }

  async enqueueDueJobs(evaluatedAt: string): Promise<Record<string, number>> {
    const row = object(
      await this.#rpc.rpc("internal_meo_worker_enqueue_due", {
        p_evaluated_at: evaluatedAt,
      }),
    );
    return {
      gbp_insights_sync: integer(
        row.gbp_insights_sync,
        "SCHEDULED_INSIGHTS",
        0,
      ),
    };
  }

  async claimDueJobs(input: {
    jobTypes: IntegrationJobType[];
    limit: number;
    workerId: string;
    leaseSeconds: number;
  }): Promise<ClaimedIntegrationJob[]> {
    const claimed: ClaimedIntegrationJob[] = [];
    const wantsRank = input.jobTypes.includes("rank_measurement");
    const wantsScheduled = input.jobTypes.includes("gbp_insights_sync");
    const claimScheduled = async (limit: number) => {
      const rows = objects(
        await this.#rpc.rpc("internal_meo_worker_claim_due", {
          p_limit: limit,
          p_worker_id: input.workerId,
          p_lease_seconds: input.leaseSeconds,
        }),
      );
      for (const row of rows) {
        const jobType = string(row.job_type, "JOB_TYPE");
        if (jobType !== "gbp_insights_sync") {
          throw new Error("INVALID_WORKER_DATABASE_JOB_TYPE");
        }
        claimed.push(claimedJob(row, jobType));
      }
      return rows.length;
    };
    const claimRank = async (limit: number) => {
      const rows = objects(
        await this.#rpc.rpc("internal_meo_claim_due_rank_jobs", {
          p_limit: limit,
          p_worker_id: input.workerId,
          p_lease_seconds: input.leaseSeconds,
        }),
      );
      claimed.push(...rows.map((row) => claimedJob(row, "rank_measurement")));
      return rows.length;
    };

    // Keep daily insight sync responsive during a large manual rank backlog.
    // Any unused scheduled quota is immediately returned to rank polling.
    const scheduledQuota = wantsScheduled
      ? wantsRank ? Math.ceil(input.limit / 2) : input.limit
      : 0;
    const firstScheduled = scheduledQuota > 0
      ? await claimScheduled(scheduledQuota)
      : 0;
    let remaining = input.limit - claimed.length;
    if (wantsRank && remaining > 0) await claimRank(remaining);
    remaining = input.limit - claimed.length;
    if (
      wantsScheduled && remaining > 0 && firstScheduled === scheduledQuota
    ) {
      await claimScheduled(remaining);
    }
    for (const job of claimed) this.#jobTypes.set(job.jobId, job.jobType);
    return claimed;
  }

  async prepareJob(
    jobId: string,
    claimToken: string,
  ): Promise<PreparedIntegrationJob> {
    const row = object(
      await this.#rpc.rpc("internal_meo_worker_prepare_job", {
        p_job_id: jobId,
        p_claim_token: claimToken,
      }),
    );
    const runnable = row.runnable === true;
    const google = connection(row.google_connection, "google_business");
    const dataForSeo = connection(row.dataforseo_connection, "dataforseo");
    return {
      runnable,
      reasonCode: nullableString(row.reason),
      connections: {
        ...(google ? { google_business: google } : {}),
        ...(dataForSeo ? { dataforseo: dataForSeo } : {}),
      },
    };
  }

  async updateConnection(input: {
    jobId: string;
    claimToken: string;
    provider: "google_business";
    credential: StoredExternalCredential;
    expiresAt: string;
  }): Promise<void> {
    await this.#rpc.rpc("internal_meo_worker_refresh_connection", {
      p_job_id: input.jobId,
      p_claim_token: input.claimToken,
      p_provider: input.provider,
      p_credential_ciphertext: input.credential.ciphertext,
      p_credential_iv: input.credential.iv,
      p_key_version: input.credential.keyVersion,
      p_expires_at: input.expiresAt,
    });
  }

  async rescheduleJob(input: {
    jobId: string;
    claimToken: string;
    errorCode: string;
    availableAt: string;
  }): Promise<void> {
    if (this.#jobTypes.get(input.jobId) === "rank_measurement") {
      await this.#rpc.rpc("internal_meo_fail_rank_job", {
        p_job_id: input.jobId,
        p_claim_token: input.claimToken,
        p_error_code: input.errorCode,
        p_outcome_ambiguous: false,
        p_retry_at: input.availableAt,
      });
      return;
    }
    await this.#rpc.rpc("internal_meo_worker_reschedule", {
      p_job_id: input.jobId,
      p_claim_token: input.claimToken,
      p_error_code: input.errorCode,
      p_available_at: input.availableAt,
    });
  }

  async finishJob(input: {
    jobId: string;
    claimToken: string;
    state: "completed" | "failed" | "dead_letter" | "attention_required";
    errorCode: string | null;
  }): Promise<void> {
    if (input.state === "completed") {
      await this.#rpc.rpc("internal_meo_worker_complete_noop", {
        p_job_id: input.jobId,
        p_claim_token: input.claimToken,
        p_reason_code: input.errorCode,
      });
      return;
    }
    if (this.#jobTypes.get(input.jobId) === "rank_measurement") {
      await this.#rpc.rpc("internal_meo_fail_rank_job", {
        p_job_id: input.jobId,
        p_claim_token: input.claimToken,
        p_error_code: input.errorCode ?? "RANK_JOB_FAILED",
        p_outcome_ambiguous: input.state === "attention_required",
        p_retry_at: null,
      });
      return;
    }
    await this.#rpc.rpc("internal_meo_worker_terminal", {
      p_job_id: input.jobId,
      p_claim_token: input.claimToken,
      p_state: input.state,
      p_error_code: input.errorCode ?? "INTEGRATION_JOB_FAILED",
    });
  }

  async completeRank(input: {
    jobId: string;
    claimToken: string;
    ownPosition: number | null;
    competitorPositions: Array<{ placeId: string; position: number | null }>;
    observedAt: string;
    resultPlaceIds: string[];
  }): Promise<void> {
    await this.#rpc.rpc("internal_meo_complete_rank_job", {
      p_job_id: input.jobId,
      p_claim_token: input.claimToken,
      p_position: input.ownPosition,
      p_observed_at: input.observedAt,
      p_result_place_ids: input.resultPlaceIds,
      p_competitor_positions: input.competitorPositions.map((item) => ({
        place_id: item.placeId,
        position: item.position,
      })),
    });
  }

  async completeInsights(input: {
    jobId: string;
    claimToken: string;
    periodStart: string;
    periodEnd: string;
    metrics: PerformanceMetrics;
    requestHash: string;
  }): Promise<void> {
    await this.#rpc.rpc("internal_meo_worker_complete_insights", {
      p_job_id: input.jobId,
      p_claim_token: input.claimToken,
      p_period_start: input.periodStart,
      p_period_end: input.periodEnd,
      p_metrics: input.metrics,
      p_request_hash: input.requestHash,
    });
  }
}

export const meoJobsRpcContract = [
  "internal_meo_worker_enqueue_due",
  "internal_meo_claim_due_rank_jobs",
  "internal_meo_worker_claim_due",
  "internal_meo_worker_prepare_job",
  "internal_meo_worker_refresh_connection",
  "internal_meo_worker_complete_noop",
  "internal_meo_worker_reschedule",
  "internal_meo_worker_terminal",
  "internal_meo_worker_complete_insights",
  "internal_meo_complete_rank_job",
  "internal_meo_fail_rank_job",
] as const;
