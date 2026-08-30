import { CloudflareTurnstileVerifier } from "../_shared/turnstile.ts";
import { assertEquals, assertRejects } from "./assert.ts";

const loopbackOrigins = new Set(["http://127.0.0.1:4174"]);

Deno.test("Turnstile keeps the production Siteverify endpoint immutable by default", async () => {
  let requestedUrl = "";
  const verifier = CloudflareTurnstileVerifier.fromEnvironment(
    { TURNSTILE_SECRET_KEY: "production-fixture" },
    new Set(["https://app.kuchitoru.example"]),
    ((input: string | URL | Request) => {
      requestedUrl = String(input);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            hostname: "app.kuchitoru.example",
            action: "interview_start",
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch,
  );
  assertEquals(
    await verifier.verify({
      token: "token",
      remoteIp: "203.0.113.10",
      siteverifyIdempotencyKey: crypto.randomUUID(),
      expectedHostname: "app.kuchitoru.example",
    }),
    true,
  );
  assertEquals(
    requestedUrl,
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  );
});

Deno.test("Turnstile validates the action selected by each public form", async () => {
  const verifier = CloudflareTurnstileVerifier.fromEnvironment(
    { TURNSTILE_SECRET_KEY: "production-fixture" },
    new Set(["https://app.kuchitoru.example"]),
    (() =>
      Promise.resolve(
        Response.json({
          success: true,
          hostname: "app.kuchitoru.example",
          action: "contact_submit",
        }),
      )) as typeof fetch,
  );
  assertEquals(
    await verifier.verify({
      token: "contact-token",
      remoteIp: "203.0.113.10",
      siteverifyIdempotencyKey: crypto.randomUUID(),
      expectedHostname: "app.kuchitoru.example",
      expectedAction: "contact_submit",
    }),
    true,
  );
});

Deno.test("Turnstile local Siteverify override requires explicit flag and loopback origins", async () => {
  const localUrl = "http://host.docker.internal:4175/turnstile/v0/siteverify";
  await assertRejects(
    () =>
      CloudflareTurnstileVerifier.fromEnvironment({
        SUPABASE_URL: "http://127.0.0.1:56321",
        TURNSTILE_SECRET_KEY: "local-fixture",
        TURNSTILE_SITEVERIFY_URL: localUrl,
      }, loopbackOrigins),
    "LOCAL_TURNSTILE_OVERRIDE_FORBIDDEN",
  );
  await assertRejects(
    () =>
      CloudflareTurnstileVerifier.fromEnvironment({
        KUCHITORU_LOCAL_INTEGRATION: "1",
        SUPABASE_URL: "http://127.0.0.1:56321",
        TURNSTILE_SECRET_KEY: "local-fixture",
        TURNSTILE_SITEVERIFY_URL: localUrl,
      }, new Set(["https://app.kuchitoru.example"])),
    "LOCAL_TURNSTILE_OVERRIDE_FORBIDDEN",
  );
});

Deno.test("Turnstile local Siteverify override rejects non-local and credentialed URLs", async () => {
  for (
    const url of [
      "https://evil.example/turnstile",
      "http://user:pass@127.0.0.1:4175/turnstile",
      "file:///tmp/siteverify",
    ]
  ) {
    await assertRejects(
      () =>
        CloudflareTurnstileVerifier.fromEnvironment({
          KUCHITORU_LOCAL_INTEGRATION: "1",
          SUPABASE_URL: "http://127.0.0.1:56321",
          TURNSTILE_SECRET_KEY: "local-fixture",
          TURNSTILE_SITEVERIFY_URL: url,
        }, loopbackOrigins),
      "INVALID_LOCAL_TURNSTILE_SITEVERIFY_URL",
    );
  }
});

Deno.test("Turnstile local Siteverify override performs the normal verification request", async () => {
  let requestedUrl = "";
  let requestBody = "";
  const verifier = CloudflareTurnstileVerifier.fromEnvironment(
    {
      KUCHITORU_LOCAL_INTEGRATION: "1",
      SUPABASE_URL: "http://kong:8000",
      TURNSTILE_SECRET_KEY: "local-fixture",
      TURNSTILE_SITEVERIFY_URL:
        "http://host.docker.internal:4175/turnstile/v0/siteverify",
    },
    loopbackOrigins,
    ((input: string | URL | Request, init?: RequestInit) => {
      requestedUrl = String(input);
      requestBody = String(init?.body ?? "");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            hostname: "127.0.0.1",
            action: "interview_start",
          }),
          { status: 200 },
        ),
      );
    }) as typeof fetch,
  );

  assertEquals(
    await verifier.verify({
      token: "single-use-local-token",
      remoteIp: "127.0.0.1",
      siteverifyIdempotencyKey: "00000000-0000-4000-8000-000000000001",
      expectedHostname: "127.0.0.1",
    }),
    true,
  );
  assertEquals(
    requestedUrl,
    "http://host.docker.internal:4175/turnstile/v0/siteverify",
  );
  const form = new URLSearchParams(requestBody);
  assertEquals(form.get("secret"), "local-fixture");
  assertEquals(form.get("response"), "single-use-local-token");
  assertEquals(form.get("remoteip"), "127.0.0.1");
});

Deno.test("Turnstile local override rejects a hosted Supabase URL", async () => {
  await assertRejects(
    () =>
      CloudflareTurnstileVerifier.fromEnvironment({
        KUCHITORU_LOCAL_INTEGRATION: "1",
        SUPABASE_URL: "https://project-ref.supabase.co",
        TURNSTILE_SECRET_KEY: "local-fixture",
        TURNSTILE_SITEVERIFY_URL:
          "http://host.docker.internal:4175/turnstile/v0/siteverify",
      }, loopbackOrigins),
    "LOCAL_TURNSTILE_OVERRIDE_FORBIDDEN",
  );
});
