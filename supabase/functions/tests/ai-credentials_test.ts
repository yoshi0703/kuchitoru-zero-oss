import {
  SecretDeriver,
  VersionedCredentialCipher,
} from "../_shared/ai-credentials.ts";
import { assert, assertEquals, assertRejects } from "./assert.ts";

function base64(byte: number): string {
  return btoa(String.fromCharCode(...new Array(32).fill(byte)));
}

Deno.test("AES-GCM credential ring binds store, provider, and key version", async () => {
  const ring = await VersionedCredentialCipher.fromBase64Keys(
    new Map([[1, base64(1)], [2, base64(2)]]),
    2,
  );
  const value = await ring.encrypt(
    "sk-test-never-real-1234",
    "11111111-1111-4111-8111-111111111111",
    "openai",
  );
  assertEquals(value.keyVersion, 2);
  assertEquals(
    await ring.decrypt(value, "11111111-1111-4111-8111-111111111111", "openai"),
    "sk-test-never-real-1234",
  );
  await assertRejects(
    () => ring.decrypt(value, "22222222-2222-4222-8222-222222222222", "openai"),
    "CREDENTIAL_DECRYPTION_FAILED",
  );
  await assertRejects(
    () => ring.decrypt(value, "11111111-1111-4111-8111-111111111111", "gemini"),
    "CREDENTIAL_DECRYPTION_FAILED",
  );
  const tampered = {
    ...value,
    ciphertext: `${value.ciphertext.slice(0, -1)}${
      value.ciphertext.endsWith("A") ? "B" : "A"
    }`,
  };
  await assertRejects(
    () =>
      ring.decrypt(tampered, "11111111-1111-4111-8111-111111111111", "openai"),
    "CREDENTIAL_DECRYPTION_FAILED",
  );
});

Deno.test("credential ring decrypts old keys while new writes use active key", async () => {
  const oldRing = await VersionedCredentialCipher.fromBase64Keys(
    new Map([[1, base64(3)]]),
    1,
  );
  const oldValue = await oldRing.encrypt(
    "old-provider-key-0001",
    "11111111-1111-4111-8111-111111111111",
    "gemini",
  );
  const rotating = await VersionedCredentialCipher.fromBase64Keys(
    new Map([[1, base64(3)], [2, base64(4)]]),
    2,
  );
  assertEquals(
    await rotating.decrypt(
      oldValue,
      "11111111-1111-4111-8111-111111111111",
      "gemini",
    ),
    "old-provider-key-0001",
  );
  assertEquals(
    (await rotating.encrypt(
      "new-provider-key-0002",
      "11111111-1111-4111-8111-111111111111",
      "gemini",
    )).keyVersion,
    2,
  );
});

Deno.test("expanded provider credentials remain provider-domain separated", async () => {
  const ring = await VersionedCredentialCipher.fromBase64Keys(
    new Map([[1, base64(5)]]),
    1,
  );
  const deepseek = await ring.encrypt(
    "deepseek-test-key-1234",
    "11111111-1111-4111-8111-111111111111",
    "deepseek",
  );
  assertEquals(
    await ring.decrypt(
      deepseek,
      "11111111-1111-4111-8111-111111111111",
      "deepseek",
    ),
    "deepseek-test-key-1234",
  );
  await assertRejects(
    () =>
      ring.decrypt(
        deepseek,
        "11111111-1111-4111-8111-111111111111",
        "xai",
      ),
    "CREDENTIAL_DECRYPTION_FAILED",
  );

  const anthropic = await ring.encrypt(
    "anthropic-test-key-1234",
    "11111111-1111-4111-8111-111111111111",
    "anthropic",
  );
  assertEquals(
    await ring.decrypt(
      anthropic,
      "11111111-1111-4111-8111-111111111111",
      "anthropic",
    ),
    "anthropic-test-key-1234",
  );
  await assertRejects(
    () =>
      ring.decrypt(
        anthropic,
        "11111111-1111-4111-8111-111111111111",
        "openai",
      ),
    "CREDENTIAL_DECRYPTION_FAILED",
  );
});

Deno.test("credential and HMAC secrets reject short decoded keys", async () => {
  await assertRejects(
    () =>
      VersionedCredentialCipher.fromBase64Keys(
        new Map([[1, btoa("short")]]),
        1,
      ),
    "INVALID_MASTER_KEY_LENGTH",
  );
  await assertRejects(
    () => SecretDeriver.create(btoa("short"), base64(1)),
    "INVALID_HMAC_KEY_LENGTH",
  );
});

Deno.test("session tokens are deterministic and rate subjects are domain separated", async () => {
  const deriver = await SecretDeriver.create(base64(7), base64(8));
  const first = await deriver.sessionToken(
    "11111111-1111-4111-8111-111111111111",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  const second = await deriver.sessionToken(
    "11111111-1111-4111-8111-111111111111",
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  assertEquals(first, second);
  assert(/^[A-Za-z0-9_-]{43}$/.test(first));
  assert(
    (await deriver.subjectHash("ip-store", "same")) !==
      (await deriver.subjectHash("session", "same")),
  );
});
