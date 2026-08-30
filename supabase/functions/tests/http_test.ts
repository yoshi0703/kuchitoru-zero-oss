import { AppError, readJsonObject } from "../_shared/http.ts";
import { assert, assertEquals } from "./assert.ts";

function context(request: Request): never {
  return {
    req: {
      raw: request,
      header: (name: string) => request.headers.get(name) ?? undefined,
    },
  } as never;
}

Deno.test("JSON body limit cancels a chunked request while receiving it", async () => {
  const encoder = new TextEncoder();
  let cancelled = false;
  let chunk = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunk += 1;
      controller.enqueue(
        encoder.encode(chunk === 1 ? '{"value":"' : "too-large"),
      );
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("http://functions.test/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  try {
    await readJsonObject(context(request), 12);
    throw new Error("expected oversized body rejection");
  } catch (error) {
    assert(error instanceof AppError);
    assertEquals(error.code, "PAYLOAD_TOO_LARGE");
    assertEquals(error.status, 413);
  }
  assertEquals(cancelled, true);
});

Deno.test("JSON body limit counts UTF-8 bytes and returns an object", async () => {
  const request = new Request("http://functions.test/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"name":"花"}',
  });

  assertEquals(await readJsonObject(context(request), 16), { name: "花" });
});
