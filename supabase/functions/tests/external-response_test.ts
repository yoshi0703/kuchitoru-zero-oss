import { readResponseTextWithinLimit } from "../_shared/external-response.ts";
import { assert, assertEquals, assertRejects } from "./assert.ts";

Deno.test("external response rejects an oversized Content-Length before buffering", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("small"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = new Response(body, {
    headers: { "Content-Length": "6" },
  });

  await assertRejects(
    () => readResponseTextWithinLimit(response, 5),
    "PROVIDER_RESPONSE_TOO_LARGE",
  );
  assert(cancelled);
});

Deno.test("external response cancels an unknown-length stream as soon as its byte limit is exceeded", async () => {
  let cancelled = false;
  const chunks = [
    new TextEncoder().encode("abc"),
    new TextEncoder().encode("def"),
  ];
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunks[index++]!);
    },
    cancel() {
      cancelled = true;
    },
  });

  await assertRejects(
    () => readResponseTextWithinLimit(new Response(body), 5),
    "PROVIDER_RESPONSE_TOO_LARGE",
  );
  assert(cancelled);
});

Deno.test("external response accepts an exact UTF-8 byte boundary", async () => {
  const encoded = new TextEncoder().encode("あ");
  const response = new Response(encoded, {
    headers: { "Content-Length": String(encoded.byteLength) },
  });

  assertEquals(
    await readResponseTextWithinLimit(response, encoded.byteLength),
    "あ",
  );
});
