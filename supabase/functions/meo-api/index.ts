import { withSupabase } from "@supabase/server/adapters/hono";
import type { MiddlewareHandler } from "hono";
import { VersionedCredentialCipher } from "../_shared/ai-credentials.ts";
import { parseAllowedOrigins } from "../_shared/http.ts";
import {
  DataForSeoClient,
  GoogleBusinessClient,
  InstagramClient,
} from "../_shared/meo-provider.ts";
import { MeoRepository } from "../_shared/meo-repository.ts";
import { SupabaseRepository } from "../_shared/supabase.ts";
import type { AppEnv } from "../_shared/types.ts";
import { createMeoApp } from "./app.ts";

function optionalGroup(
  env: Record<string, string | undefined>,
  names: string[],
): Record<string, string> | null {
  const values = names.map((name) => env[name]?.trim() ?? "");
  if (values.every((value) => value === "")) return null;
  if (values.some((value) => value === "")) {
    throw new Error(`INCOMPLETE_INTEGRATION_CONFIGURATION:${names.join(",")}`);
  }
  return Object.fromEntries(
    names.map((name, index) => [name, values[index]!]),
  ) as Record<string, string>;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error("INVALID_MEO_LIMIT_CONFIGURATION");
  }
  return parsed;
}

export async function buildMeoApp(env: Record<string, string | undefined>) {
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const appOrigin = env.MEO_APP_ORIGIN?.trim() ?? "";
  let parsedAppOrigin: URL;
  try {
    parsedAppOrigin = new URL(appOrigin);
  } catch {
    throw new Error("INVALID_MEO_APP_ORIGIN");
  }
  if (parsedAppOrigin.origin !== appOrigin || !allowedOrigins.has(appOrigin)) {
    throw new Error("MEO_APP_ORIGIN_NOT_ALLOWED");
  }

  const googleConfig = optionalGroup(env, [
    "GOOGLE_BUSINESS_CLIENT_ID",
    "GOOGLE_BUSINESS_CLIENT_SECRET",
    "GOOGLE_BUSINESS_REDIRECT_URI",
  ]);
  const instagramConfig = optionalGroup(env, [
    "INSTAGRAM_APP_ID",
    "INSTAGRAM_APP_SECRET",
    "INSTAGRAM_REDIRECT_URI",
  ]);
  const credentialCipher = await VersionedCredentialCipher.fromEnvironment(env);

  return createMeoApp({
    allowedOrigins,
    authMiddleware: withSupabase({
      auth: "user",
    }) as unknown as MiddlewareHandler<AppEnv>,
    callbackAuthMiddleware: withSupabase({
      auth: "none",
    }) as unknown as MiddlewareHandler<AppEnv>,
    repository: (c) =>
      new MeoRepository(
        new SupabaseRepository(c.var.supabaseContext.supabaseAdmin),
      ),
    ownerAiRepository: (c) =>
      new SupabaseRepository(c.var.supabaseContext.supabaseAdmin),
    credentialCipher,
    appOrigin,
    google: googleConfig
      ? {
        clientId: googleConfig.GOOGLE_BUSINESS_CLIENT_ID!,
        redirectUri: googleConfig.GOOGLE_BUSINESS_REDIRECT_URI!,
        client: new GoogleBusinessClient({
          clientId: googleConfig.GOOGLE_BUSINESS_CLIENT_ID!,
          clientSecret: googleConfig.GOOGLE_BUSINESS_CLIENT_SECRET!,
          redirectUri: googleConfig.GOOGLE_BUSINESS_REDIRECT_URI!,
        }),
      }
      : undefined,
    instagram: instagramConfig
      ? {
        appId: instagramConfig.INSTAGRAM_APP_ID!,
        redirectUri: instagramConfig.INSTAGRAM_REDIRECT_URI!,
        client: new InstagramClient({
          appId: instagramConfig.INSTAGRAM_APP_ID!,
          appSecret: instagramConfig.INSTAGRAM_APP_SECRET!,
          redirectUri: instagramConfig.INSTAGRAM_REDIRECT_URI!,
          apiVersion: env.INSTAGRAM_API_VERSION,
        }),
      }
      : undefined,
    dataForSeoFactory: (credential) => new DataForSeoClient(credential),
    aiDraftStoreDailyLimit: boundedInteger(
      env.MEO_AI_DRAFT_STORE_DAILY_LIMIT,
      20,
      1,
      1_000,
    ),
    aiDraftGlobalDailyLimit: boundedInteger(
      env.MEO_AI_DRAFT_GLOBAL_DAILY_LIMIT,
      500,
      1,
      1_000_000,
    ),
    rankStoreDailyLimit: boundedInteger(
      env.MEO_RANK_STORE_DAILY_LIMIT,
      1,
      1,
      10_000,
    ),
    rankGlobalDailyPointLimit: boundedInteger(
      env.MEO_DATAFORSEO_RANK_GLOBAL_DAILY_POINT_LIMIT,
      1_000,
      1,
      1_000_000,
    ),
  });
}

if (import.meta.main) {
  const app = await buildMeoApp(Deno.env.toObject());
  Deno.serve(app.fetch);
}
