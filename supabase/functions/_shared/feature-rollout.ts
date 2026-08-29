import type { JsonObject } from "./types.ts";

export const ZERO_FEATURE_KEYS = [
  "gbp_insights",
  "review_reply",
  "instagram_to_gbp",
  "meo_rank",
  "gbp_health",
] as const;

export type ZeroFeatureKey = (typeof ZERO_FEATURE_KEYS)[number];

export const ZERO_FEATURE_STATES = [
  "hidden",
  "coming_soon",
  "available",
  "paused",
] as const;

export type ZeroFeatureState = (typeof ZERO_FEATURE_STATES)[number];

export const ZERO_FEATURE_EXECUTION_MODES = [
  "native",
  "owner_provider",
] as const;

export type ZeroFeatureExecutionMode =
  (typeof ZERO_FEATURE_EXECUTION_MODES)[number];

export type ZeroFeatureCapability = {
  key: ZeroFeatureKey;
  title: string;
  status: ZeroFeatureState;
  reason: string | null;
  executionMode: ZeroFeatureExecutionMode;
  releaseAt: string | null;
};

export type ZeroFeatureCapabilities = {
  serverTime: string;
  features: ZeroFeatureCapability[];
};

const featureKeySet = new Set<string>(ZERO_FEATURE_KEYS);
const stateSet = new Set<string>(ZERO_FEATURE_STATES);
const executionModeSet = new Set<string>(ZERO_FEATURE_EXECUTION_MODES);
const featureTitle: Record<ZeroFeatureKey, string> = {
  review_reply: "口コミ返信",
  meo_rank: "MEO順位計測",
  gbp_insights: "Googleマップ分析",
  gbp_health: "プロフィール診断",
  instagram_to_gbp: "Instagram投稿の再利用",
};

function unavailableReason(state: ZeroFeatureState): string | null {
  if (state === "coming_soon") {
    return "公開予定日までは利用できません。";
  }
  if (state === "paused") {
    return "現在、一時停止しています。";
  }
  return null;
}

function record(value: unknown): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("INVALID_ZERO_FEATURE_CAPABILITY");
  }
  return value as JsonObject;
}

function timestamp(value: unknown, code: string): string {
  if (typeof value !== "string") throw new Error(code);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(code);
  return parsed.toISOString();
}

function capability(value: unknown): ZeroFeatureCapability {
  const row = record(value);
  const featureKey = row.feature_key;
  const state = row.state;
  const executionMode = row.execution_mode;
  if (typeof featureKey !== "string" || !featureKeySet.has(featureKey)) {
    throw new Error("INVALID_ZERO_FEATURE_KEY");
  }
  if (typeof state !== "string" || !stateSet.has(state)) {
    throw new Error("INVALID_ZERO_FEATURE_STATE");
  }
  if (
    typeof executionMode !== "string" ||
    !executionModeSet.has(executionMode)
  ) {
    throw new Error("INVALID_ZERO_FEATURE_EXECUTION_MODE");
  }
  const visible = row.visible;
  const available = row.available;
  if (
    typeof visible !== "boolean" || typeof available !== "boolean" ||
    visible !== (state !== "hidden") || available !== (state === "available")
  ) {
    throw new Error("INVALID_ZERO_FEATURE_AVAILABILITY");
  }
  const releaseAt = row.release_at === null
    ? null
    : timestamp(row.release_at, "INVALID_ZERO_FEATURE_RELEASE_AT");
  return {
    key: featureKey as ZeroFeatureKey,
    title: featureTitle[featureKey as ZeroFeatureKey],
    status: state as ZeroFeatureState,
    releaseAt,
    executionMode: executionMode as ZeroFeatureExecutionMode,
    reason: unavailableReason(state as ZeroFeatureState),
  };
}

export function safeZeroFeatureCapabilities(
  value: unknown,
  serverTime: string,
): ZeroFeatureCapabilities {
  if (!Array.isArray(value)) {
    throw new Error("INVALID_ZERO_FEATURE_CAPABILITIES");
  }
  const byKey = new Map<ZeroFeatureKey, ZeroFeatureCapability>();
  for (const item of value) {
    const parsed = capability(item);
    if (byKey.has(parsed.key)) {
      throw new Error("DUPLICATE_ZERO_FEATURE_CAPABILITY");
    }
    byKey.set(parsed.key, parsed);
  }
  if (byKey.size !== ZERO_FEATURE_KEYS.length) {
    throw new Error("INCOMPLETE_ZERO_FEATURE_CAPABILITIES");
  }
  return {
    serverTime: timestamp(serverTime, "INVALID_ZERO_FEATURE_SERVER_TIME"),
    features: ZERO_FEATURE_KEYS.map((key) => byKey.get(key)!),
  };
}
