import { withSupabase } from "@supabase/server/adapters/hono";
import type { MiddlewareHandler } from "hono";
import { parseAllowedOrigins } from "../_shared/http.ts";
import type { AppEnv } from "../_shared/types.ts";
import { createWorkspaceApp } from "./app.ts";
import { WorkspaceRepository } from "./repository.ts";

export function buildWorkspaceApp(env: Record<string, string | undefined>) {
  return createWorkspaceApp({
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    authMiddleware: withSupabase({
      auth: "user",
    }) as unknown as MiddlewareHandler<AppEnv>,
    repository: (c) =>
      new WorkspaceRepository(c.var.supabaseContext.supabaseAdmin),
  });
}

if (import.meta.main) {
  const app = buildWorkspaceApp(Deno.env.toObject());
  Deno.serve(app.fetch);
}
