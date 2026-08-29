const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function decodeBase64(value: string): Uint8Array {
  const compact = value.trim();
  if (!BASE64_PATTERN.test(compact) || compact.length % 4 !== 0) {
    throw new Error("INVALID_BASE64_SECRET");
  }
  let binary: string;
  try {
    binary = atob(compact);
  } catch {
    throw new Error("INVALID_BASE64_SECRET");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

function decodeBase64Url(value: string): Uint8Array {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new Error("INVALID_CIPHERTEXT_ENCODING");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  return decodeBase64(base64);
}

export type EncryptedCredential = {
  ciphertext: string;
  iv: string;
  keyVersion: number;
};

export interface CredentialCipher {
  encrypt(
    apiKey: string,
    storeId: string,
    provider: string,
  ): Promise<EncryptedCredential>;
  decrypt(
    value: EncryptedCredential,
    storeId: string,
    provider: string,
  ): Promise<string>;
}

export class VersionedCredentialCipher implements CredentialCipher {
  readonly #keys: ReadonlyMap<number, CryptoKey>;
  readonly #activeVersion: number;

  private constructor(
    keys: ReadonlyMap<number, CryptoKey>,
    activeVersion: number,
  ) {
    this.#keys = keys;
    this.#activeVersion = activeVersion;
  }

  static async fromBase64Keys(
    keys: ReadonlyMap<number, string>,
    activeVersion: number,
  ): Promise<VersionedCredentialCipher> {
    if (
      !Number.isSafeInteger(activeVersion) || activeVersion <= 0 ||
      !keys.has(activeVersion)
    ) throw new Error("INVALID_ACTIVE_KEY_VERSION");
    const imported = new Map<number, CryptoKey>();
    for (const [version, encoded] of keys) {
      if (!Number.isSafeInteger(version) || version <= 0) {
        throw new Error("INVALID_KEY_VERSION");
      }
      const raw = decodeBase64(encoded);
      if (raw.byteLength !== 32) throw new Error("INVALID_MASTER_KEY_LENGTH");
      imported.set(
        version,
        await crypto.subtle.importKey(
          "raw",
          asArrayBuffer(raw),
          { name: "AES-GCM" },
          false,
          ["encrypt", "decrypt"],
        ),
      );
    }
    return new VersionedCredentialCipher(imported, activeVersion);
  }

  static async fromEnvironment(
    env: Record<string, string | undefined>,
  ): Promise<VersionedCredentialCipher> {
    const activeVersion = Number(env.AI_CREDENTIALS_ACTIVE_KEY_VERSION);
    const keys = new Map<number, string>();
    for (const [name, value] of Object.entries(env)) {
      const match = /^AI_CREDENTIALS_MASTER_KEY_V([1-9][0-9]*)$/.exec(name);
      if (match && value) keys.set(Number(match[1]), value);
    }
    return await VersionedCredentialCipher.fromBase64Keys(keys, activeVersion);
  }

  async encrypt(
    apiKey: string,
    storeId: string,
    provider: string,
  ): Promise<EncryptedCredential> {
    if (apiKey.length < 8 || apiKey.length > 4096) {
      throw new Error("INVALID_PROVIDER_CREDENTIAL");
    }
    if (!/^[a-z][a-z0-9:_-]{1,79}$/.test(provider)) {
      throw new Error("INVALID_CREDENTIAL_DOMAIN");
    }
    const key = this.#keys.get(this.#activeVersion);
    if (!key) throw new Error("ACTIVE_KEY_NOT_FOUND");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const additionalData = encoder.encode(
      `${storeId}:${provider}:${this.#activeVersion}`,
    );
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData, tagLength: 128 },
      key,
      encoder.encode(apiKey),
    );
    return {
      ciphertext: encodeBase64Url(new Uint8Array(encrypted)),
      iv: encodeBase64Url(iv),
      keyVersion: this.#activeVersion,
    };
  }

  async decrypt(
    value: EncryptedCredential,
    storeId: string,
    provider: string,
  ): Promise<string> {
    if (!/^[a-z][a-z0-9:_-]{1,79}$/.test(provider)) {
      throw new Error("INVALID_CREDENTIAL_DOMAIN");
    }
    const key = this.#keys.get(value.keyVersion);
    if (!key) throw new Error("CREDENTIAL_KEY_VERSION_UNAVAILABLE");
    const iv = decodeBase64Url(value.iv);
    if (iv.byteLength !== 12) throw new Error("INVALID_CREDENTIAL_IV");
    const ciphertext = decodeBase64Url(value.ciphertext);
    const additionalData = encoder.encode(
      `${storeId}:${provider}:${value.keyVersion}`,
    );
    try {
      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: asArrayBuffer(iv),
          additionalData,
          tagLength: 128,
        },
        key,
        asArrayBuffer(ciphertext),
      );
      return decoder.decode(decrypted);
    } catch {
      throw new Error("CREDENTIAL_DECRYPTION_FAILED");
    }
  }
}

export class SecretDeriver {
  readonly #sessionKey: CryptoKey;
  readonly #rateLimitKey: CryptoKey;

  private constructor(sessionKey: CryptoKey, rateLimitKey: CryptoKey) {
    this.#sessionKey = sessionKey;
    this.#rateLimitKey = rateLimitKey;
  }

  static async create(
    sessionKeyBase64: string,
    rateLimitKeyBase64: string,
  ): Promise<SecretDeriver> {
    const sessionRaw = decodeBase64(sessionKeyBase64);
    const rateRaw = decodeBase64(rateLimitKeyBase64);
    if (sessionRaw.byteLength < 32 || rateRaw.byteLength < 32) {
      throw new Error("INVALID_HMAC_KEY_LENGTH");
    }
    const algorithm = { name: "HMAC", hash: "SHA-256" } as const;
    return new SecretDeriver(
      await crypto.subtle.importKey(
        "raw",
        asArrayBuffer(sessionRaw),
        algorithm,
        false,
        ["sign"],
      ),
      await crypto.subtle.importKey(
        "raw",
        asArrayBuffer(rateRaw),
        algorithm,
        false,
        ["sign"],
      ),
    );
  }

  async sessionToken(
    sessionId: string,
    idempotencyKey: string,
  ): Promise<string> {
    const signature = await crypto.subtle.sign(
      "HMAC",
      this.#sessionKey,
      encoder.encode(`${sessionId}:${idempotencyKey}`),
    );
    return encodeBase64Url(new Uint8Array(signature));
  }

  async subjectHash(
    domain: "ip-store" | "session",
    subject: string,
  ): Promise<string> {
    const signature = await crypto.subtle.sign(
      "HMAC",
      this.#rateLimitKey,
      encoder.encode(`${domain}:v1:${subject}`),
    );
    return [...new Uint8Array(signature)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  }
}
