import type { EncryptedCredential } from "./ai-credentials.ts";
import type { SupabaseRepository } from "./supabase.ts";
import type { JsonObject } from "./types.ts";
import type {
  ExternalProvider,
  StoredExternalCredential,
} from "./meo-provider.ts";

function record(value: unknown, code: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(code);
  }
  return value as JsonObject;
}

function records(value: unknown, code: string): JsonObject[] {
  if (!Array.isArray(value)) throw new Error(code);
  return value.map((row) => record(row, code));
}

export class MeoRepository {
  readonly #base: SupabaseRepository;

  constructor(base: SupabaseRepository) {
    this.#base = base;
  }

  async requireFeature(
    actorId: string,
    storeId: string,
    featureKey: string,
  ): Promise<JsonObject> {
    return record(
      await this.#base.requireFeature(
        actorId,
        storeId,
        featureKey,
        new Date().toISOString(),
      ),
      "INVALID_FEATURE_GATE_RESPONSE",
    );
  }

  async reserveProviderCall(input: {
    actorId: string;
    storeId: string;
    keyHash: string;
    requestHash: string;
    service:
      | "dataforseo_api"
      | "google_business_api"
      | "instagram_graph_api";
    operation: string;
    credentialSource: "native" | "owner_provider";
    windowSeconds: number;
    storeWindowLimit: number;
    globalWindowLimit: number;
    storeDailyLimit: number;
    globalDailyLimit: number;
  }): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_reserve_provider_call", {
        p_actor_id: input.actorId,
        p_store_id: input.storeId,
        p_key_hash: input.keyHash,
        p_request_hash: input.requestHash,
        p_service: input.service,
        p_operation: input.operation,
        p_credential_source: input.credentialSource,
        p_window_seconds: input.windowSeconds,
        p_store_window_limit: input.storeWindowLimit,
        p_global_window_limit: input.globalWindowLimit,
        p_store_daily_limit: input.storeDailyLimit,
        p_global_daily_limit: input.globalDailyLimit,
      }),
      "INVALID_PROVIDER_CALL_RESERVATION_RESPONSE",
    );
  }

  async settleProviderCall(input: {
    reservationId: string;
    outcome: "success" | "failed" | "attention_required";
    safeErrorCode: string | null;
  }): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_settle_provider_call", {
        p_reservation_id: input.reservationId,
        p_outcome: input.outcome,
        p_safe_error_code: input.safeErrorCode,
      }),
      "INVALID_PROVIDER_CALL_SETTLEMENT_RESPONSE",
    );
  }

  async claimHealthDiagnosis(input: {
    actorId: string;
    storeId: string;
    keyHash: string;
    requestHash: string;
    windowSeconds: number;
    storeWindowLimit: number;
    globalWindowLimit: number;
    storeDailyLimit: number;
    globalDailyLimit: number;
  }): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_claim_health_diagnosis", {
        p_actor_id: input.actorId,
        p_store_id: input.storeId,
        p_key_hash: input.keyHash,
        p_request_hash: input.requestHash,
        p_window_seconds: input.windowSeconds,
        p_store_window_limit: input.storeWindowLimit,
        p_global_window_limit: input.globalWindowLimit,
        p_store_daily_limit: input.storeDailyLimit,
        p_global_daily_limit: input.globalDailyLimit,
      }),
      "INVALID_HEALTH_DIAGNOSIS_CLAIM_RESPONSE",
    );
  }

  async settleHealthDiagnosis(input: {
    operationId: string;
    outcome: "success" | "failed" | "attention_required";
    safeErrorCode: string | null;
    result?: JsonObject | null;
  }): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_settle_health_diagnosis", {
        p_operation_id: input.operationId,
        p_outcome: input.outcome,
        p_safe_error_code: input.safeErrorCode,
        p_result: input.result ?? null,
      }),
      "INVALID_HEALTH_DIAGNOSIS_SETTLEMENT_RESPONSE",
    );
  }

  async saveManualHealthDiagnosis(input: {
    actorId: string;
    storeId: string;
    keyHash: string;
    requestHash: string;
    result: JsonObject;
  }): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_save_manual_health_diagnosis", {
        p_actor_id: input.actorId,
        p_store_id: input.storeId,
        p_key_hash: input.keyHash,
        p_request_hash: input.requestHash,
        p_result: input.result,
      }),
      "INVALID_MANUAL_HEALTH_DIAGNOSIS_RESPONSE",
    );
  }

  async latestHealthResult(
    actorId: string,
    storeId: string,
  ): Promise<JsonObject | null> {
    const value = await this.#base.rpc(
      "internal_meo_get_latest_health_result",
      {
        p_actor_id: actorId,
        p_store_id: storeId,
      },
    );
    return value === null
      ? null
      : record(value, "INVALID_LATEST_HEALTH_RESULT_RESPONSE");
  }

  async createOauthState(input: {
    actorId: string;
    storeId: string;
    provider: ExternalProvider;
    stateHash: string;
    browserChallenge: string;
    returnPath: string;
    expiresAt: string;
  }): Promise<void> {
    await this.#base.rpc("internal_meo_create_oauth_state", {
      p_actor_id: input.actorId,
      p_store_id: input.storeId,
      p_provider: input.provider,
      p_state_hash: input.stateHash,
      p_browser_challenge: input.browserChallenge,
      p_return_path: input.returnPath,
      p_expires_at: input.expiresAt,
    });
  }

  async prepareOauthCallback(input: {
    provider: ExternalProvider;
    stateHash: string;
  }): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_prepare_oauth_callback", {
        p_provider: input.provider,
        p_state_hash: input.stateHash,
      }),
      "INVALID_OAUTH_STATE_RESPONSE",
    );
  }

  async consumeOauthState(input: {
    actorId: string;
    storeId: string;
    provider: ExternalProvider;
    stateHash: string;
    browserChallenge: string;
  }): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_consume_oauth_state", {
        p_actor_id: input.actorId,
        p_store_id: input.storeId,
        p_provider: input.provider,
        p_state_hash: input.stateHash,
        p_browser_challenge: input.browserChallenge,
      }),
      "INVALID_OAUTH_STATE_RESPONSE",
    );
  }

  async connections(actorId: string, storeId: string): Promise<JsonObject[]> {
    return records(
      await this.#base.rpc("internal_meo_get_connections", {
        p_actor_id: actorId,
        p_store_id: storeId,
      }),
      "INVALID_CONNECTIONS_RESPONSE",
    );
  }

  async connection(
    actorId: string,
    storeId: string,
    provider: ExternalProvider,
  ): Promise<(StoredExternalCredential & JsonObject) | null> {
    const value = await this.#base.rpc("internal_meo_get_connection", {
      p_actor_id: actorId,
      p_store_id: storeId,
      p_provider: provider,
    });
    if (value === null) return null;
    const row = record(value, "INVALID_CONNECTION_RESPONSE");
    if (
      typeof row.credential_ciphertext !== "string" ||
      typeof row.credential_iv !== "string" ||
      typeof row.key_version !== "number"
    ) throw new Error("INVALID_CONNECTION_SECRET");
    return {
      ...row,
      provider,
      ciphertext: row.credential_ciphertext,
      iv: row.credential_iv,
      keyVersion: row.key_version,
    } as StoredExternalCredential & JsonObject;
  }

  async saveConnection(input: {
    actorId: string;
    storeId: string;
    provider: ExternalProvider;
    encrypted: EncryptedCredential;
    expiresAt: string | null;
    externalAccountId: string | null;
    locationName: string | null;
    displayName: string | null;
  }): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_upsert_connection", {
        p_actor_id: input.actorId,
        p_store_id: input.storeId,
        p_provider: input.provider,
        p_credential_ciphertext: input.encrypted.ciphertext,
        p_credential_iv: input.encrypted.iv,
        p_key_version: input.encrypted.keyVersion,
        p_expires_at: input.expiresAt,
        p_external_account_id: input.externalAccountId,
        p_location_name: input.locationName,
        p_display_name: input.displayName,
      }),
      "INVALID_CONNECTION_SAVE_RESPONSE",
    );
  }

  async selectGoogleLocation(
    actorId: string,
    storeId: string,
    locationName: string,
    displayName: string,
  ): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_select_google_location", {
        p_actor_id: actorId,
        p_store_id: storeId,
        p_location_name: locationName,
        p_display_name: displayName,
      }),
      "INVALID_CONNECTION_SAVE_RESPONSE",
    );
  }

  async deleteConnection(
    actorId: string,
    storeId: string,
    provider: ExternalProvider,
  ): Promise<void> {
    await this.#base.rpc("internal_meo_delete_connection", {
      p_actor_id: actorId,
      p_store_id: storeId,
      p_provider: provider,
    });
  }

  async externalWriteSettings(
    actorId: string,
    storeId: string,
  ): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_get_external_write_settings", {
        p_actor_id: actorId,
        p_store_id: storeId,
      }),
      "INVALID_EXTERNAL_WRITE_SETTINGS_RESPONSE",
    );
  }

  async setExternalWrites(input: {
    actorId: string;
    storeId: string;
    enabled: boolean;
  }): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_set_external_writes", {
        p_actor_id: input.actorId,
        p_store_id: input.storeId,
        p_enabled: input.enabled,
      }),
      "INVALID_EXTERNAL_WRITE_SETTINGS_RESPONSE",
    );
  }

  async updateCredential(input: {
    actorId: string;
    storeId: string;
    provider: ExternalProvider;
    encrypted: EncryptedCredential;
    expiresAt: string;
  }): Promise<void> {
    await this.#base.rpc("internal_meo_refresh_connection", {
      p_actor_id: input.actorId,
      p_store_id: input.storeId,
      p_provider: input.provider,
      p_credential_ciphertext: input.encrypted.ciphertext,
      p_credential_iv: input.encrypted.iv,
      p_key_version: input.encrypted.keyVersion,
      p_expires_at: input.expiresAt,
    });
  }

  async claimExternalAction(input: {
    actorId: string;
    storeId: string;
    action: "review_reply" | "gbp_post";
    keyHash: string;
    requestHash: string;
  }): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_claim_external_action", {
        p_actor_id: input.actorId,
        p_store_id: input.storeId,
        p_action: input.action,
        p_key_hash: input.keyHash,
        p_request_hash: input.requestHash,
      }),
      "INVALID_ACTION_CLAIM_RESPONSE",
    );
  }

  async completeExternalAction(
    operationId: string,
    result: JsonObject,
  ): Promise<void> {
    await this.#base.rpc("internal_meo_complete_external_action", {
      p_operation_id: operationId,
      p_result: result,
    });
  }

  async failExternalAction(operationId: string, code: string): Promise<void> {
    await this.#base.rpc("internal_meo_fail_external_action", {
      p_operation_id: operationId,
      p_error_code: code,
    });
  }

  async attentionExternalAction(
    operationId: string,
    code: string,
  ): Promise<void> {
    await this.#base.rpc("internal_meo_attention_external_action", {
      p_operation_id: operationId,
      p_error_code: code,
    });
  }

  async reserveAiDraft(input: {
    actorId: string;
    storeId: string;
    keyHash: string;
    requestHash: string;
    credentialSource: "owner_provider";
    dailyStoreLimit: number;
    dailyGlobalLimit: number;
  }): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_reserve_ai_draft", {
        p_actor_id: input.actorId,
        p_store_id: input.storeId,
        p_key_hash: input.keyHash,
        p_request_hash: input.requestHash,
        p_credential_source: input.credentialSource,
        p_daily_store_limit: input.dailyStoreLimit,
        p_daily_global_limit: input.dailyGlobalLimit,
      }),
      "INVALID_AI_DRAFT_RESERVATION_RESPONSE",
    );
  }

  async settleAiDraft(input: {
    reservationId: string;
    outcome: "success" | "failed";
    credentialSource: "owner_provider";
    provider: string;
    model: string;
    safeErrorCode: string | null;
    result: JsonObject | null;
  }): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_settle_ai_draft", {
        p_reservation_id: input.reservationId,
        p_outcome: input.outcome,
        p_credential_source: input.credentialSource,
        p_provider: input.provider,
        p_model: input.model,
        p_safe_error_code: input.safeErrorCode,
        p_result_json: input.result,
      }),
      "INVALID_AI_DRAFT_SETTLEMENT_RESPONSE",
    );
  }

  async saveManualRank(input: {
    actorId: string;
    storeId: string;
    keyword: string;
    targetPlaceId: string;
    position: number | null;
    observedAt: string;
  }): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_save_manual_rank", {
        p_actor_id: input.actorId,
        p_store_id: input.storeId,
        p_keyword: input.keyword,
        p_target_place_id: input.targetPlaceId,
        p_position: input.position,
        p_observed_at: input.observedAt,
      }),
      "INVALID_RANK_SAVE_RESPONSE",
    );
  }

  async rankHistory(actorId: string, storeId: string): Promise<JsonObject[]> {
    return records(
      await this.#base.rpc("internal_meo_rank_history", {
        p_actor_id: actorId,
        p_store_id: storeId,
      }),
      "INVALID_RANK_HISTORY_RESPONSE",
    );
  }

  async reserveRankMeasurement(input: {
    actorId: string;
    storeId: string;
    keyHash: string;
    requestHash: string;
    storeDailyLimit: number;
    globalDailyLimit: number;
    keyword: string;
    targetPlaceId: string;
    competitorPlaceIds: string[];
    credentialSource: "owner_provider";
  }): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_reserve_rank_measurement", {
        p_actor_id: input.actorId,
        p_store_id: input.storeId,
        p_key_hash: input.keyHash,
        p_request_hash: input.requestHash,
        p_store_daily_limit: input.storeDailyLimit,
        p_global_daily_limit: input.globalDailyLimit,
        p_keyword: input.keyword,
        p_target_place_id: input.targetPlaceId,
        p_competitor_place_ids: input.competitorPlaceIds,
        p_location_code: null,
        p_language_code: "ja",
        p_device: "desktop",
        p_credential_source: input.credentialSource,
      }),
      "INVALID_RANK_RESERVATION_RESPONSE",
    );
  }

  async markRankSubmitted(input: {
    jobId: string;
    actorId: string;
    storeId: string;
    providerTaskId: string;
  }): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_mark_rank_submitted", {
        p_job_id: input.jobId,
        p_actor_id: input.actorId,
        p_store_id: input.storeId,
        p_provider_task_id: input.providerTaskId,
      }),
      "INVALID_RANK_JOB_RESPONSE",
    );
  }

  async failRankMeasurement(
    jobId: string,
    code: string,
    outcomeAmbiguous = true,
  ): Promise<void> {
    await this.#base.rpc("internal_meo_fail_rank_measurement", {
      p_job_id: jobId,
      p_error_code: code,
      p_outcome_ambiguous: outcomeAmbiguous,
      p_retry_at: null,
    });
  }

  async saveInsights(input: {
    actorId: string;
    storeId: string;
    periodStart: string;
    periodEnd: string;
    source: "manual" | "google_business";
    metrics: JsonObject;
  }): Promise<JsonObject> {
    return record(
      await this.#base.rpc("internal_meo_save_insights", {
        p_actor_id: input.actorId,
        p_store_id: input.storeId,
        p_period_start: input.periodStart,
        p_period_end: input.periodEnd,
        p_source: input.source,
        p_metrics: input.metrics,
      }),
      "INVALID_INSIGHTS_SAVE_RESPONSE",
    );
  }

  async insightHistory(
    actorId: string,
    storeId: string,
  ): Promise<JsonObject[]> {
    return records(
      await this.#base.rpc("internal_meo_insight_history", {
        p_actor_id: actorId,
        p_store_id: storeId,
      }),
      "INVALID_INSIGHTS_HISTORY_RESPONSE",
    );
  }
}
