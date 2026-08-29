import { normalizeGoogleReviewUrl } from "../_shared/google-review-url.ts";
import { parseAllowedOrigins, requestIp } from "../_shared/http.ts";
import { assertEquals, assertRejects } from "./assert.ts";

Deno.test("Google review URL allowlist normalizes explicit supported forms", () => {
  assertEquals(
    normalizeGoogleReviewUrl(
      "https://search.google.com/local/writereview?placeid=ChIJ_test#secret",
    ),
    "https://search.google.com/local/writereview?placeid=ChIJ_test",
  );
  assertEquals(
    normalizeGoogleReviewUrl("https://g.page/r/AbC_123/review/"),
    "https://g.page/r/AbC_123/review",
  );
});

Deno.test("Google review URL allowlist rejects lookalikes, credentials, redirects, and custom ports", async () => {
  for (
    const value of [
      "https://search.google.com.evil.test/local/writereview?placeid=x",
      "https://user:pass@search.google.com/local/writereview?placeid=abc",
      "https://search.google.com:444/local/writereview?placeid=abc",
      "https://www.google.com/url?redirect=https://evil.test",
      "http://search.google.com/local/writereview?placeid=abc",
    ]
  ) {
    await assertRejects(
      () => normalizeGoogleReviewUrl(value),
      "Google口コミURL",
    );
  }
});

Deno.test("allowed origins require HTTPS except loopback development", async () => {
  assertEquals([
    ...parseAllowedOrigins(
      "https://kuchitoru.example,http://localhost:5173,http://127.0.0.1:5173",
    ),
  ], [
    "https://kuchitoru.example",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ]);
  await assertRejects(
    () => parseAllowedOrigins("http://kuchitoru.example"),
    "INSECURE_ALLOWED_ORIGIN",
  );
});

Deno.test("rate-limit identity uses only Supabase's forwarded client header", () => {
  const context = {
    req: {
      header: (name: string) =>
        ({
          "X-Forwarded-For": "203.0.113.7, 10.0.0.1",
          "CF-Connecting-IP": "198.51.100.9",
          "X-Real-IP": "198.51.100.10",
        } as Record<string, string>)[name],
    },
  };
  assertEquals(requestIp(context as never), "203.0.113.7");
  assertEquals(
    requestIp({ req: { header: () => undefined } } as never),
    "unknown",
  );
});
