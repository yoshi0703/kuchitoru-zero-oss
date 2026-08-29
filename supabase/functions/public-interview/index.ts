import { withSupabase } from "@supabase/server/adapters/hono";
import type { MiddlewareHandler } from "hono";
import {
  SecretDeriver,
  VersionedCredentialCipher,
} from "../_shared/ai-credentials.ts";
import { parseAllowedOrigins } from "../_shared/http.ts";
import { providerModelsFromEnvironment } from "../_shared/providers.ts";
import { SupabaseRepository } from "../_shared/supabase.ts";
import { CloudflareTurnstileVerifier } from "../_shared/turnstile.ts";
import type { AppEnv } from "../_shared/types.ts";
import { createPublicInterviewApp } from "./app.ts";

export async function buildPublicInterviewApp(
  env: Record<string, string | undefined>,
) {
  const credentialCipher = await VersionedCredentialCipher.fromEnvironment(env);
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const secretDeriver = await SecretDeriver.create(
    env.SESSION_TOKEN_DERIVATION_KEY ?? "",
    env.RATE_LIMIT_HMAC_KEY ?? "",
  );
  const models = providerModelsFromEnvironment(env);
  return createPublicInterviewApp({
    allowedOrigins,
    authMiddleware: withSupabase({
      auth: "publishable",
    }) as unknown as MiddlewareHandler<AppEnv>,
    repository: (c) =>
      new SupabaseRepository(c.var.supabaseContext.supabaseAdmin),
    credentialCipher,
    secretDeriver,
    turnstile: CloudflareTurnstileVerifier.fromEnvironment(
      env,
      allowedOrigins,
    ),
    models,
  });
}

if (import.meta.main) {
  const app = await buildPublicInterviewApp(Deno.env.toObject());
  Deno.serve(app.fetch);
}
