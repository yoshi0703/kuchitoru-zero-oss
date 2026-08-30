import {
  safeZeroFeatureCapabilities,
  ZERO_FEATURE_KEYS,
} from "../_shared/feature-rollout.ts";
import { assertEquals, assertRejects } from "./assert.ts";

const serverTime = "2026-08-11T03:00:00.000Z";

function row(
  featureKey: string,
  state = "hidden",
  releaseAt: string | null = null,
) {
  return {
    feature_key: featureKey,
    state,
    visible: state !== "hidden",
    available: state === "available",
    execution_mode: "native",
    release_at: releaseAt,
    internal_operator_note: "must never leave the server",
  };
}

Deno.test("five feature capabilities are complete, stable, ordered, and safe", () => {
  const response = safeZeroFeatureCapabilities(
    [...ZERO_FEATURE_KEYS].reverse().map((key) => row(key)),
    serverTime,
  );
  assertEquals(
    response,
    {
      serverTime,
      features: [
        {
          key: "gbp_insights",
          title: "Googleマップ分析",
          status: "hidden",
          releaseAt: null,
          executionMode: "native",
          reason: null,
        },
        {
          key: "review_reply",
          title: "口コミ返信",
          status: "hidden",
          releaseAt: null,
          executionMode: "native",
          reason: null,
        },
        {
          key: "instagram_to_gbp",
          title: "Instagram投稿の再利用",
          status: "hidden",
          releaseAt: null,
          executionMode: "native",
          reason: null,
        },
        {
          key: "meo_rank",
          title: "MEO順位計測",
          status: "hidden",
          releaseAt: null,
          executionMode: "native",
          reason: null,
        },
        {
          key: "gbp_health",
          title: "プロフィール診断",
          status: "hidden",
          releaseAt: null,
          executionMode: "native",
          reason: null,
        },
      ],
    },
  );
});

Deno.test("feature capabilities fail closed when a feature is missing", () => {
  return assertRejects(
    () =>
      safeZeroFeatureCapabilities(
        ZERO_FEATURE_KEYS.slice(1).map((key) => row(key)),
        serverTime,
      ),
    "INCOMPLETE_ZERO_FEATURE_CAPABILITIES",
  );
});

Deno.test("feature capabilities reject unknown keys", () => {
  return assertRejects(
    () =>
      safeZeroFeatureCapabilities(
        [...ZERO_FEATURE_KEYS.map((key) => row(key)), row("unknown")],
        serverTime,
      ),
    "INVALID_ZERO_FEATURE_KEY",
  );
});

Deno.test("feature capabilities reject duplicate keys", () => {
  return assertRejects(
    () =>
      safeZeroFeatureCapabilities(
        [...ZERO_FEATURE_KEYS.map((key) => row(key)), row("meo_rank")],
        serverTime,
      ),
    "DUPLICATE_ZERO_FEATURE_CAPABILITY",
  );
});

Deno.test("feature capabilities reject contradictory availability flags", () => {
  const rows = ZERO_FEATURE_KEYS.map((key) => row(key));
  rows[0] = { ...rows[0], available: true };
  return assertRejects(
    () => safeZeroFeatureCapabilities(rows, serverTime),
    "INVALID_ZERO_FEATURE_AVAILABILITY",
  );
});
