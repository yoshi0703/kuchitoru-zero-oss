import type { Locale } from "../../shared/i18n";

export type ReplyTone = "polite" | "friendly";

export function buildReviewReply(
  input: {
    review: string;
    rating: number;
    tone: ReplyTone;
  },
  locale: Locale = "ja",
): string {
  const topic = [
    { words: ["料理", "味", "メニュー", "食事"], label: "お料理" },
    { words: ["接客", "店員", "スタッフ"], label: "接客" },
    { words: ["雰囲気", "店内", "内装"], label: "店内の雰囲気" },
    { words: ["待ち", "時間", "遅"], label: "お待たせした時間" },
    { words: ["価格", "値段", "料金"], label: "価格" },
  ].find((candidate) =>
    candidate.words.some((word) => input.review.includes(word)),
  )?.label;
  const greeting =
    input.tone === "friendly"
      ? locale === "ja"
        ? "ご来店と口コミの投稿、ありがとうございます。"
        : "Thank you for visiting and sharing your review."
      : locale === "ja"
        ? "このたびはご来店いただき、誠にありがとうございます。"
        : "Thank you very much for visiting us.";
  const ending =
    input.tone === "friendly"
      ? locale === "ja"
        ? "またお会いできることを、スタッフ一同楽しみにしています。"
        : "Our team looks forward to seeing you again."
      : locale === "ja"
        ? "率直なご感想をお寄せくださり、ありがとうございます。"
        : "Thank you for sharing your honest feedback.";

  if (input.rating <= 2) {
    if (locale === "en")
      return `${greeting}\nWe sincerely apologize that we did not meet your expectations. If possible, please contact the store and tell us more about what happened.\n${ending}`;
    const detail = topic ? `特に${topic}について、` : "";
    return `${greeting}\nご期待に沿えなかった点を、心よりお詫び申し上げます。${detail}差し支えなければ、店舗まで詳しい状況をお知らせください。\n${ending}`;
  }

  if (input.rating === 3) {
    return locale === "ja"
      ? `${greeting}\n率直なご感想をお寄せいただき、重ねて御礼申し上げます。\n${ending}`
      : `${greeting}\nWe also appreciate you taking the time to share your honest feedback.\n${ending}`;
  }

  if (locale === "en")
    return `${greeting}\nThank you for your positive rating.\n${ending}`;
  const detail = topic
    ? `${topic}についてもお書きくださり、`
    : "評価をお寄せくださり、";
  return `${greeting}\n${detail}ありがとうございます。\n${ending}`;
}

export function buildGoogleMapsSearchUrl(
  keyword: string,
  area: string,
): string {
  const query = [area.trim(), keyword.trim()].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export type InsightSummary = {
  totalActions: number;
  actionRate: number | null;
  strongestAction:
    | "電話"
    | "Webサイト"
    | "経路検索"
    | "まだありません"
    | "Calls"
    | "Website"
    | "Directions"
    | "None yet";
  nextStep: string;
};

export function summarizeInsights(
  input: {
    views: number;
    calls: number;
    websiteClicks: number;
    directionRequests: number;
  },
  locale: Locale = "ja",
): InsightSummary {
  const actions = [
    { label: "電話" as const, value: input.calls },
    { label: "Webサイト" as const, value: input.websiteClicks },
    { label: "経路検索" as const, value: input.directionRequests },
  ];
  const totalActions = actions.reduce(
    (total, action) => total + action.value,
    0,
  );
  const strongest = actions.toSorted(
    (left, right) => right.value - left.value,
  )[0];
  const strongestAction =
    !strongest || strongest.value === 0 ? "まだありません" : strongest.label;
  const actionRate =
    input.views > 0
      ? Math.round((totalActions / input.views) * 1000) / 10
      : null;
  const nextStep =
    input.views === 0
      ? "まずGoogleプロフィールの表示回数を確認しましょう。"
      : totalActions === 0
        ? "営業時間・電話番号・Webサイトが正しいか確認しましょう。"
        : strongestAction === "電話"
          ? "電話が多い時間帯に、応答できる体制を確認しましょう。"
          : strongestAction === "経路検索"
            ? "入口や駐車場がわかる写真を追加しましょう。"
            : "Webサイトの予約・問い合わせ導線を確認しましょう。";

  if (locale === "en") {
    const action =
      strongestAction === "電話"
        ? "Calls"
        : strongestAction === "Webサイト"
          ? "Website"
          : strongestAction === "経路検索"
            ? "Directions"
            : "None yet";
    const englishNextStep =
      input.views === 0
        ? "Start by checking how many times your Google profile was viewed."
        : totalActions === 0
          ? "Check that your hours, phone number, and website are correct."
          : strongestAction === "電話"
            ? "Make sure someone can answer during the hours when calls are most frequent."
            : strongestAction === "経路検索"
              ? "Add photos that make the entrance and parking easy to find."
              : "Review the booking and contact paths on your website.";
    return {
      totalActions,
      actionRate,
      strongestAction: action,
      nextStep: englishNextStep,
    };
  }
  return { totalActions, actionRate, strongestAction, nextStep };
}

export const HEALTH_CHECKS = [
  {
    key: "description",
    label: "店舗の説明文を登録している",
    labelEn: "A business description is set",
    fix: "店舗の特徴、主な商品・サービス、地域名を自然な文章で登録する",
  },
  {
    key: "hours",
    label: "営業時間と定休日が最新",
    labelEn: "Hours and closing days are current",
    fix: "営業時間と定休日を今日の情報に直す",
  },
  {
    key: "website",
    label: "Webサイトまたは予約ページが正しい",
    labelEn: "The website or booking page is correct",
    fix: "Webサイトまたは予約ページを実際に開いて確認する",
  },
  {
    key: "phone",
    label: "お客様向けの電話番号が正しい",
    labelEn: "The customer phone number is correct",
    fix: "お客様が連絡できる電話番号を確認する",
  },
  {
    key: "category",
    label: "主なカテゴリを1つ選んでいる",
    labelEn: "One primary category is selected",
    fix: "お店に最も合う主なカテゴリを1つ選ぶ",
  },
  {
    key: "photos",
    label: "写真が5枚以上あり、30日以内に更新した",
    labelEn: "At least five photos, updated within 30 days",
    fix: "外観、店内、商品・サービスの新しい写真を追加する",
  },
  {
    key: "posts",
    label: "30日以内に最新情報を投稿した",
    labelEn: "An update was posted within 30 days",
    fix: "今週のお知らせを1件投稿する",
  },
  {
    key: "replies",
    label: "最近の口コミに返信している",
    labelEn: "Recent reviews have replies",
    fix: "未返信の口コミを1件だけ返信する",
  },
  {
    key: "recentReviews",
    label: "直近90日に口コミが5件以上ある",
    labelEn: "At least five reviews in the last 90 days",
    fix: "会計時にクチトルZeroのQRコードを案内する",
  },
] as const;

export type HealthCheckKey = (typeof HEALTH_CHECKS)[number]["key"];

export function diagnoseProfile(
  checked: ReadonlySet<HealthCheckKey>,
  locale: Locale = "ja",
): { score: number; nextFix: string | null } {
  const score = Math.round((checked.size / HEALTH_CHECKS.length) * 100);
  const firstMissing = HEALTH_CHECKS.find((check) => !checked.has(check.key));
  const englishFixes: Record<HealthCheckKey, string> = {
    description:
      "Add a natural description of the store, its main products or services, and the area.",
    hours: "Update the opening hours and days off to today's information.",
    website: "Open and verify the website or booking page.",
    phone: "Verify the phone number customers can use to contact you.",
    category:
      "Choose the one primary category that best matches your business.",
    photos:
      "Add recent photos of the exterior, interior, and products or services.",
    posts: "Publish one update this week.",
    replies: "Reply to one unanswered review.",
    recentReviews: "Show customers the Kuchitoru Zero QR code at checkout.",
  };
  return {
    score,
    nextFix: firstMissing
      ? locale === "ja"
        ? firstMissing.fix
        : englishFixes[firstMissing.key]
      : null,
  };
}

export function prepareGooglePost(caption: string): string {
  const withoutTags = caption
    .replace(/(^|\s)#[^\s#]+/gu, " ")
    .replace(/(^|\s)@[^\s@]+/gu, " ")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
  return withoutTags.slice(0, 1500);
}
