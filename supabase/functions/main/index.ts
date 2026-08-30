import * as jose from "jose";

const COMMUNITY_FUNCTIONS = new Set([
  "meo-api",
  "meo-jobs",
  "meo-workspace",
  "owner-api",
  "public-interview",
]);

type UserWorker = {
  fetch(request: Request): Promise<Response>;
};

export type EdgeWorkerRuntime = {
  userWorkers: {
    create(input: {
      servicePath: string;
      memoryLimitMb: number;
      workerTimeoutMs: number;
      noModuleCache: boolean;
      importMapPath: string;
      envVars: [string, string][];
    }): Promise<UserWorker>;
  };
};

declare const EdgeRuntime: EdgeWorkerRuntime;

function json(status: number, body: Record<string, string>): Response {
  return Response.json(body, { status });
}

export function parseJwks(
  raw: string | undefined,
): jose.JSONWebKeySet | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { keys?: unknown };
    return Array.isArray(parsed.keys) ? parsed as jose.JSONWebKeySet : null;
  } catch {
    return null;
  }
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match) throw new Error("MISSING_OR_INVALID_AUTHORIZATION");
  return match[1]!;
}

async function validJwt(
  token: string,
  env: Record<string, string>,
): Promise<boolean> {
  try {
    const { alg } = jose.decodeProtectedHeader(token);
    if (alg === "HS256") {
      const secret = env.JWT_SECRET;
      if (!secret) return false;
      await jose.jwtVerify(token, new TextEncoder().encode(secret));
      return true;
    }
    if (alg !== "ES256" && alg !== "RS256") return false;
    const jwks = parseJwks(env.SUPABASE_JWKS);
    if (!jwks) return false;
    await jose.jwtVerify(token, jose.createLocalJWKSet(jwks));
    return true;
  } catch {
    return false;
  }
}

export function communityFunctionName(pathname: string): string | null {
  const serviceName = pathname.split("/")[1] ?? "";
  return COMMUNITY_FUNCTIONS.has(serviceName) ? serviceName : null;
}

export function createMainHandler(input: {
  runtime: EdgeWorkerRuntime;
  env: Record<string, string>;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "OPTIONS" && input.env.VERIFY_JWT === "true") {
      let token: string;
      try {
        token = bearerToken(request);
      } catch {
        return json(401, { msg: "Missing or invalid authorization" });
      }
      if (!await validJwt(token, input.env)) {
        return json(401, { msg: "Invalid JWT" });
      }
    }

    const pathname = new URL(request.url).pathname;
    if (pathname === "/" || pathname === "") {
      return json(400, { msg: "Missing function name" });
    }
    const serviceName = communityFunctionName(pathname);
    if (!serviceName) {
      return json(404, { msg: "Function not found" });
    }

    const env = {
      ...input.env,
      SUPABASE_FUNCTION_SLUG: serviceName,
    };
    try {
      const worker = await input.runtime.userWorkers.create({
        servicePath: `/home/deno/functions/${serviceName}`,
        memoryLimitMb: 150,
        workerTimeoutMs: 60_000,
        noModuleCache: false,
        importMapPath: "/home/deno/functions/deno.json",
        envVars: Object.entries(env),
      });
      return await worker.fetch(request);
    } catch (error) {
      console.error("Community function worker failed", error);
      return json(500, { msg: "Function worker failed" });
    }
  };
}

if (import.meta.main) {
  Deno.serve(createMainHandler({
    runtime: EdgeRuntime,
    env: Deno.env.toObject(),
  }));
}
