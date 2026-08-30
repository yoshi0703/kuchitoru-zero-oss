import type { CredentialCipher } from "../../_shared/ai-credentials.ts";
import type { StoredCredential } from "../../_shared/credential-store.ts";
import type { ProviderName } from "../../_shared/types.ts";

const CREDENTIAL_UNREADABLE_ERRORS = new Set([
  "CREDENTIAL_KEY_VERSION_UNAVAILABLE",
  "INVALID_CIPHERTEXT_ENCODING",
  "INVALID_BASE64_SECRET",
  "INVALID_CREDENTIAL_IV",
  "CREDENTIAL_DECRYPTION_FAILED",
]);

export type GenerationUnavailableReason =
  | "byok_not_configured"
  | "byok_credential_unreadable";

export type RuntimeCredential = {
  apiKey: string;
  value: { provider: ProviderName; model: string };
};

export type ResolvedGeneration =
  | {
    decision: {
      kind: "ai";
      source: "byok";
      provider: ProviderName;
      model: string;
    };
    credential: RuntimeCredential;
  }
  | {
    decision: {
      kind: "unavailable";
      reason: GenerationUnavailableReason;
    };
  };

type GenerationDependencies = {
  credentialCipher: CredentialCipher;
};

type GenerationRepository = {
  getActiveConnection?(storeId: string): Promise<StoredCredential | null>;
};

export async function resolveGenerationDecision(
  dependencies: GenerationDependencies,
  repository: GenerationRepository,
  _operationId: string,
  _sessionId: string,
  storeId: string,
  _operation: "review" | "rewrite",
): Promise<ResolvedGeneration> {
  if (typeof repository.getActiveConnection !== "function") {
    throw new Error("INVALID_BYOK_CREDENTIAL_REPOSITORY");
  }

  let credential: RuntimeCredential | null;
  try {
    const stored = await repository.getActiveConnection(storeId);
    credential = stored
      ? {
        value: stored,
        apiKey: await dependencies.credentialCipher.decrypt(
          stored,
          stored.storeId,
          stored.provider,
        ),
      }
      : null;
  } catch (error) {
    if (
      error instanceof Error && CREDENTIAL_UNREADABLE_ERRORS.has(error.message)
    ) {
      return {
        decision: { kind: "unavailable", reason: "byok_credential_unreadable" },
      };
    }
    throw error;
  }

  if (!credential) {
    return {
      decision: { kind: "unavailable", reason: "byok_not_configured" },
    };
  }

  return {
    decision: {
      kind: "ai",
      source: "byok",
      provider: credential.value.provider,
      model: credential.value.model,
    },
    credential,
  };
}
