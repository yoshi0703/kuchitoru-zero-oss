import {
  comparePerformance,
  createGbpPostDraft,
  createReviewReplyDraft,
  evaluateGbpHealth,
} from "../_shared/meo-core.ts";
import { assert, assertEquals } from "./assert.ts";

Deno.test("review reply template stays factual and always requires owner review", () => {
  const result = createReviewReplyDraft({
    rating: 1,
    reviewComment: "提供が遅かった",
    reviewerName: "山田",
    storeName: "テスト食堂",
  });
  assertEquals(result.source, "template");
  assertEquals(result.requiresReview, true);
  assert(result.reply.includes("申し訳ございません"));
  assert(result.reply.includes("お知らせ"));
  for (const unsupported of ["確認", "改善", "共有", "対応", "解決しました"]) {
    assert(!result.reply.includes(unsupported));
  }
});

Deno.test("review reply rejects ratings outside Google review range", () => {
  let error = "";
  try {
    createReviewReplyDraft({ rating: 0 });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "unknown";
  }
  assertEquals(error, "INVALID_REVIEW_RATING");
});

Deno.test("English review reply fallback is natural and does not invent a Japanese store name", () => {
  const withName = createReviewReplyDraft({
    rating: 1,
    reviewComment: "The wait was long.",
    storeName: "Café 青空",
    locale: "en",
  });
  assert(withName.reply.includes("did not meet your expectations"));
  assert(withName.reply.includes("Café 青空"));

  const withoutName = createReviewReplyDraft({ rating: 5, locale: "en" });
  assert(withoutName.reply.includes("Thank you"));
  assert(!withoutName.reply.includes("店舗"));
});

Deno.test("missing review reply locale retains the legacy Japanese template", () => {
  const result = createReviewReplyDraft({ rating: 5 });
  assert(result.reply.includes("ありがとうございます"));
});

Deno.test("high star fallback does not invent a positive sentiment for mixed feedback", () => {
  const result = createReviewReplyDraft({
    rating: 4,
    reviewComment: "料理は良いですが接客は残念でした。",
    tone: "polite",
  });
  assert(!result.reply.includes("温かい"));
  assert(!result.reply.includes("うれしい"));
  assert(result.reply.includes("評価"));
});

Deno.test("health diagnosis is deterministic and ranks one clear next action", () => {
  const result = evaluateGbpHealth({
    hasBusinessDescription: false,
    hasWebsite: true,
    hasBusinessHours: true,
    hasPhoneNumber: true,
    hasPrimaryCategory: true,
    photoCount: 2,
    videoCount: 0,
    daysSinceLastMedia: 91,
    postCount: null,
    daysSinceLastPost: null,
    reviewReplyRate: 0.5,
    recentReviewCount: 1,
  });
  assert(result.score >= 0 && result.score <= 100);
  assertEquals(result.checks[0]?.id, "description");
  assertEquals(result.checks[0]?.status, "action");
});

Deno.test("health diagnosis marks uncollected media metrics as unknown", () => {
  const result = evaluateGbpHealth({
    hasBusinessDescription: true,
    hasWebsite: true,
    hasBusinessHours: true,
    hasPhoneNumber: true,
    hasPrimaryCategory: true,
    photoCount: null,
    videoCount: null,
    daysSinceLastMedia: null,
    postCount: null,
    daysSinceLastPost: null,
    reviewReplyRate: null,
    recentReviewCount: null,
  });
  const media = result.checks.find((check) => check.id === "media");
  const posts = result.checks.find((check) => check.id === "posts");
  const replies = result.checks.find((check) => check.id === "review-replies");
  const reviews = result.checks.find((check) => check.id === "recent-reviews");
  assertEquals(media?.status, "unknown");
  assert(media?.summary.includes("確認できません"));
  assert(!media?.summary.includes("0枚"));
  assertEquals(media?.nextAction, null);
  assertEquals(posts?.status, "unknown");
  assertEquals(posts?.nextAction, null);
  assertEquals(replies?.status, "unknown");
  assertEquals(replies?.nextAction, null);
  assertEquals(reviews?.status, "unknown");
  assertEquals(reviews?.nextAction, null);
  assertEquals(result.score, 100);
});

Deno.test("health diagnosis treats a successful empty post list as an action", () => {
  const result = evaluateGbpHealth({
    hasBusinessDescription: true,
    hasWebsite: true,
    hasBusinessHours: true,
    hasPhoneNumber: true,
    hasPrimaryCategory: true,
    photoCount: 5,
    videoCount: 0,
    daysSinceLastMedia: 0,
    postCount: 0,
    daysSinceLastPost: null,
    reviewReplyRate: 1,
    recentReviewCount: 5,
  });
  const posts = result.checks.find((check) => check.id === "posts");
  assertEquals(posts?.status, "action");
  assertEquals(posts?.summary, "投稿がまだありません。");
  assertEquals(posts?.nextAction, "今週のお知らせを1件投稿しましょう。");
});
Deno.test("performance comparison avoids an invented percentage from a zero baseline", () => {
  const rows = comparePerformance(
    {
      searches: 10,
      views: 5,
      websiteClicks: 2,
      calls: 1,
      directionRequests: 3,
    },
    { searches: 0, views: 5, websiteClicks: 1, calls: 2, directionRequests: 3 },
  );
  assertEquals(rows[0]?.changeRate, null);
  assertEquals(rows[2]?.changeRate, 100);
});

Deno.test("Instagram draft removes only explicitly excluded hashtags", () => {
  const result = createGbpPostDraft({
    caption: "本日のおすすめです #ランチ #内部運用",
    excludedHashtags: ["内部運用"],
  });
  assert(result.summary.includes("#ランチ"));
  assert(!result.summary.includes("#内部運用"));
  assertEquals(result.removedHashtags, ["#内部運用"]);
  assertEquals(result.requiresReview, true);
});
