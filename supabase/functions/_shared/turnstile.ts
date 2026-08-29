export type TurnstileInput = {
  token: string;
  remoteIp: string;
  siteverifyIdempotencyKey: string;
  expectedHostname: string;
  expectedAction?: string;
};

export interface TurnstileVerifier {
  verify(input: TurnstileInput): Promise<boolean>;
}

type SiteverifyResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
};

const CLOUDFLARE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);
const LOCAL_SITEVERIFY_HOSTNAMES = new Set([
  ...LOOPBACK_HOSTNAMES,
  "host.docker.internal",
]);

function localSiteverifyUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("INVALID_LOCAL_TURNSTILE_SITEVERIFY_URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !LOCAL_SITEVERIFY_HOSTNAMES.has(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error("INVALID_LOCAL_TURNSTILE_SITEVERIFY_URL");
  }
  return url.toString();
}

function allOriginsAreLoopback(allowedOrigins: ReadonlySet<string>): boolean {
  if (allowedOrigins.size === 0) return false;
  try {
    return [...allowedOrigins].every((origin) =>
      LOOPBACK_HOSTNAMES.has(new URL(origin).hostname)
    );
  } catch {
    return false;
  }
}

function supabaseUrlIsLocal(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.username !== "" || url.password !== "" || url.hash !== "") {
      return false;
    }
    if (!["http:", "https:"].includes(url.protocol)) return false;
    if (LOCAL_SITEVERIFY_HOSTNAMES.has(url.hostname)) return true;
    // Local Supabase Edge Runtime uses the Docker-internal Kong service.
    return url.protocol === "http:" && url.hostname === "kong" &&
      url.port === "8000";
  } catch {
    return false;
  }
}

export class CloudflareTurnstileVerifier implements TurnstileVerifier {
  readonly #secret: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #siteverifyUrl: string;

  private constructor(
    secret: string,
    fetchImplementation: typeof fetch,
    timeoutMs: number,
    siteverifyUrl: string,
  ) {
    if (!secret) throw new Error("TURNSTILE_SECRET_KEY_REQUIRED");
    this.#secret = secret;
    this.#fetch = fetchImplementation;
    this.#timeoutMs = timeoutMs;
    this.#siteverifyUrl = siteverifyUrl;
  }

  static fromEnvironment(
    env: Record<string, string | undefined>,
    allowedOrigins: ReadonlySet<string>,
    fetchImplementation: typeof fetch = fetch,
    timeoutMs = 5_000,
  ): CloudflareTurnstileVerifier {
    const secret = env.TURNSTILE_SECRET_KEY ?? "";
    const override = env.TURNSTILE_SITEVERIFY_URL?.trim();
    if (!override) {
      return new CloudflareTurnstileVerifier(
        secret,
        fetchImplementation,
        timeoutMs,
        CLOUDFLARE_SITEVERIFY_URL,
      );
    }
    if (
      env.KUCHITORU_LOCAL_INTEGRATION !== "1" ||
      !allOriginsAreLoopback(allowedOrigins) ||
      !supabaseUrlIsLocal(env.SUPABASE_URL)
    ) {
      throw new Error("LOCAL_TURNSTILE_OVERRIDE_FORBIDDEN");
    }
    return new CloudflareTurnstileVerifier(
      secret,
      fetchImplementation,
      timeoutMs,
      localSiteverifyUrl(override),
    );
  }

  async verify(input: TurnstileInput): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const body = new URLSearchParams({
        secret: this.#secret,
        response: input.token,
        remoteip: input.remoteIp,
        idempotency_key: input.siteverifyIdempotencyKey,
      });
      const response = await this.#fetch(
        this.#siteverifyUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: controller.signal,
        },
      );
      if (!response.ok) return false;
      const result = await response.json() as SiteverifyResponse;
      return result.success === true &&
        result.hostname === input.expectedHostname &&
        result.action === (input.expectedAction ?? "interview_start");
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
