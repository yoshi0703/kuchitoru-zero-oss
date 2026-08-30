import { withSupabase } from "@supabase/server/adapters/hono";
import type { MiddlewareHandler } from "hono";
import { VersionedCredentialCipher } from "../_shared/ai-credentials.ts";
import { parseAllowedOrigins } from "../_shared/http.ts";
import { providerModelsFromEnvironment } from "../_shared/providers.ts";
import { SupabaseRepository } from "../_shared/supabase.ts";
import type { AppEnv } from "../_shared/types.ts";
import { createOwnerApp } from "./app.ts";

export async function buildOwnerApp(env: Record<string, string | undefined>) {
  const credentialCipher = await VersionedCredentialCipher.fromEnvironment(env);
  const configuredGitSha = env.COMMUNITY_GIT_SHA?.trim() ?? "";
  return createOwnerApp({
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    authMiddleware: withSupabase({
      auth: "user",
    }) as unknown as MiddlewareHandler<AppEnv>,
    repository: (c) =>
      new SupabaseRepository(c.var.supabaseContext.supabaseAdmin),
    credentialCipher,
    models: providerModelsFromEnvironment(env),
    gitSha: /^[0-9a-f]{40}$/i.test(configuredGitSha)
      ? configuredGitSha.toLowerCase()
      : "unknown",
  });
}

if (import.meta.main) {
  const app = await buildOwnerApp(Deno.env.toObject());
  Deno.serve(app.fetch);
}
