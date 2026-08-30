import type { EncryptedCredential } from "./ai-credentials.ts";
import type {
  CredentialRepository,
  StoredCredential,
} from "./credential-store.ts";
import type { AiRuntimeRepository } from "./providers.ts";
import { isValidProviderModel } from "./model-catalog.ts";
import type { InterviewContext, JsonObject, ProviderName } from "./types.ts";

type RpcError = { code?: string; message?: string };
type AdminRpcClient = {
  schema(schema: string): {
    rpc(
      name: string,
      params?: JsonObject,
    ): PromiseLike<{ data: unknown; error: RpcError | null }>;
  };
};

function object(value: unknown): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("INVALID_DATABASE_RESPONSE");
  }
  return value as JsonObject;
}

function nullableObject(value: unknown): JsonObject | null {
  return value === null ? null : object(value);
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`INVALID_DATABASE_RESPONSE_${field}`);
  }
  return value;
}

function number(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new Error(`INVALID_DATABASE_RESPONSE_${field}`);
  }
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`INVALID_DATABASE_RESPONSE_${field}`);
  }
  return value;
}

export class SupabaseRepository
  implements CredentialRepository, AiRuntimeRepository {
  readonly #client: AdminRpcClient;

  constructor(client: AdminRpcClient) {
    this.#client = client;
  }

  async rpc<T = unknown>(name: string, params: JsonObject = {}): Promise<T> {
    const { data, error } = await this.#client.schema("api").rpc(name, params);
    if (error) {
      const failure = new Error(error.message ?? "DATABASE_OPERATION_FAILED");
      if (error.code) Object.assign(failure, { code: error.code });
      throw failure;
    }
    return data as T;
  }

  async ownerStores(ownerId: string): Promise<JsonObject[]> {
    const value = await this.rpc("internal_list_owner_stores", {
      p_actor_id: ownerId,
    });
    if (!Array.isArray(value)) {
      throw new Error("INVALID_DATABASE_RESPONSE_OWNER_STORES");
    }
    return value.map(object);
  }

  async ownerStore(
    ownerId: string,
    storeId: string,
  ): Promise<JsonObject | null> {
    return nullableObject(
      await this.rpc("internal_get_owner_store_v2", {
        p_actor_id: ownerId,
        p_store_id: storeId,
      }),
    );
  }

  async ownerSurveyConfig(
    ownerId: string,
    storeId: string,
  ): Promise<JsonObject | null> {
    return nullableObject(
      await this.rpc("internal_get_owner_survey_config_v2", {
        p_actor_id: ownerId,
        p_store_id: storeId,
      }),
    );
  }

  async ownerSurveyRevisions(
    ownerId: string,
    storeId: string,
  ): Promise<JsonObject[]> {
    const value = await this.rpc("internal_get_owner_survey_revisions_v2", {
      p_actor_id: ownerId,
      p_store_id: storeId,
    });
    if (!Array.isArray(value)) {
      throw new Error("INVALID_DATABASE_RESPONSE_SURVEY_REVISIONS");
    }
    return value.map(object);
  }

  async ownerInterviewSurveySnapshots(
    ownerId: string,
    storeId: string,
    sessionIds: string[],
  ): Promise<JsonObject[]> {
    const value = await this.rpc(
      "internal_get_owner_interview_survey_snapshots",
      {
        p_actor_id: ownerId,
        p_store_id: storeId,
        p_session_ids: sessionIds,
      },
    );
    if (!Array.isArray(value)) {
      throw new Error("INVALID_DATABASE_RESPONSE_INTERVIEW_SURVEY_SNAPSHOTS");
    }
    return value.map(object);
  }

  async ownerFeatureCapabilities(
    ownerId: string,
    storeId: string,
    evaluatedAt: string,
  ): Promise<JsonObject[]> {
    const value = await this.rpc("internal_get_zero_feature_capabilities", {
      p_actor_id: ownerId,
      p_store_id: storeId,
      p_evaluated_at: evaluatedAt,
    });
    if (!Array.isArray(value)) {
      throw new Error("INVALID_DATABASE_RESPONSE_ZERO_FEATURE_CAPABILITIES");
    }
    return value.map(object);
  }

  async requireFeature(
    ownerId: string,
    storeId: string,
    featureKey: string,
    evaluatedAt: string,
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_require_zero_feature", {
        p_actor_id: ownerId,
        p_store_id: storeId,
        p_feature_key: featureKey,
        p_evaluated_at: evaluatedAt,
      }),
    );
  }

  async updateSurveyConfig(
    ownerId: string,
    storeId: string,
    surveyConfig: JsonObject,
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_update_survey_config_v2", {
        p_actor_id: ownerId,
        p_store_id: storeId,
        p_survey_config_json: surveyConfig,
      }),
    );
  }

  async claimOwnerOperation(
    input: {
      ownerId: string;
      scope: string;
      keyHash: string;
      requestHash: string;
    },
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_claim_owner_operation", {
        p_owner_id: input.ownerId,
        p_scope: input.scope,
        p_idempotency_key_hash: input.keyHash,
        p_request_hash: input.requestHash,
      }),
    );
  }

  async claimStoreOperation(
    input: {
      ownerId: string;
      storeId: string;
      scope: string;
      keyHash: string;
      requestHash: string;
    },
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_claim_store_operation", {
        p_actor_id: input.ownerId,
        p_store_id: input.storeId,
        p_scope: input.scope,
        p_idempotency_key_hash: input.keyHash,
        p_request_hash: input.requestHash,
      }),
    );
  }

  async completeOwnerOperation(
    operationId: string,
    result: unknown,
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_complete_owner_operation", {
        p_operation_id: operationId,
        p_result_json: result,
      }),
    );
  }

  async purgeOwnerIdempotency(
    ownerId: string,
    keepOperationId: string | null = null,
  ): Promise<number> {
    const value = await this.rpc("internal_purge_owner_idempotency", {
      p_owner_id: ownerId,
      p_keep_operation_id: keepOperationId,
    });
    if (typeof value !== "number") {
      throw new Error("INVALID_DATABASE_RESPONSE_PURGE_COUNT");
    }
    return value;
  }

  async createStore(
    ownerId: string,
    operationId: string,
    input: JsonObject,
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_create_owner_store_once_v2", {
        p_actor_id: ownerId,
        p_operation_id: operationId,
        p_public_slug: input.publicSlug,
        p_name: input.name,
        p_industry: input.industry ?? null,
        p_address: input.address ?? null,
        p_description: input.description ?? null,
        p_website_url: input.websiteUrl ?? null,
        p_icon_path: input.iconPath ?? null,
        p_welcome_message: input.welcomeMessage ?? null,
        p_closing_message: input.closingMessage ?? null,
        p_google_review_url: input.googleReviewUrl ?? null,
        p_google_place_id: input.googlePlaceId ?? null,
      }),
    );
  }

  async updateStore(
    ownerId: string,
    storeId: string,
    input: JsonObject,
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_update_owner_store_v2", {
        p_actor_id: ownerId,
        p_store_id: storeId,
        p_name: input.name,
        p_industry: input.industry ?? null,
        p_address: input.address ?? null,
        p_description: input.description ?? null,
        p_website_url: input.websiteUrl ?? null,
        p_icon_path: input.iconPath ?? null,
        p_welcome_message: input.welcomeMessage ?? null,
        p_closing_message: input.closingMessage ?? null,
        p_google_review_url: input.googleReviewUrl ?? null,
        p_google_place_id: input.googlePlaceId ?? null,
      }),
    );
  }

  async setStoreStatus(
    ownerId: string,
    storeId: string,
    status: "published" | "paused",
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_set_store_status_v2", {
        p_actor_id: ownerId,
        p_store_id: storeId,
        p_status: status,
      }),
    );
  }

  async publicStore(publicSlug: string): Promise<JsonObject | null> {
    return nullableObject(
      await this.rpc("internal_get_public_store", {
        p_public_slug: publicSlug,
      }),
    );
  }

  async aiConnections(ownerId: string, storeId: string): Promise<JsonObject[]> {
    const data = await this.rpc("internal_get_ai_connections_v2", {
      p_actor_id: ownerId,
      p_store_id: storeId,
    });
    if (!Array.isArray(data)) {
      throw new Error("INVALID_DATABASE_RESPONSE_AI_CONNECTIONS");
    }
    return data.map(object);
  }

  #storedCredential(data: JsonObject | null): StoredCredential | null {
    if (!data) return null;
    const provider = string(data.provider, "PROVIDER");
    if (
      provider !== "openai" && provider !== "gemini" &&
      provider !== "deepseek" && provider !== "xai" &&
      provider !== "anthropic"
    ) {
      throw new Error("INVALID_DATABASE_RESPONSE_PROVIDER");
    }
    const model = string(data.model, "MODEL");
    if (!isValidProviderModel(model)) {
      throw new Error("INVALID_DATABASE_RESPONSE_MODEL");
    }
    return {
      storeId: string(data.store_id, "STORE_ID"),
      provider,
      model,
      ciphertext: string(data.credential_ciphertext, "CIPHERTEXT"),
      iv: string(data.credential_iv, "IV"),
      keyVersion: number(data.key_version, "KEY_VERSION"),
      keyLast4: string(data.key_last4, "KEY_LAST4"),
    };
  }

  async getConnection(
    ownerId: string,
    storeId: string,
    provider: ProviderName,
  ): Promise<StoredCredential | null> {
    return this.#storedCredential(
      nullableObject(
        await this.rpc("internal_get_ai_connection_v2", {
          p_actor_id: ownerId,
          p_store_id: storeId,
          p_provider: provider,
        }),
      ),
    );
  }

  async getActiveConnection(storeId: string): Promise<StoredCredential | null> {
    return this.#storedCredential(
      nullableObject(
        await this.rpc("internal_get_active_ai_connection", {
          p_store_id: storeId,
        }),
      ),
    );
  }

  async saveConnection(
    input: StoredCredential & { ownerId: string; activate: boolean },
  ): Promise<unknown> {
    return await this.rpc("internal_upsert_ai_connection_v2", {
      p_actor_id: input.ownerId,
      p_store_id: input.storeId,
      p_provider: input.provider,
      p_credential_ciphertext: input.ciphertext,
      p_credential_iv: input.iv,
      p_key_version: input.keyVersion,
      p_key_last4: input.keyLast4,
      p_model: input.model,
      p_activate: input.activate,
    });
  }

  async markConnection(
    ownerId: string,
    storeId: string,
    provider: ProviderName,
    status: "active" | "invalid" | "revoked" | "error",
    errorCode: string | null,
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_mark_ai_connection_status_v2", {
        p_actor_id: ownerId,
        p_store_id: storeId,
        p_provider: provider,
        p_status: status,
        p_error_code: errorCode,
      }),
    );
  }

  async selectProvider(
    ownerId: string,
    storeId: string,
    provider: ProviderName,
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_select_ai_provider_v2", {
        p_actor_id: ownerId,
        p_store_id: storeId,
        p_provider: provider,
      }),
    );
  }

  async selectModel(
    ownerId: string,
    storeId: string,
    provider: ProviderName,
    model: string,
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_select_ai_model_v2", {
        p_actor_id: ownerId,
        p_store_id: storeId,
        p_provider: provider,
        p_model: model,
      }),
    );
  }

  async deleteConnection(
    ownerId: string,
    storeId: string,
    provider: ProviderName,
  ): Promise<unknown> {
    return await this.rpc("internal_delete_ai_connection_v2", {
      p_actor_id: ownerId,
      p_store_id: storeId,
      p_provider: provider,
    });
  }

  async replaySessionStart(
    input: { storeId: string; keyHash: string; requestHash: string },
  ): Promise<JsonObject | null> {
    return nullableObject(
      await this.rpc("internal_replay_interview_session", {
        p_store_id: input.storeId,
        p_idempotency_key_hash: input.keyHash,
        p_request_hash: input.requestHash,
      }),
    );
  }

  async startSession(input: {
    sessionId: string;
    storeId: string;
    locale: string;
    tokenHash: string;
    ipSubjectHash: string;
    keyHash: string;
    requestHash: string;
    expiresAt: string;
  }): Promise<JsonObject> {
    return object(
      await this.rpc("internal_start_interview_session", {
        p_session_id: input.sessionId,
        p_store_id: input.storeId,
        p_locale: input.locale,
        p_token_hash: input.tokenHash,
        p_ip_subject_hash: input.ipSubjectHash,
        p_idempotency_key_hash: input.keyHash,
        p_request_hash: input.requestHash,
        p_expires_at: input.expiresAt,
      }),
    );
  }

  async bindInterviewSurveyRevision(
    sessionId: string,
    tokenHash: string,
    surveyRevision: number,
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_bind_interview_survey_revision", {
        p_session_id: sessionId,
        p_token_hash: tokenHash,
        p_survey_revision: surveyRevision,
      }),
    );
  }

  async bindInterviewSurveySnapshot(
    sessionId: string,
    tokenHash: string,
    sourceRevision: number,
    selection: JsonObject,
    resolvedConfig: JsonObject,
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_bind_interview_survey_snapshot", {
        p_session_id: sessionId,
        p_token_hash: tokenHash,
        p_source_revision: sourceRevision,
        p_selection_json: selection,
        p_resolved_config_json: resolvedConfig,
      }),
    );
  }

  async interviewSurveyRevision(
    sessionId: string,
    tokenHash: string,
    surveyRevision: number,
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_get_interview_survey_revision", {
        p_session_id: sessionId,
        p_token_hash: tokenHash,
        p_survey_revision: surveyRevision,
      }),
    );
  }

  async interviewSurveySnapshot(
    sessionId: string,
    tokenHash: string,
  ): Promise<JsonObject | null> {
    return nullableObject(
      await this.rpc("internal_get_interview_survey_snapshot", {
        p_session_id: sessionId,
        p_token_hash: tokenHash,
      }),
    );
  }

  async validateSession(
    sessionId: string,
    tokenHash: string,
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_validate_interview_session", {
        p_session_id: sessionId,
        p_token_hash: tokenHash,
      }),
    );
  }

  async sessionResume(
    sessionId: string,
    tokenHash: string,
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_get_interview_resume", {
        p_session_id: sessionId,
        p_token_hash: tokenHash,
      }),
    );
  }

  async claimTurn(input: JsonObject): Promise<JsonObject> {
    return object(await this.rpc("internal_claim_interview_turn", input));
  }

  async completeTurn(
    operationId: string,
    result: {
      text: string;
      provider: ProviderName;
      model: string;
      providerRequestId: string | null;
      requestId: string;
      interviewComplete?: boolean;
    },
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_complete_interview_turn", {
        p_operation_id: operationId,
        p_assistant_text: result.text,
        p_provider: result.provider,
        p_model: result.model,
        p_request_id: result.providerRequestId ?? result.requestId,
        p_is_complete: result.interviewComplete === true,
      }),
    );
  }

  async claimReview(input: JsonObject): Promise<JsonObject> {
    return object(await this.rpc("internal_claim_review_generation", input));
  }

  async completeReview(
    operationId: string,
    result: {
      text: string;
      provider: ProviderName;
      model: string;
      providerRequestId: string | null;
      requestId: string;
    },
  ): Promise<JsonObject> {
    return await this.completeReviewResult(operationId, {
      ...result,
      source: "ai",
    });
  }

  async completeReviewResult(
    operationId: string,
    result: {
      text: string;
      source: "ai" | "template";
      provider?: ProviderName | "kuchitoru_zero";
      model?: string;
      providerRequestId?: string | null;
      requestId?: string;
    },
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_complete_review_result", {
        p_operation_id: operationId,
        p_review_text: result.text,
        p_generation_source: result.source,
        p_provider: result.provider ?? null,
        p_model: result.model ?? null,
        p_request_id: result.providerRequestId ?? result.requestId ?? null,
      }),
    );
  }

  async claimRewrite(input: JsonObject): Promise<JsonObject> {
    return object(await this.rpc("internal_claim_review_rewrite", input));
  }

  async completeRewrite(
    operationId: string,
    result: {
      text: string;
      provider: ProviderName;
      model: string;
      providerRequestId: string | null;
      requestId: string;
    },
  ): Promise<JsonObject> {
    return await this.completeRewriteResult(operationId, {
      ...result,
      source: "ai",
    });
  }

  async completeRewriteResult(
    operationId: string,
    result: {
      text: string;
      source: "ai" | "template";
      provider?: ProviderName | "kuchitoru_zero";
      model?: string;
      providerRequestId?: string | null;
      requestId?: string;
    },
  ): Promise<JsonObject> {
    return object(
      await this.rpc("internal_complete_review_rewrite_result", {
        p_operation_id: operationId,
        p_review_text: result.text,
        p_generation_source: result.source,
        p_provider: result.provider ?? null,
        p_model: result.model ?? null,
        p_request_id: result.providerRequestId ?? result.requestId ?? null,
      }),
    );
  }

  async saveEditedReview(input: JsonObject): Promise<JsonObject> {
    return object(await this.rpc("internal_save_edited_review", input));
  }

  async recordHandoff(input: JsonObject): Promise<JsonObject> {
    return object(await this.rpc("internal_record_handoff", input));
  }

  async failOperation(operationId: string, errorCode: string): Promise<void> {
    await this.rpc("internal_fail_operation", {
      p_operation_id: operationId,
      p_error_code: errorCode,
    });
  }

  async operationResult(operationId: string): Promise<JsonObject> {
    return object(
      await this.rpc("internal_get_operation_result", {
        p_operation_id: operationId,
      }),
    );
  }

  async getInterviewContext(
    storeId: string,
    sessionId: string,
  ): Promise<InterviewContext> {
    const data = object(
      await this.rpc("internal_get_interview_context", {
        p_store_id: storeId,
        p_session_id: sessionId,
      }),
    );
    const rawMessages = data.messages;
    if (!Array.isArray(rawMessages)) {
      throw new Error("INVALID_DATABASE_RESPONSE_MESSAGES");
    }
    return {
      storeId,
      sessionId,
      storeName: string(data.store_name, "STORE_NAME"),
      industry: typeof data.industry === "string" ? data.industry : null,
      locale: data.locale === "en" ? "en" : "ja",
      rating: typeof data.rating === "number" ? data.rating : null,
      visitFrequency: typeof data.visit_frequency === "string"
        ? data.visit_frequency
        : null,
      structuredAnswers: data.structured_answers_json !== null &&
          !Array.isArray(data.structured_answers_json) &&
          typeof data.structured_answers_json === "object"
        ? data.structured_answers_json as JsonObject
        : {},
      surveyConfig: data.survey_config_json !== null &&
          !Array.isArray(data.survey_config_json) &&
          typeof data.survey_config_json === "object"
        ? data.survey_config_json as JsonObject
        : null,
      currentReview: typeof data.current_review === "string"
        ? data.current_review
        : null,
      messages: rawMessages.map((entry) => {
        const message = object(entry);
        const role = string(message.role, "MESSAGE_ROLE");
        if (role !== "user" && role !== "assistant") {
          throw new Error("INVALID_DATABASE_RESPONSE_MESSAGE_ROLE");
        }
        return {
          role,
          content: string(message.content, "MESSAGE_CONTENT"),
          sequence: number(message.sequence, "MESSAGE_SEQUENCE"),
        };
      }),
    };
  }
}

export function encryptedCredentialFrom(data: JsonObject): EncryptedCredential {
  return {
    ciphertext: string(data.credential_ciphertext, "CIPHERTEXT"),
    iv: string(data.credential_iv, "IV"),
    keyVersion: number(data.key_version, "KEY_VERSION"),
  };
}

export const dbValue = { object, string, number, boolean };
