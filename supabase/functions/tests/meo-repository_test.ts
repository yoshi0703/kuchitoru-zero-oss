import { MeoRepository } from "../_shared/meo-repository.ts";
import type { JsonObject } from "../_shared/types.ts";
import { assertEquals } from "./assert.ts";

function repositoryHarness(responses: Record<string, unknown>) {
  const calls: Array<{ name: string; params: JsonObject }> = [];
  const repository = new MeoRepository({
    rpc: <T>(name: string, params: JsonObject = {}) => {
      calls.push({ name, params });
      return Promise.resolve(responses[name] as T);
    },
  } as never);
  return { calls, repository };
}

Deno.test("rank reservation uses the exact SQL RPC contract without persisting precise coordinates", async () => {
  const { calls, repository } = repositoryHarness({
    internal_meo_reserve_rank_measurement: {
      authorized: true,
      dispatch_authorized: true,
    },
  });
  await repository.reserveRankMeasurement({
    actorId: "11111111-1111-4111-8111-111111111111",
    storeId: "22222222-2222-4222-8222-222222222222",
    keyHash: "a".repeat(64),
    requestHash: "b".repeat(64),
    storeDailyLimit: 1,
    globalDailyLimit: 10_000,
    keyword: "新宿 カフェ",
    targetPlaceId: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    competitorPlaceIds: [],
    credentialSource: "owner_provider",
  });
  assertEquals(calls, [{
    name: "internal_meo_reserve_rank_measurement",
    params: {
      p_actor_id: "11111111-1111-4111-8111-111111111111",
      p_store_id: "22222222-2222-4222-8222-222222222222",
      p_key_hash: "a".repeat(64),
      p_request_hash: "b".repeat(64),
      p_store_daily_limit: 1,
      p_global_daily_limit: 10_000,
      p_keyword: "新宿 カフェ",
      p_target_place_id: "ChIJN1t_tDeuEmsRUsoyG83frY4",
      p_competitor_place_ids: [],
      p_location_code: null,
      p_language_code: "ja",
      p_device: "desktop",
      p_credential_source: "owner_provider",
    },
  }]);
});

Deno.test("OAuth state repository requires the browser challenge at create and consume", async () => {
  const { calls, repository } = repositoryHarness({
    internal_meo_create_oauth_state: null,
    internal_meo_consume_oauth_state: {
      actor_id: "11111111-1111-4111-8111-111111111111",
    },
  });
  const actorId = "11111111-1111-4111-8111-111111111111";
  const storeId = "22222222-2222-4222-8222-222222222222";
  const challenge = "c".repeat(43);
  await repository.createOauthState({
    actorId,
    storeId,
    provider: "google_business",
    stateHash: "d".repeat(64),
    browserChallenge: challenge,
    returnPath: `/dashboard/stores/${storeId}/connections`,
    expiresAt: "2026-08-11T04:10:00.000Z",
  });
  await repository.consumeOauthState({
    actorId,
    storeId,
    provider: "google_business",
    stateHash: "d".repeat(64),
    browserChallenge: challenge,
  });
  assertEquals(calls.map((call) => [call.name, call.params]), [
    ["internal_meo_create_oauth_state", {
      p_actor_id: actorId,
      p_store_id: storeId,
      p_provider: "google_business",
      p_state_hash: "d".repeat(64),
      p_browser_challenge: challenge,
      p_return_path: `/dashboard/stores/${storeId}/connections`,
      p_expires_at: "2026-08-11T04:10:00.000Z",
    }],
    ["internal_meo_consume_oauth_state", {
      p_actor_id: actorId,
      p_store_id: storeId,
      p_provider: "google_business",
      p_state_hash: "d".repeat(64),
      p_browser_challenge: challenge,
    }],
  ]);
});
