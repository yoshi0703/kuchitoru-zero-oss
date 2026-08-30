export type ReviewReplyTone = "polite" | "warm" | "short";

export type ReviewReplyDraftInput = {
  rating: number;
  reviewComment?: string | null;
  reviewerName?: string | null;
  storeName?: string | null;
  tone?: ReviewReplyTone;
  locale?: "ja" | "en";
};

export type HealthStatus = "good" | "warning" | "action" | "unknown";

export type HealthMetrics = {
  hasBusinessDescription: boolean;
  hasWebsite: boolean;
  hasBusinessHours: boolean;
  hasPhoneNumber: boolean;
  hasPrimaryCategory: boolean;
  photoCount: number | null;
  videoCount: number | null;
  daysSinceLastMedia: number | null;
  postCount: number | null;
  daysSinceLastPost: number | null;
  reviewReplyRate: number | null;
  recentReviewCount: number | null;
};

export type HealthCheck = {
  id: string;
  title: string;
  status: HealthStatus;
  summary: string;
  nextAction: string | null;
};
export type PerformanceMetrics = {
  searches: number;
  views: number;
  websiteClicks: number;
  calls: number;
  directionRequests: number;
};

export type PerformanceComparison = {
  key: keyof PerformanceMetrics;
  current: number;
  previous: number;
  change: number;
  changeRate: number | null;
};

const REVIEW_MAX = 4_096;
const REPLY_MAX = 1_000;
const POST_SUMMARY_MAX = 1_500;

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maximum);
}

function assertRating(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error("INVALID_REVIEW_RATING");
  }
  return value;
}

export function createReviewReplyDraft(
  input: ReviewReplyDraftInput,
): { reply: string; source: "template"; requiresReview: true } {
  const rating = assertRating(input.rating);
  const tone = input.tone ?? "polite";
  const locale = input.locale ?? "ja";
  if (tone !== "polite" && tone !== "warm" && tone !== "short") {
    throw new Error("INVALID_REVIEW_REPLY_TONE");
  }
  if (locale !== "ja" && locale !== "en") {
    throw new Error("INVALID_REVIEW_REPLY_LOCALE");
  }

  const reviewer = boundedText(input.reviewerName, 80);
  const storeName = boundedText(input.storeName, 120);
  const comment = boundedText(input.reviewComment, REVIEW_MAX);
  const addressee = reviewer
    ? locale === "en" ? `${reviewer}, ` : `${reviewer}様、`
    : "";
  const signature = storeName ? `\n${storeName}` : "";

  let body: string;
  if (locale === "en") {
    if (rating >= 4) {
      body = tone === "short"
        ? "Thank you for visiting and for your rating."
        : tone === "warm"
        ? "Thank you for visiting and sharing your rating. We hope to welcome you again."
        : "Thank you for visiting and taking the time to leave a rating. We hope to welcome you again.";
    } else if (rating === 3) {
      body = tone === "short"
        ? "Thank you for visiting and sharing your feedback."
        : "Thank you for visiting and taking the time to share your candid feedback.";
    } else {
      body = tone === "short"
        ? "We are sorry your visit did not meet your expectations. If you are comfortable doing so, please contact the store with more details."
        : "We are sorry that your visit did not meet your expectations. If you are comfortable doing so, please contact the store and share more details.";
    }
  } else if (rating >= 4) {
    body = tone === "short"
      ? "ご来店と評価をありがとうございます。"
      : tone === "warm"
      ? "ご来店いただき、率直な評価をありがとうございます。またお会いできる日を楽しみにしております。"
      : "このたびはご来店いただき、評価をお寄せくださりありがとうございます。またのご来店を心よりお待ちしております。";
  } else if (rating === 3) {
    body = tone === "short"
      ? "ご来店と率直なご感想をありがとうございます。"
      : "このたびはご来店いただき、率直なご感想をお寄せくださりありがとうございます。";
  } else {
    body = tone === "short"
      ? "ご期待に沿えず申し訳ございません。差し支えなければ、店舗まで詳しい状況をお知らせください。"
      : "このたびはご期待に沿えず、申し訳ございませんでした。差し支えなければ、店舗まで詳しい状況をお知らせいただけますと幸いです。";
  }

  // The comment is intentionally not summarized. A deterministic template must
  // not invent facts or imply that an unverified complaint has been resolved.
  const acknowledgement = comment
    ? locale === "en"
      ? "Thank you for sharing your candid feedback."
      : "率直なご意見をお寄せくださりありがとうございます。"
    : "";
  const reply = `${addressee}${body}${
    acknowledgement ? `\n${acknowledgement}` : ""
  }${signature}`
    .slice(0, REPLY_MAX);
  return { reply, source: "template", requiresReview: true };
}

function finiteCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error("INVALID_METRIC");
  return Math.round(value);
}

function finiteOptionalCount(value: number | null): number | null {
  return value === null ? null : finiteCount(value);
}

function normalizedRate(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("INVALID_RATE");
  }
  return value;
}

export function evaluateGbpHealth(
  source: HealthMetrics,
): { score: number; checks: HealthCheck[] } {
  const metrics = {
    ...source,
    photoCount: finiteOptionalCount(source.photoCount),
    videoCount: finiteOptionalCount(source.videoCount),
    postCount: finiteOptionalCount(source.postCount),
    reviewReplyRate: normalizedRate(source.reviewReplyRate),
    recentReviewCount: source.recentReviewCount === null
      ? null
      : finiteCount(source.recentReviewCount),
  };
  for (const age of [metrics.daysSinceLastMedia, metrics.daysSinceLastPost]) {
    if (age !== null && (!Number.isInteger(age) || age < 0)) {
      throw new Error("INVALID_METRIC_AGE");
    }
  }

  const checks: HealthCheck[] = [
    {
      id: "description",
      title: "店舗の説明文",
      status: metrics.hasBusinessDescription ? "good" : "action",
      summary: metrics.hasBusinessDescription
        ? "説明文を登録済みです。"
        : "説明文が未登録です。",
      nextAction: metrics.hasBusinessDescription
        ? null
        : "店舗の特徴、主な商品・サービス、地域名を自然な文章で登録しましょう。",
    },
    {
      id: "hours",
      title: "営業時間",
      status: metrics.hasBusinessHours ? "good" : "action",
      summary: metrics.hasBusinessHours
        ? "営業時間を登録済みです。"
        : "営業時間が未登録です。",
      nextAction: metrics.hasBusinessHours
        ? null
        : "通常営業時間と臨時休業日を登録しましょう。",
    },
    {
      id: "website",
      title: "Webサイト",
      status: metrics.hasWebsite ? "good" : "warning",
      summary: metrics.hasWebsite
        ? "Webサイトを登録済みです。"
        : "Webサイトが未登録です。",
      nextAction: metrics.hasWebsite
        ? null
        : "公式サイトまたは予約ページを登録しましょう。",
    },
    {
      id: "phone",
      title: "電話番号",
      status: metrics.hasPhoneNumber ? "good" : "warning",
      summary: metrics.hasPhoneNumber
        ? "電話番号を登録済みです。"
        : "電話番号が未登録です。",
      nextAction: metrics.hasPhoneNumber
        ? null
        : "お客様が連絡できる電話番号を確認しましょう。",
    },
    {
      id: "category",
      title: "主なカテゴリ",
      status: metrics.hasPrimaryCategory ? "good" : "action",
      summary: metrics.hasPrimaryCategory
        ? "主なカテゴリを設定済みです。"
        : "主なカテゴリが未設定です。",
      nextAction: metrics.hasPrimaryCategory
        ? null
        : "店舗を最もよく表すカテゴリを1つ設定しましょう。",
    },
    {
      id: "media",
      title: "写真・動画",
      status: metrics.photoCount === null || metrics.videoCount === null
        ? "unknown"
        : metrics.photoCount >= 5 && (metrics.daysSinceLastMedia ?? 999) <= 30
        ? "good"
        : metrics.photoCount >= 3
        ? "warning"
        : "action",
      summary: metrics.photoCount === null || metrics.videoCount === null
        ? "写真・動画の件数をこの画面では確認できません。"
        : `写真${metrics.photoCount}枚・動画${metrics.videoCount}本です。`,
      nextAction: metrics.photoCount === null || metrics.videoCount === null
        ? null
        : metrics.photoCount >= 5 && (metrics.daysSinceLastMedia ?? 999) <= 30
        ? null
        : "外観、店内、商品・サービスの新しい写真を追加しましょう。",
    },
    {
      id: "posts",
      title: "最新情報の投稿",
      status: metrics.postCount === null
        ? "unknown"
        : metrics.postCount === 0
        ? "action"
        : metrics.daysSinceLastPost === null
        ? "unknown"
        : metrics.daysSinceLastPost <= 30
        ? "good"
        : metrics.daysSinceLastPost <= 60
        ? "warning"
        : "action",
      summary: metrics.postCount === null
        ? "投稿状況を確認できません。"
        : metrics.postCount === 0
        ? "投稿がまだありません。"
        : metrics.daysSinceLastPost === null
        ? "最新投稿の作成日を確認できません。"
        : `最後の投稿から${metrics.daysSinceLastPost}日です。`,
      nextAction: metrics.postCount === null ||
          (metrics.postCount > 0 && metrics.daysSinceLastPost === null) ||
          (metrics.daysSinceLastPost !== null &&
            metrics.daysSinceLastPost <= 30)
        ? null
        : "今週のお知らせを1件投稿しましょう。",
    },
    {
      id: "review-replies",
      title: "口コミへの返信",
      status: metrics.reviewReplyRate === null
        ? "unknown"
        : metrics.reviewReplyRate >= 0.9
        ? "good"
        : metrics.reviewReplyRate >= 0.6
        ? "warning"
        : "action",
      summary: metrics.reviewReplyRate === null
        ? "返信率を確認できません。"
        : `返信率は${Math.round(metrics.reviewReplyRate * 100)}%です。`,
      nextAction:
        metrics.reviewReplyRate === null || metrics.reviewReplyRate >= 0.9
          ? null
          : "未返信の口コミから1件ずつ返信しましょう。",
    },
    {
      id: "recent-reviews",
      title: "最近の口コミ",
      status: metrics.recentReviewCount === null
        ? "unknown"
        : metrics.recentReviewCount >= 5
        ? "good"
        : metrics.recentReviewCount >= 2
        ? "warning"
        : "action",
      summary: metrics.recentReviewCount === null
        ? "直近90日の件数を確認できません。"
        : `直近90日は${metrics.recentReviewCount}件です。`,
      nextAction:
        metrics.recentReviewCount === null || metrics.recentReviewCount >= 5
          ? null
          : "会計時にクチトルZeroのQRコードをご案内しましょう。",
    },
  ];
  const measuredChecks = checks.filter((check) => check.status !== "unknown");
  const points = measuredChecks.reduce((sum, check) => {
    return sum +
      (check.status === "good" ? 100 : check.status === "warning" ? 50 : 0);
  }, 0);
  return {
    score: measuredChecks.length === 0
      ? 0
      : Math.round(points / measuredChecks.length),
    checks,
  };
}
export function comparePerformance(
  currentInput: PerformanceMetrics,
  previousInput: PerformanceMetrics,
): PerformanceComparison[] {
  const keys: Array<keyof PerformanceMetrics> = [
    "searches",
    "views",
    "websiteClicks",
    "calls",
    "directionRequests",
  ];
  return keys.map((key) => {
    const current = finiteCount(currentInput[key]);
    const previous = finiteCount(previousInput[key]);
    const change = current - previous;
    return {
      key,
      current,
      previous,
      change,
      changeRate: previous === 0
        ? null
        : Math.round((change / previous) * 1_000) / 10,
    };
  });
}

export function createGbpPostDraft(input: {
  caption: string;
  excludedHashtags?: string[];
}): { summary: string; removedHashtags: string[]; requiresReview: true } {
  const caption = boundedText(input.caption, 10_000);
  if (!caption) throw new Error("EMPTY_INSTAGRAM_CAPTION");
  const excluded = new Set(
    (input.excludedHashtags ?? []).map((value) =>
      boundedText(value, 80).replace(/^#/, "").toLocaleLowerCase("ja-JP")
    ).filter(Boolean),
  );
  const removed: string[] = [];
  const summary = caption.replace(
    /(^|\s)#([^\s#]+)/gu,
    (whole, prefix: string, tag: string) => {
      if (!excluded.has(tag.toLocaleLowerCase("ja-JP"))) return whole;
      removed.push(`#${tag}`);
      return prefix;
    },
  ).replace(/\s+/g, " ").trim().slice(0, POST_SUMMARY_MAX);
  if (!summary) throw new Error("EMPTY_GBP_POST_DRAFT");
  return {
    summary,
    removedHashtags: [...new Set(removed)],
    requiresReview: true,
  };
}

export const meoCoreInternals = { boundedText, finiteCount };
