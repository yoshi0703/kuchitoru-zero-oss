// deno-lint-ignore-file require-await -- async mocks implement promise-based ports.
import { VersionedCredentialCipher } from "../_shared/ai-credentials.ts";
import {
  type DataForSeoCredential,
  encryptExternalCredential,
  type GoogleToken,
} from "../_shared/meo-provider.ts";
import {
  type ClaimedIntegrationJob,
  createMeoJobsApp,
  type MeoJobsDependencies,
  meoJobsInternals,
  type MeoJobsRepository,
  nextRetryAt,
  performanceTotals,
  type PreparedIntegrationJob,
  processIntegrationJob,
  type WorkerConnection,
} from "../meo-jobs/app.ts";
import { buildMeoJobsApp } from "../meo-jobs/index.ts";
import { assertEquals, assertRejects } from "./assert.ts";

const now = Date.parse("2026-08-11T03:00:00.000Z");
const schedulerToken = "worker-token-that-is-at-least-32-bytes";
const jobId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const claimToken = "44444444-4444-4444-8444-444444444444";
const rawKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(11)));

function rankJob(overrides: Partial<ClaimedIntegrationJob> = {}) {
  return {
    jobId,
    storeId,
    actorId,
    jobType: "rank_measurement",
    stage: "poll",
    claimToken,
    attemptCount: 1,
    maxAttempts: 12,
    payload: {
      target_place_id: "place-own-123",
      competitor_place_ids: ["place-rival-1", "place-rival-2"],
    },
    providerTaskId: "provider-task-1",
    credentialSource: "owner_provider",
    ...overrides,
  } as ClaimedIntegrationJob;
}

function repositoryHarness() {
  const events: Array<{ type: string; input: unknown }> = [];
  let prepared: PreparedIntegrationJob = {
    runnable: true,
    reasonCode: null,
    connections: {},
  };
  const repository: MeoJobsRepository = {
    enqueueDueJobs: async (input) => {
      events.push({ type: "enqueue", input });
      return { gbp_insights_sync: 0 };
    },
    claimDueJobs: async (input) => {
      events.push({ type: "claim", input });
      return [];
    },
    prepareJob: async (claimedJobId, token) => {
      events.push({ type: "prepare", input: { claimedJobId, token } });
      return prepared;
    },
    updateConnection: async (input) => {
      events.push({ type: "updateConnection", input });
    },
    rescheduleJob: async (input) => {
      events.push({ type: "reschedule", input });
    },
    finishJob: async (input) => {
      events.push({ type: "finish", input });
    },
    completeRank: async (input) => {
      events.push({ type: "completeRank", input });
    },
    completeInsights: async (input) => {
      events.push({ type: "completeInsights", input });
    },
  };
  return {
    repository,
    events,
    setPrepared(value: PreparedIntegrationJob) {
      prepared = value;
    },
  };
}

async function cipher() {
  return await VersionedCredentialCipher.fromBase64Keys(
    new Map([[1, rawKey]]),
    1,
  );
}

function dependencyBase(
  repository: MeoJobsRepository,
  credentialCipher: VersionedCredentialCipher,
): MeoJobsDependencies {
  return {
    schedulerToken,
    repository: () => repository,
    credentialCipher,
    now: () => now,
  };
}

async function connection(
  credentialCipher: VersionedCredentialCipher,
  provider: "google_business" | "dataforseo",
  token: GoogleToken | DataForSeoCredential,
  locationName: string | null = null,
): Promise<WorkerConnection> {
  const encrypted = await encryptExternalCredential(
    credentialCipher,
    storeId,
    provider,
    token,
  );
  return {
    provider,
    ...encrypted,
    status: "active",
    expiresAt: "expiresAt" in token ? token.expiresAt : null,
    externalAccountId: null,
    locationName,
  };
}

Deno.test("meo worker requires explicit server-only configuration", async () => {
  await assertRejects(() => buildMeoJobsApp({}), "MEO_JOBS_DISABLED");
  await assertRejects(
    () => buildMeoJobsApp({ MEO_JOBS_ENABLED: "true" }),
    "INVALID_MEO_JOBS_TOKEN",
  );
});

Deno.test("meo worker rejects missing tokens and browser origins", async () => {
  const harness = repositoryHarness();
  const app = createMeoJobsApp(
    dependencyBase(harness.repository, await cipher()),
  );
  assertEquals(
    (await app.request("/meo-jobs/run", { method: "POST" })).status,
    401,
  );
  assertEquals(
    (await app.request("/meo-jobs/run", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${schedulerToken}`,
        Origin: "https://app.example.test",
      },
    })).status,
    403,
  );
  assertEquals(harness.events, []);
  assertEquals(meoJobsInternals.secureEqual("same", "same"), true);
  assertEquals(meoJobsInternals.secureEqual("same", "different"), false);
});

Deno.test("meo worker cancels an oversized body while receiving it", async () => {
  const harness = repositoryHarness();
  const app = createMeoJobsApp(
    dependencyBase(harness.repository, await cipher()),
  );
  const chunk = new Uint8Array(meoJobsInternals.maxBodyBytes);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });

  const response = await app.request("/meo-jobs/run", {
    method: "POST",
    headers: { Authorization: `Bearer ${schedulerToken}` },
    body,
  });

  assertEquals(response.status, 413);
  assertEquals(await response.json(), { error: "PAYLOAD_TOO_LARGE" });
  assertEquals(cancelled, true);
  assertEquals(harness.events, []);
});

Deno.test("rank polling decrypts the owner DataForSEO connection", async () => {
  const credentialCipher = await cipher();
  const harness = repositoryHarness();
  const dataforseo = await connection(credentialCipher, "dataforseo", {
    login: "owner-login",
    password: "owner-password",
  });
  harness.setPrepared({
    runnable: true,
    reasonCode: null,
    connections: { dataforseo },
  });
  let received: DataForSeoCredential | null = null;
  assertEquals(
    await processIntegrationJob(
      {
        ...dependencyBase(harness.repository, credentialCipher),
        dataForSeoFactory: (credential) => {
          received = credential;
          return {
            mapsTask: async () => ({
              ready: true,
              results: [{
                position: 4,
                placeId: "place-own-123",
                title: null,
                cid: null,
              }],
            }),
          };
        },
      },
      harness.repository,
      rankJob(),
    ),
    "completed",
  );
  assertEquals(received, { login: "owner-login", password: "owner-password" });
  const completed = harness.events.find((event) =>
    event.type === "completeRank"
  )
    ?.input as Record<string, unknown>;
  assertEquals(completed.ownPosition, 4);
});

Deno.test("pending rank tasks back off and dead-letter at the cap", async () => {
  const credentialCipher = await cipher();
  const dataforseo = await connection(credentialCipher, "dataforseo", {
    login: "owner-login",
    password: "owner-password",
  });
  const first = repositoryHarness();
  first.setPrepared({
    runnable: true,
    reasonCode: null,
    connections: { dataforseo },
  });
  const dependencies: MeoJobsDependencies = {
    ...dependencyBase(first.repository, credentialCipher),
    dataForSeoFactory: () => ({
      mapsTask: async () => ({ ready: false, results: [] }),
    }),
  };
  assertEquals(
    await processIntegrationJob(dependencies, first.repository, rankJob()),
    "retried",
  );
  const retry = first.events.find((event) => event.type === "reschedule")
    ?.input as Record<string, unknown>;
  assertEquals(retry.availableAt, "2026-08-11T03:00:15.000Z");

  const capped = repositoryHarness();
  capped.setPrepared({
    runnable: true,
    reasonCode: null,
    connections: { dataforseo },
  });
  assertEquals(
    await processIntegrationJob(
      { ...dependencies, repository: () => capped.repository },
      capped.repository,
      rankJob({ attemptCount: 12, maxAttempts: 12 }),
    ),
    "deadLettered",
  );
  const finished = capped.events.find((event) => event.type === "finish")
    ?.input as Record<string, unknown>;
  assertEquals(finished.state, "dead_letter");
  assertEquals(nextRetryAt(5, 5, now), null);
});

Deno.test("GBP insights sync stores allowlisted totals", async () => {
  const credentialCipher = await cipher();
  const harness = repositoryHarness();
  const google = await connection(credentialCipher, "google_business", {
    accessToken: "google-access-token",
    refreshToken: "google-refresh-token",
    expiresAt: "2026-09-01T00:00:00.000Z",
    scopes: ["scope"],
  }, "accounts/a/locations/location1");
  harness.setPrepared({
    runnable: true,
    reasonCode: null,
    connections: { google_business: google },
  });
  const job = rankJob({
    jobType: "gbp_insights_sync",
    stage: "execute",
    providerTaskId: null,
    credentialSource: null,
    payload: { scheduled_date: "2026-08-11" },
  });
  assertEquals(
    await processIntegrationJob(
      {
        ...dependencyBase(harness.repository, credentialCipher),
        google: {
          refresh: async (token) => token,
          performance: async () => ({
            multiDailyMetricTimeSeries: [
              {
                dailyMetric: "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
                timeSeries: { datedValues: [{ value: "7" }] },
              },
              {
                dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
                timeSeries: { datedValues: [{ value: 11 }] },
              },
              {
                dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
                timeSeries: { datedValues: [{ value: 5 }] },
              },
              {
                dailyMetric: "WEBSITE_CLICKS",
                timeSeries: { datedValues: [{ value: 2 }] },
              },
            ],
          }),
        },
      },
      harness.repository,
      job,
    ),
    "completed",
  );
  const completed = harness.events.find((event) =>
    event.type === "completeInsights"
  )
    ?.input as Record<string, unknown>;
  assertEquals(completed.metrics, {
    searches: 18,
    views: 5,
    websiteClicks: 2,
    calls: 0,
    directionRequests: 0,
  });
});

Deno.test("performance aggregation ignores unknown and negative counts", () => {
  assertEquals(
    performanceTotals({
      multiDailyMetricTimeSeries: [
        {
          dailyMetric: "CALL_CLICKS",
          timeSeries: { datedValues: [{ value: 2 }, { value: "3" }] },
        },
        {
          dailyMetric: "BUSINESS_DIRECTION_REQUESTS",
          timeSeries: { datedValues: [{ value: -1 }, { value: 4 }] },
        },
        {
          dailyMetric: "UNKNOWN_METRIC",
          timeSeries: { datedValues: [{ value: 999 }] },
        },
      ],
    }),
    {
      searches: 0,
      views: 0,
      websiteClicks: 0,
      calls: 5,
      directionRequests: 4,
    },
  );
});
