import type {
  CredentialCipher,
  EncryptedCredential,
} from "./ai-credentials.ts";
import type { ProviderName } from "./types.ts";

export type StoredCredential = EncryptedCredential & {
  storeId: string;
  provider: ProviderName;
  model: string;
  keyLast4: string;
};

export interface CredentialRepository {
  getConnection(
    ownerId: string,
    storeId: string,
    provider: ProviderName,
  ): Promise<StoredCredential | null>;
  getActiveConnection(storeId: string): Promise<StoredCredential | null>;
  saveConnection(
    input: StoredCredential & { ownerId: string; activate: boolean },
  ): Promise<unknown>;
  deleteConnection(
    ownerId: string,
    storeId: string,
    provider: ProviderName,
  ): Promise<unknown>;
}

export class CredentialStore {
  readonly #repository: CredentialRepository;
  readonly #cipher: CredentialCipher;

  constructor(repository: CredentialRepository, cipher: CredentialCipher) {
    this.#repository = repository;
    this.#cipher = cipher;
  }

  async encryptForStore(
    apiKey: string,
    storeId: string,
    provider: ProviderName,
  ): Promise<Omit<StoredCredential, "model">> {
    const encrypted = await this.#cipher.encrypt(apiKey, storeId, provider);
    return { ...encrypted, storeId, provider, keyLast4: apiKey.slice(-4) };
  }

  async decrypt(value: StoredCredential): Promise<string> {
    return await this.#cipher.decrypt(value, value.storeId, value.provider);
  }

  async getOwnerCredential(
    ownerId: string,
    storeId: string,
    provider: ProviderName,
  ): Promise<{ value: StoredCredential; apiKey: string } | null> {
    const value = await this.#repository.getConnection(
      ownerId,
      storeId,
      provider,
    );
    return value ? { value, apiKey: await this.decrypt(value) } : null;
  }

  async getActiveCredential(
    storeId: string,
  ): Promise<{ value: StoredCredential; apiKey: string } | null> {
    const value = await this.#repository.getActiveConnection(storeId);
    return value ? { value, apiKey: await this.decrypt(value) } : null;
  }

  async save(
    ownerId: string,
    storeId: string,
    provider: ProviderName,
    model: string,
    apiKey: string,
    activate = true,
  ): Promise<unknown> {
    return await this.#repository.saveConnection({
      ...(await this.encryptForStore(apiKey, storeId, provider)),
      ownerId,
      model,
      activate,
    });
  }

  async delete(
    ownerId: string,
    storeId: string,
    provider: ProviderName,
  ): Promise<unknown> {
    return await this.#repository.deleteConnection(ownerId, storeId, provider);
  }
}
