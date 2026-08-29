// deno-lint-ignore-file require-await -- the in-memory RPC port is promise based.
import type { JsonObject } from "../_shared/types.ts";
import { MeoJobsSupabaseRepository } from "../meo-jobs/repository.ts";
import { assertEquals } from "./assert.ts";

const jobId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const claimToken = "44444444-4444-4444-8444-444444444444";

function rpcHarness(responses: Record<string, unknown>) {
  const calls: Array<{ name: string; params: JsonObject }> = [];
  return {
    calls,
    port: {
      rpc: async <T>(name: string, params: JsonObject = {}) => {
        calls.push({ name, params });
        return responses[name] as T;
      },
    },
  };
}

Deno.test("worker repository reserves capacity for scheduled work within one bound", async () => {
  const harness = rpcHarness({
    internal_meo_claim_due_rank_jobs: [{
      job_id: jobId,
      actor_id: actorId,
      store_id: storeId,
      stage: "poll",
      claim_token: claimToken,
      attempt_count: 2,
      max_attempts: 12,
      payload: { target_place_id: "place-own-123", competitor_place_ids: [] },
      provider_task_id: "provider-task",
      credential_source: "owner_provider",
    }],
    internal_meo_worker_claim_due: [{
      job_id: "55555555-5555-4555-8555-555555555555",
      actor_id: actorId,
      store_id: storeId,
      job_type: "gbp_insights_sync",
      stage: "execute",
      claim_token: "66666666-6666-4666-8666-666666666666",
      attempt_count: 1,
      max_attempts: 5,
      payload: { scheduled_date: "2026-08-11" },
      provider_task_id: null,
      credential_source: "native",
    }],
  });
  const repository = new MeoJobsSupabaseRepository(harness.port);
  const jobs = await repository.claimDueJobs({
    jobTypes: ["rank_measurement", "gbp_insights_sync"],
    limit: 2,
    workerId: "meo-jobs",
    leaseSeconds: 180,
  });
  assertEquals(jobs.map((job) => [job.jobType, job.stage, job.maxAttempts]), [
    ["gbp_insights_sync", "execute", 5],
    ["rank_measurement", "poll", 12],
  ]);
  assertEquals(harness.calls.map((call) => [call.name, call.params.p_limit]), [
    ["internal_meo_worker_claim_due", 1],
    ["internal_meo_claim_due_rank_jobs", 1],
  ]);
});

Deno.test("unused scheduled capacity is returned to rank polling", async () => {
  const harness = rpcHarness({
    internal_meo_worker_claim_due: [],
    internal_meo_claim_due_rank_jobs: [{
      job_id: jobId,
      actor_id: actorId,
      store_id: storeId,
      stage: "poll",
      claim_token: claimToken,
      attempt_count: 2,
      max_attempts: 12,
      payload: { target_place_id: "place-own-123", competitor_place_ids: [] },
      provider_task_id: "provider-task",
      credential_source: "owner_provider",
    }],
  });
  const repository = new MeoJobsSupabaseRepository(harness.port);
  const jobs = await repository.claimDueJobs({
    jobTypes: ["rank_measurement", "gbp_insights_sync"],
    limit: 2,
    workerId: "meo-jobs",
    leaseSeconds: 180,
  });
  assertEquals(jobs.map((job) => job.jobType), ["rank_measurement"]);
  assertEquals(harness.calls.map((call) => [call.name, call.params.p_limit]), [
    ["internal_meo_worker_claim_due", 1],
    ["internal_meo_claim_due_rank_jobs", 2],
  ]);
});

Deno.test("worker repository exposes only decrypted-at-runtime connection envelopes", async () => {
  const harness = rpcHarness({
    internal_meo_worker_prepare_job: {
      runnable: true,
      reason: null,
      google_connection: {
        provider: "google_business",
        credential_ciphertext: "encrypted-google-credential",
        credential_iv: "encrypted-iv-value",
        key_version: 2,
        expires_at: "2026-09-01T00:00:00Z",
        location_name: "accounts/a/locations/location1",
      },
    },
  });
  const repository = new MeoJobsSupabaseRepository(harness.port);
  const prepared = await repository.prepareJob(jobId, claimToken);
  assertEquals(prepared.runnable, true);
  assertEquals(
    prepared.connections.google_business?.locationName,
    "accounts/a/locations/location1",
  );
  assertEquals(
    "accessToken" in (prepared.connections.google_business ?? {}),
    false,
  );
});

Deno.test("rank retries and completion use claim-token protected rank RPCs", async () => {
  const harness = rpcHarness({
    internal_meo_claim_due_rank_jobs: [{
      job_id: jobId,
      actor_id: actorId,
      store_id: storeId,
      stage: "poll",
      claim_token: claimToken,
      attempt_count: 1,
      max_attempts: 12,
      payload: {},
      provider_task_id: "provider-task",
      credential_source: "owner_provider",
    }],
    internal_meo_complete_rank_job: {},
    internal_meo_fail_rank_job: null,
  });
  const repository = new MeoJobsSupabaseRepository(harness.port);
  await repository.claimDueJobs({
    jobTypes: ["rank_measurement"],
    limit: 1,
    workerId: "meo-jobs",
    leaseSeconds: 180,
  });
  await repository.rescheduleJob({
    jobId,
    claimToken,
    errorCode: "DATAFORSEO_RESULT_PENDING",
    availableAt: "2026-08-11T03:01:00Z",
  });
  await repository.completeRank({
    jobId,
    claimToken,
    ownPosition: 2,
    competitorPositions: [{ placeId: "place-rival-1", position: 1 }],
    observedAt: "2026-08-11T03:00:00Z",
    resultPlaceIds: ["place-rival-1", "place-own-123"],
  });
  const retry = harness.calls.find((call) =>
    call.name === "internal_meo_fail_rank_job"
  )!;
  assertEquals(retry.params.p_outcome_ambiguous, false);
  assertEquals(retry.params.p_retry_at, "2026-08-11T03:01:00Z");
  const completion = harness.calls.find((call) =>
    call.name === "internal_meo_complete_rank_job"
  )!;
  assertEquals(completion.params.p_competitor_positions, [{
    place_id: "place-rival-1",
    position: 1,
  }]);
});
