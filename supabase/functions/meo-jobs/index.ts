import { createClient } from "@supabase/supabase-js";
import { VersionedCredentialCipher } from "../_shared/ai-credentials.ts";
import {
  DataForSeoClient,
  GoogleBusinessClient,
} from "../_shared/meo-provider.ts";
import { SupabaseRepository } from "../_shared/supabase.ts";
import { createMeoJobsApp } from "./app.ts";
import { MeoJobsSupabaseRepository } from "./repository.ts";

function required(
  env: Record<string, string | undefined>,
  name: string,
  minimum = 1,
): string {
  const value = env[name]?.trim() ?? "";
  if (value.length < minimum || value.length > 2_048 || /[\r\n]/.test(value)) {
    throw new Error(`INVALID_${name}`);
  }
  return value;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error("INVALID_MEO_JOBS_INTEGER_CONFIGURATION");
  }
  return parsed;
}

function optionalGroup(
  env: Record<string, string | undefined>,
  names: string[],
): Record<string, string> | undefined {
  const present = names.filter((name) => Boolean(env[name]?.trim()));
  if (present.length === 0) return undefined;
  if (present.length !== names.length) {
    throw new Error(`INCOMPLETE_${names[0]}_CONFIGURATION`);
  }
  return Object.fromEntries(names.map((name) => [name, required(env, name)]));
}

export async function buildMeoJobsApp(
  env: Record<string, string | undefined>,
) {
  if (env.MEO_JOBS_ENABLED !== "true") throw new Error("MEO_JOBS_DISABLED");
  const schedulerToken = required(env, "MEO_JOBS_TOKEN", 32);
  const supabaseUrl = required(env, "SUPABASE_URL", 12);
  const secretKey = required(env, "SUPABASE_SECRET_KEY", 20);
  const client = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const repository = new MeoJobsSupabaseRepository(
    new SupabaseRepository(client),
  );
  const credentialCipher = await VersionedCredentialCipher.fromEnvironment(env);

  const googleConfig = optionalGroup(env, [
    "GOOGLE_BUSINESS_CLIENT_ID",
    "GOOGLE_BUSINESS_CLIENT_SECRET",
    "GOOGLE_BUSINESS_REDIRECT_URI",
  ]);
  return createMeoJobsApp({
    schedulerToken,
    repository: () => repository,
    credentialCipher,
    google: googleConfig
      ? new GoogleBusinessClient({
        clientId: googleConfig.GOOGLE_BUSINESS_CLIENT_ID!,
        clientSecret: googleConfig.GOOGLE_BUSINESS_CLIENT_SECRET!,
        redirectUri: googleConfig.GOOGLE_BUSINESS_REDIRECT_URI!,
      })
      : undefined,
    dataForSeoFactory: (credential) => new DataForSeoClient(credential),
    workerId: env.MEO_JOBS_WORKER_ID?.trim() || "meo-jobs",
    defaultLimit: boundedInteger(env.MEO_JOBS_BATCH_LIMIT, 10, 1, 25),
    leaseSeconds: boundedInteger(env.MEO_JOBS_LEASE_SECONDS, 180, 30, 600),
  });
}

if (import.meta.main) {
  const app = await buildMeoJobsApp(Deno.env.toObject());
  Deno.serve(app.fetch);
}
