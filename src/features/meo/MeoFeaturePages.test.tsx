import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { beforeEach, expect, test, vi } from "vitest";
import { ApiError } from "../../shared/api/http";
import { I18nProvider, LOCALE_STORAGE_KEY } from "../../shared/i18n";
import {
  GbpHealthPage,
  GbpInsightsPage,
  InstagramToGbpPage,
  MeoRankPage,
  ReviewReplyPage,
} from "./MeoFeaturePages";

const capabilitiesMock = vi.hoisted(() => vi.fn());
const authMock = vi.hoisted(() => ({
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.test",
  },
}));
const serviceMocks = vi.hoisted(() => ({
  checkGbpHealth: vi.fn(),
  createInstagramGbpDraft: vi.fn(),
  createReviewReplyDraft: vi.fn(),
  getGoogleReviews: vi.fn(),
  getLatestGbpHealthResult: vi.fn(),
  getInstagramMedia: vi.fn(),
  getInsightHistory: vi.fn(),
  getMeoExternalWriteSettings: vi.fn(),
  getRankHistory: vi.fn(),
  publishGoogleReviewReply: vi.fn(),
  publishInstagramDraftToGoogle: vi.fn(),
  requestRankMeasurement: vi.fn(),
  saveManualInsights: vi.fn(),
  saveManualRank: vi.fn(),
  syncGoogleInsights: vi.fn(),
  getOwnerStore: vi.fn(),
}));

vi.mock("../owner/owner-api", () => ({
  getOwnerStore: serviceMocks.getOwnerStore,
}));

vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ user: authMock.user }),
}));

vi.mock("./meo-service-api", () => serviceMocks);

vi.mock("./meo-api", () => ({
  meoFeatureCapabilitiesQueryOptions: () => ({
    queryKey: ["meo-feature-capabilities"],
    queryFn: capabilitiesMock,
    retry: false,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.setItem(LOCALE_STORAGE_KEY, "ja");
  authMock.user.id = "11111111-1111-4111-8111-111111111111";
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "review_reply",
        title: "口コミ返信",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
      {
        key: "instagram_to_gbp",
        title: "Instagram投稿の再利用",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  serviceMocks.createReviewReplyDraft.mockResolvedValue({
    reply: "ご期待に沿えず申し訳ございません。内容を確認いたします。",
    source: "template",
    requiresReview: true,
  });
  serviceMocks.getOwnerStore.mockResolvedValue({
    id: "44444444-4444-4444-8444-444444444444",
    name: "テスト店",
    google_place_id: "ChIJ1234567890",
  });
  serviceMocks.createInstagramGbpDraft.mockResolvedValue({
    summary: "本日も営業中です。",
    removedHashtags: ["#新宿グルメ"],
    requiresReview: true,
  });
  serviceMocks.getInstagramMedia.mockResolvedValue([]);
  serviceMocks.getGoogleReviews.mockResolvedValue([]);
  serviceMocks.getLatestGbpHealthResult.mockResolvedValue(null);
  serviceMocks.getInsightHistory.mockResolvedValue([]);
  serviceMocks.getMeoExternalWriteSettings.mockResolvedValue({
    enabled: true,
    canManage: true,
    canExecute: true,
  });
  serviceMocks.getRankHistory.mockResolvedValue([]);
});

function renderPage(element: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[
            "/dashboard/stores/44444444-4444-4444-8444-444444444444/meo/test",
          ]}
        >
          <Routes>
            <Route
              path="/dashboard/stores/:storeId/meo/test"
              element={element}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

function GbpHealthScopeSwitchHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          authMock.user.id = "22222222-2222-4222-8222-222222222222";
          void navigate(
            "/dashboard/stores/55555555-5555-4555-8555-555555555555/meo/test",
          );
        }}
      >
        ownerと店舗を切り替える
      </button>
      <GbpHealthPage />
    </>
  );
}

function renderGbpHealthScopeSwitchHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[
            "/dashboard/stores/44444444-4444-4444-8444-444444444444/meo/test",
          ]}
        >
          <Routes>
            <Route
              path="/dashboard/stores/:storeId/meo/test"
              element={<GbpHealthScopeSwitchHarness />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function waitForGbpHealthInput() {
  return screen.findByRole("button", { name: "Googleの登録内容を診断する" });
}

function gbpHealthDiagnosis<T>(
  result: T,
  source: "manual" | "google_business" = "google_business",
  diagnosedAt = "2026-08-12T14:20:00.000Z",
) {
  return { source, diagnosedAt, result };
}

test("口コミ返信は低評価向け案を作り、確認なしでは投稿準備できない", async () => {
  renderPage(<ReviewReplyPage />);
  fireEvent.change(screen.getByLabelText("お客様の口コミ"), {
    target: { value: "待ち時間が長かったです" },
  });
  fireEvent.change(screen.getByLabelText("星の数"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "返信案を作る" }));

  expect(await screen.findByDisplayValue(/申し訳/)).toBeVisible();
  const prepare = screen.getByRole("button", {
    name: "Googleへの返信準備をする",
  });
  expect(prepare).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText("この内容をGoogleに投稿してよいことを確認しました"),
  );
  await waitFor(() => expect(prepare).toBeEnabled());
  fireEvent.click(prepare);
  expect(
    screen.getByText("この入力だけではGoogleへ直接送信できません。"),
  ).toBeVisible();
  expect(screen.queryByText(/投稿しました/)).not.toBeInTheDocument();
});

test("English reply UI preserves Japanese review text and sends the active locale", async () => {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
  renderPage(<ReviewReplyPage />);
  fireEvent.change(screen.getByLabelText("Customer review"), {
    target: { value: "料理が最高でした" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create reply draft" }));

  await waitFor(() =>
    expect(serviceMocks.createReviewReplyDraft).toHaveBeenCalled()
  );
  expect(screen.getByDisplayValue("料理が最高でした")).toBeVisible();
  expect(serviceMocks.createReviewReplyDraft).toHaveBeenCalledWith(
    "44444444-4444-4444-8444-444444444444",
    expect.objectContaining({ locale: "en", reviewComment: "料理が最高でした" }),
  );
});

test("English health UI localizes saved Japanese diagnostic copy", async () => {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
  serviceMocks.getLatestGbpHealthResult.mockResolvedValue(
    gbpHealthDiagnosis({
      score: 0,
      checks: [
        {
          id: "description",
          title: "店舗の説明文",
          status: "action",
          summary: "説明文が未登録です。",
          nextAction:
            "店舗の特徴、主な商品・サービス、地域名を自然な文章で登録しましょう。",
        },
      ],
    }),
  );

  renderPage(<GbpHealthPage />);

  expect(await screen.findByText("Business description")).toBeVisible();
  expect(screen.getByText("A business description is missing.")).toBeVisible();
  expect(
    screen.getByText(
      "Add a natural description of the store, its main products or services, and the area.",
    ),
  ).toBeVisible();
  expect(screen.queryByText("店舗の説明文")).not.toBeInTheDocument();
  expect(screen.queryByText("説明文が未登録です。")).not.toBeInTheDocument();
});

test("Instagram文はタグを除いてプレビューし、外部投稿成功を装わない", async () => {
  renderPage(<InstagramToGbpPage />);
  fireEvent.change(screen.getByLabelText("Instagramに投稿した文章"), {
    target: { value: "本日も営業中です。 #新宿グルメ" },
  });
  fireEvent.change(
    screen.getByLabelText("Googleには載せないハッシュタグ（任意）"),
    { target: { value: "#新宿グルメ 社内用" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Google投稿用に整える" }));

  const preview = await screen.findByLabelText(
    "日付・価格・リンクを確認してから使ってください",
  );
  expect(preview).toHaveValue("本日も営業中です。");
  expect(serviceMocks.createInstagramGbpDraft).toHaveBeenCalledWith(
    "44444444-4444-4444-8444-444444444444",
    {
      caption: "本日も営業中です。 #新宿グルメ",
      excludedHashtags: ["#新宿グルメ", "#社内用"],
    },
  );
  expect(
    screen.getByRole("button", {
      name: "確認してGoogleへ投稿する",
    }),
  ).toBeDisabled();
  expect(screen.queryByText(/投稿しました/)).not.toBeInTheDocument();
});

test("外部書き込みが無効でもInstagram投稿文をコピーでき、Google送信はできない", async () => {
  serviceMocks.getMeoExternalWriteSettings.mockResolvedValue({
    enabled: false,
    canManage: true,
    canExecute: true,
  });
  renderPage(<InstagramToGbpPage />);
  fireEvent.change(screen.getByLabelText("Instagramに投稿した文章"), {
    target: { value: "本日も営業中です。" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Google投稿用に整える" }));

  expect(await screen.findByRole("button", { name: "投稿文をコピー" })).toBeEnabled();
  expect(
    screen.getByLabelText("この内容をGoogleに投稿してよいことを確認しました"),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "確認してGoogleへ投稿する" }),
  ).toBeDisabled();
  expect(await screen.findByText("外部書き込みは無効です。")).toBeVisible();
  expect(screen.getByRole("link", { name: "外部書き込み設定を開く" })).toBeVisible();
});

test("analystは外部書き込みが有効でも文案のコピーだけ利用できる", async () => {
  serviceMocks.getMeoExternalWriteSettings.mockResolvedValue({
    enabled: true,
    canManage: false,
    canExecute: false,
  });
  renderPage(<InstagramToGbpPage />);
  fireEvent.change(screen.getByLabelText("Instagramに投稿した文章"), {
    target: { value: "本日も営業中です。" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Google投稿用に整える" }));

  expect(await screen.findByRole("button", { name: "投稿文をコピー" })).toBeEnabled();
  expect(
    screen.getByLabelText("この内容をGoogleに投稿してよいことを確認しました"),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "確認してGoogleへ投稿する" }),
  ).toBeDisabled();
  expect(
    screen.getByText("閲覧専用の担当者はGoogleへ送信できません。文章のコピーは利用できます。"),
  ).toBeVisible();
  expect(serviceMocks.publishInstagramDraftToGoogle).not.toHaveBeenCalled();
});

test("外部書き込み設定を取得できない場合も返信案のコピーだけは使える", async () => {
  serviceMocks.getMeoExternalWriteSettings.mockRejectedValue(new Error("network"));
  renderPage(<ReviewReplyPage />);
  fireEvent.change(screen.getByLabelText("お客様の口コミ"), {
    target: { value: "待ち時間が長かったです" },
  });
  fireEvent.click(screen.getByRole("button", { name: "返信案を作る" }));

  expect(await screen.findByRole("button", { name: "返信案をコピー" })).toBeEnabled();
  expect(
    await screen.findByText(
      "外部書き込みの設定を確認できないため、Googleへの送信を止めています。文章はコピーできます。",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Googleへの返信準備をする" }),
  ).toBeDisabled();
});

test("外部書き込み設定の確認中は送信操作だけを無効にする", async () => {
  const settings = deferred<{
    enabled: boolean;
    canManage: boolean;
    canExecute: boolean;
  }>();
  serviceMocks.getMeoExternalWriteSettings.mockReturnValue(settings.promise);
  renderPage(<ReviewReplyPage />);
  fireEvent.change(screen.getByLabelText("お客様の口コミ"), {
    target: { value: "待ち時間が長かったです" },
  });
  fireEvent.click(screen.getByRole("button", { name: "返信案を作る" }));

  expect(await screen.findByRole("button", { name: "返信案をコピー" })).toBeEnabled();
  expect(screen.getByText("外部書き込みの設定を確認しています")).toBeVisible();
  expect(
    screen.getByLabelText("この内容をGoogleに投稿してよいことを確認しました"),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Googleへの返信準備をする" }),
  ).toBeDisabled();
});

test("owner_providerは文章生成に外部サービス接続が必要なことを表示する", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "review_reply",
        title: "口コミ返信",
        status: "available",
        releaseAt: null,
        executionMode: "owner_provider",
        reason: null,
      },
    ],
  });
  renderPage(<ReviewReplyPage />);
  expect(
    await screen.findByText(
      "文章生成には店舗管理者の外部AI接続を使います。 Googleへは確認後に送信します。",
    ),
  ).toBeVisible();
});

test("順位計測は自店と競合の完了結果を過去履歴として表示する", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "meo_rank",
        title: "順位・競合チェック",
        status: "available",
        releaseAt: null,
        executionMode: "owner_provider",
        reason: null,
      },
    ],
  });
  serviceMocks.getRankHistory.mockResolvedValue([
    {
      id: "rank-1",
      keyword: "新宿 焼肉",
      target_place_id: "ChIJ1234567890",
      position: 8,
      competitor_positions: [{ place_id: "ChIJcompetitor123", position: 3 }],
      source: "owner_provider",
      observed_at: "2026-08-11T02:00:00.000Z",
      result_count: 100,
    },
  ]);
  renderPage(<MeoRankPage />);

  expect(
    await screen.findByRole("heading", { name: "過去30日の順位" }),
  ).toBeVisible();
  expect(await screen.findByText("新宿 焼肉")).toBeVisible();
  expect(screen.getByText("8位")).toBeVisible();
  expect(screen.getByText("3位")).toBeVisible();
  expect(screen.getByText("自分のDataForSEO")).toBeVisible();
});

test("English rank history localizes product labels and provider source", async () => {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "meo_rank",
        title: "順位・競合チェック",
        status: "available",
        releaseAt: null,
        executionMode: "owner_provider",
        reason: null,
      },
    ],
  });
  serviceMocks.getRankHistory.mockResolvedValue([
    {
      id: "rank-en",
      keyword: "新宿 焼肉",
      target_place_id: "ChIJ1234567890",
      position: 8,
      competitor_positions: [{ place_id: "ChIJcompetitor123", position: 3 }],
      source: "owner_provider",
      observed_at: "2026-08-11T02:00:00.000Z",
      result_count: 100,
    },
  ]);

  renderPage(<MeoRankPage />);

  expect(
    await screen.findByRole("heading", {
      name: "Rank history for the last 30 days",
    }),
  ).toBeVisible();
  expect(await screen.findByText("新宿 焼肉")).toBeVisible();
  expect(screen.getByText(/Competitor 1/u)).toBeVisible();
  expect(screen.getByText("No. 3")).toBeVisible();
  expect(screen.getByText("Your DataForSEO")).toBeVisible();
});

test("Googleマップ分析は自動取得した実数と前回差を履歴に表示する", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_insights",
        title: "Googleマップ分析",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  serviceMocks.getInsightHistory.mockResolvedValue([
    {
      id: "insight-new",
      period_start: "2026-07-11",
      period_end: "2026-08-10",
      source: "google_business",
      metrics: {
        searches: 120,
        views: 80,
        calls: 12,
        websiteClicks: 20,
        directionRequests: 15,
      },
      updated_at: "2026-08-11T02:00:00.000Z",
    },
    {
      id: "insight-old",
      period_start: "2026-06-10",
      period_end: "2026-07-10",
      source: "google_business",
      metrics: {
        searches: 100,
        views: 70,
        calls: 10,
        websiteClicks: 18,
        directionRequests: 12,
      },
      updated_at: "2026-07-11T02:00:00.000Z",
    },
  ]);
  renderPage(<GbpInsightsPage />);

  expect(
    await screen.findByRole("heading", { name: "保存した数字" }),
  ).toBeVisible();
  expect(await screen.findAllByText("Googleから自動取得")).toHaveLength(2);
  expect(screen.getByText("120回")).toBeVisible();
  expect(screen.getByText("前回比 +20")).toBeVisible();
});

test("English insights history localizes source and metric labels", async () => {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_insights",
        title: "Googleマップ分析",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  serviceMocks.getInsightHistory.mockResolvedValue([
    {
      id: "insight-en",
      period_start: "2026-07-11",
      period_end: "2026-08-10",
      source: "google_business",
      metrics: {
        searches: 120,
        views: 80,
        calls: 12,
        websiteClicks: 20,
        directionRequests: 15,
      },
      updated_at: "2026-08-11T02:00:00.000Z",
    },
  ]);

  renderPage(<GbpInsightsPage />);

  const history = await screen.findByLabelText("Google Maps insights history");
  expect(within(history).getByText("Imported from Google")).toBeVisible();
  expect(within(history).getByText("Searches")).toBeVisible();
  expect(within(history).getByText("Website visits")).toBeVisible();
  expect(screen.queryByText("Googleから自動取得")).not.toBeInTheDocument();
  expect(screen.queryByText("検索")).not.toBeInTheDocument();
});

test("Googleから取り込んだ分析結果は自動取得データだと明示する", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_insights",
        title: "Googleマップ分析",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  serviceMocks.syncGoogleInsights.mockResolvedValue({
    id: "insight-sync",
    period_start: "2026-07-11",
    period_end: "2026-08-10",
    source: "google_business",
    metrics: { views: 80, calls: 12, websiteClicks: 20, directionRequests: 15 },
    updated_at: "2026-08-11T02:00:00.000Z",
  });
  renderPage(<GbpInsightsPage />);
  fireEvent.click(
    screen.getByRole("button", { name: "Googleの数字を取り込む" }),
  );

  expect(
    await screen.findByText("Googleから取得した数字を集計しています。"),
  ).toBeVisible();
  expect(
    screen.queryByText("Googleから自動取得したデータではありません。"),
  ).not.toBeInTheDocument();
});

test("自動診断で取得できない項目から根拠のない改善案を作らない", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_health",
        title: "プロフィール診断",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  serviceMocks.checkGbpHealth.mockResolvedValue(
    gbpHealthDiagnosis({
      score: 100,
      checks: [
        {
          id: "posts",
          title: "最新情報の投稿",
          status: "unknown",
          summary: "投稿状況を確認できません。",
          nextAction: null,
        },
      ],
    }),
  );
  renderPage(<GbpHealthPage />);
  fireEvent.click(await waitForGbpHealthInput());

  expect(await screen.findByText("確認できた範囲：100点")).toBeVisible();
  expect(screen.getByText("2026年8月12日 23:20")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Googleの登録内容を診断する" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "手入力で診断する" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "もう一度診断する" }),
  ).toBeVisible();
  expect(screen.getByText("未確認：1項目")).toBeVisible();
  expect(screen.getByText("一部項目は未確認です。")).toBeVisible();
  expect(
    screen.queryByText(
      "Googleプロフィールの店名を、実際の看板と同じ表記にする",
    ),
  ).not.toBeInTheDocument();
});

test("自動診断の成功時は9項目のタイトル・要約・状態をすべて表示する", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_health",
        title: "プロフィール診断",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  const checks = [
    {
      id: "description",
      title: "店舗の説明文",
      status: "good",
      summary: "説明文を登録済みです。",
      nextAction: null,
    },
    {
      id: "hours",
      title: "営業時間",
      status: "warning",
      summary: "営業時間を確認してください。",
      nextAction: "営業時間を更新しましょう。",
    },
    {
      id: "website",
      title: "Webサイト",
      status: "action",
      summary: "Webサイトが未登録です。",
      nextAction: "公式サイトを登録しましょう。",
    },
    {
      id: "phone",
      title: "電話番号",
      status: "unknown",
      summary: "電話番号を確認できません。",
      nextAction: null,
    },
    {
      id: "category",
      title: "主なカテゴリ",
      status: "good",
      summary: "主なカテゴリを設定済みです。",
      nextAction: null,
    },
    {
      id: "media",
      title: "写真・動画",
      status: "warning",
      summary: "写真3枚・動画0本です。",
      nextAction: "写真を追加しましょう。",
    },
    {
      id: "posts",
      title: "最新情報の投稿",
      status: "action",
      summary: "最後の投稿から61日です。",
      nextAction: "今週のお知らせを投稿しましょう。",
    },
    {
      id: "review-replies",
      title: "口コミへの返信",
      status: "good",
      summary: "返信率は100%です。",
      nextAction: null,
    },
    {
      id: "recent-reviews",
      title: "最近の口コミ",
      status: "unknown",
      summary: "直近90日の件数を確認できません。",
      nextAction: null,
    },
  ] as const;
  const statusLabels = {
    good: "良好",
    warning: "要確認",
    action: "改善が必要",
    unknown: "未確認",
  } as const;
  serviceMocks.checkGbpHealth.mockResolvedValue(
    gbpHealthDiagnosis({ score: 57, checks }),
  );
  renderPage(<GbpHealthPage />);
  fireEvent.click(await waitForGbpHealthInput());

  const result = await screen.findByRole("region", { name: "診断項目" });
  const articles = result.querySelectorAll("article");
  expect(articles).toHaveLength(9);
  checks.forEach((check, index) => {
    expect(articles[index]).toHaveTextContent(check.title);
    expect(articles[index]).toHaveTextContent(check.summary);
    expect(articles[index]).toHaveTextContent(
      `状態：${statusLabels[check.status]}`,
    );
  });
});

test("自動診断は通信失敗後も同じkeyで結果を確認し、成功時だけkeyを消す", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_health",
        title: "プロフィール診断",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  serviceMocks.checkGbpHealth
    .mockRejectedValueOnce(
      new ApiError({
        code: "NETWORK_ERROR",
        message:
          "通信できませんでした。接続を確認して、もう一度お試しください。",
        retryable: true,
        status: 0,
      }),
    )
    .mockResolvedValueOnce(gbpHealthDiagnosis({ score: 100, checks: [] }));
  renderPage(<GbpHealthPage />);
  fireEvent.click(await waitForGbpHealthInput());

  expect(
    await screen.findByText(
      "処理結果を確認できません。再実行せず接続状態を確認してください。",
    ),
  ).toBeVisible();
  expect(
    screen.queryByText(
      "通信できませんでした。接続を確認して、もう一度お試しください。",
    ),
  ).not.toBeInTheDocument();
  const firstKey = serviceMocks.checkGbpHealth.mock.calls[0]?.[2];
  expect(firstKey).toMatch(/^[0-9a-f-]{36}$/u);
  expect(
    JSON.parse(
      window.sessionStorage.getItem(
        "kuchitoru-zero:gbp-health-diagnosis:v1:11111111-1111-4111-8111-111111111111:44444444-4444-4444-8444-444444444444",
      ) ?? "null",
    ),
  ).toEqual({ version: 1, idempotencyKey: firstKey });

  fireEvent.click(screen.getByRole("button", { name: "結果を確認する" }));
  expect(await screen.findByText("診断結果：100点")).toBeVisible();
  expect(screen.getByText("2026年8月12日 23:20")).toBeVisible();
  expect(serviceMocks.checkGbpHealth).toHaveBeenNthCalledWith(
    2,
    "44444444-4444-4444-8444-444444444444",
    { useConnection: true },
    firstKey,
  );
  expect(window.sessionStorage).toHaveLength(0);
  expect(
    screen.getByRole("button", { name: "もう一度診断する" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Googleの登録内容を診断する" }),
  ).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "もう一度診断する" }));
  expect(
    screen.getByRole("button", { name: "Googleの登録内容を診断する" }),
  ).toBeVisible();
});

test("reload後も保存済みkeyを新attemptにせず結果確認へ使う", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_health",
        title: "プロフィール診断",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  const idempotencyKey = "88888888-8888-4888-8888-888888888888";
  window.sessionStorage.setItem(
    "kuchitoru-zero:gbp-health-diagnosis:v1:11111111-1111-4111-8111-111111111111:44444444-4444-4444-8444-444444444444",
    JSON.stringify({ version: 1, idempotencyKey }),
  );
  serviceMocks.checkGbpHealth.mockResolvedValue(
    gbpHealthDiagnosis({ score: 100, checks: [] }),
  );
  renderPage(<GbpHealthPage />);

  fireEvent.click(
    await screen.findByRole("button", { name: "結果を確認する" }),
  );
  expect(await screen.findByText("診断結果：100点")).toBeVisible();
  expect(serviceMocks.checkGbpHealth).toHaveBeenCalledWith(
    "44444444-4444-4444-8444-444444444444",
    { useConnection: true },
    idempotencyKey,
  );
  expect(window.sessionStorage).toHaveLength(0);
});

test("保存済み結果と未確認keyが共存するreloadでは同じkeyの結果確認を優先する", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_health",
        title: "プロフィール診断",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  const idempotencyKey = "99999999-9999-4999-8999-999999999999";
  window.sessionStorage.setItem(
    "kuchitoru-zero:gbp-health-diagnosis:v1:11111111-1111-4111-8111-111111111111:44444444-4444-4444-8444-444444444444",
    JSON.stringify({ version: 1, idempotencyKey }),
  );
  serviceMocks.getLatestGbpHealthResult.mockResolvedValue({
    source: "manual",
    diagnosedAt: "2026-08-12T12:00:00.000Z",
    result: { score: 56, checks: [] },
  });
  serviceMocks.checkGbpHealth.mockResolvedValue(
    gbpHealthDiagnosis({ score: 78, checks: [] }),
  );
  renderPage(<GbpHealthPage />);

  const recover = await screen.findByRole("button", { name: "結果を確認する" });
  expect(screen.queryByText("診断結果：56点")).not.toBeInTheDocument();
  fireEvent.click(recover);

  expect(await screen.findByText("診断結果：78点")).toBeVisible();
  expect(serviceMocks.checkGbpHealth).toHaveBeenCalledWith(
    "44444444-4444-4444-8444-444444444444",
    { useConnection: true },
    idempotencyKey,
  );
});

test("前回失敗が確定したkeyは破棄し、新しい診断を開始できる", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_health",
        title: "プロフィール診断",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  const storageKey =
    "kuchitoru-zero:gbp-health-diagnosis:v1:11111111-1111-4111-8111-111111111111:44444444-4444-4444-8444-444444444444";
  const failedKey = "77777777-7777-4777-8777-777777777777";
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({ version: 1, idempotencyKey: failedKey }),
  );
  serviceMocks.checkGbpHealth
    .mockRejectedValueOnce(
      new ApiError({
        code: "HEALTH_DIAGNOSIS_PREVIOUSLY_FAILED",
        message:
          "前回の診断は完了しませんでした。新しい操作としてやり直してください。",
        status: 409,
      }),
    )
    .mockResolvedValueOnce(gbpHealthDiagnosis({ score: 100, checks: [] }));
  renderPage(<GbpHealthPage />);

  fireEvent.click(
    await screen.findByRole("button", { name: "結果を確認する" }),
  );
  expect(
    await screen.findByText(
      "前回の診断は完了しませんでした。新しい操作としてやり直してください。",
    ),
  ).toBeVisible();
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  expect(
    screen.getByRole("button", { name: "Googleの登録内容を診断する" }),
  ).toBeVisible();

  fireEvent.click(
    screen.getByRole("button", { name: "Googleの登録内容を診断する" }),
  );
  expect(await screen.findByText("診断結果：100点")).toBeVisible();
  const newKey = serviceMocks.checkGbpHealth.mock.calls[1]?.[2];
  expect(newKey).toMatch(/^[0-9a-f-]{36}$/u);
  expect(newKey).not.toBe(failedKey);
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
});

test("保存期限切れは失敗済みと区別して案内し、keyを破棄して新しい診断へ戻す", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_health",
        title: "プロフィール診断",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  const storageKey =
    "kuchitoru-zero:gbp-health-diagnosis:v1:11111111-1111-4111-8111-111111111111:44444444-4444-4444-8444-444444444444";
  const expiredKey = "99999999-9999-4999-8999-999999999999";
  const backendMessage =
    "保存期間を過ぎたため前回の診断結果は破棄されました。新しい診断としてやり直してください。";
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({ version: 1, idempotencyKey: expiredKey }),
  );
  serviceMocks.checkGbpHealth
    .mockRejectedValueOnce(
      new ApiError({
        code: "HEALTH_DIAGNOSIS_RESULT_EXPIRED",
        message: backendMessage,
        status: 410,
      }),
    )
    .mockResolvedValueOnce(gbpHealthDiagnosis({ score: 100, checks: [] }));
  renderPage(<GbpHealthPage />);

  fireEvent.click(
    await screen.findByRole("button", { name: "結果を確認する" }),
  );
  expect(
    await screen.findByText(
      "前回の診断結果は保存期限を過ぎたため確認できません。新しい診断を始める場合は、もう一度「Googleの登録内容を診断する」を押してください。",
    ),
  ).toBeVisible();
  expect(screen.queryByText(backendMessage)).not.toBeInTheDocument();
  expect(
    screen.queryByText(
      "前回の診断は完了しませんでした。新しい操作としてやり直してください。",
    ),
  ).not.toBeInTheDocument();
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  expect(
    screen.getByRole("button", { name: "Googleの登録内容を診断する" }),
  ).toBeVisible();

  fireEvent.click(
    screen.getByRole("button", { name: "Googleの登録内容を診断する" }),
  );
  expect(await screen.findByText("診断結果：100点")).toBeVisible();
  const newKey = serviceMocks.checkGbpHealth.mock.calls[1]?.[2];
  expect(newKey).toMatch(/^[0-9a-f-]{36}$/u);
  expect(newKey).not.toBe(expiredKey);
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
});

test.each([
  ["HEALTH_DIAGNOSIS_IN_PROGRESS", 409],
  ["HEALTH_DIAGNOSIS_ATTENTION_REQUIRED", 409],
  ["PROVIDER_RESULT_SETTLEMENT_FAILED", 503],
])("%sでは保存済みkeyを維持して結果確認へ戻す", async (code, status) => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_health",
        title: "プロフィール診断",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  const storageKey =
    "kuchitoru-zero:gbp-health-diagnosis:v1:11111111-1111-4111-8111-111111111111:44444444-4444-4444-8444-444444444444";
  const idempotencyKey = "66666666-6666-4666-8666-666666666666";
  const message = `${code} response`;
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({ version: 1, idempotencyKey }),
  );
  serviceMocks.checkGbpHealth.mockRejectedValue(
    new ApiError({ code, message, status }),
  );
  renderPage(<GbpHealthPage />);

  fireEvent.click(
    await screen.findByRole("button", { name: "結果を確認する" }),
  );
  expect(await screen.findByText(message)).toBeVisible();
  expect(
    JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null"),
  ).toEqual({ version: 1, idempotencyKey });
  expect(screen.getByRole("button", { name: "結果を確認する" })).toBeVisible();
});

test("別ownerの保存済みkeyを読み込まず、現在ownerの名前空間で新しいintentを保存する", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_health",
        title: "プロフィール診断",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  const oldOwnerStorageKey =
    "kuchitoru-zero:gbp-health-diagnosis:v1:11111111-1111-4111-8111-111111111111:44444444-4444-4444-8444-444444444444";
  const currentOwnerStorageKey =
    "kuchitoru-zero:gbp-health-diagnosis:v1:22222222-2222-4222-8222-222222222222:44444444-4444-4444-8444-444444444444";
  const staleKey = "55555555-5555-4555-8555-555555555555";
  window.sessionStorage.setItem(
    oldOwnerStorageKey,
    JSON.stringify({ version: 1, idempotencyKey: staleKey }),
  );
  authMock.user.id = "22222222-2222-4222-8222-222222222222";
  serviceMocks.checkGbpHealth.mockRejectedValue(
    new ApiError({
      code: "NETWORK_ERROR",
      message: "通信できませんでした。",
      retryable: true,
      status: 0,
    }),
  );
  renderPage(<GbpHealthPage />);

  fireEvent.click(await waitForGbpHealthInput());
  expect(
    await screen.findByText(
      "処理結果を確認できません。再実行せず接続状態を確認してください。",
    ),
  ).toBeVisible();

  const currentKey = serviceMocks.checkGbpHealth.mock.calls[0]?.[2];
  expect(currentKey).toMatch(/^[0-9a-f-]{36}$/u);
  expect(currentKey).not.toBe(staleKey);
  expect(
    JSON.parse(window.sessionStorage.getItem(oldOwnerStorageKey) ?? "null"),
  ).toEqual({ version: 1, idempotencyKey: staleKey });
  expect(
    JSON.parse(window.sessionStorage.getItem(currentOwnerStorageKey) ?? "null"),
  ).toEqual({ version: 1, idempotencyKey: currentKey });
});

test("診断成功までにownerと店舗を切り替えても旧scopeのkeyだけを消す", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_health",
        title: "プロフィール診断",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  const oldScopeStorageKey =
    "kuchitoru-zero:gbp-health-diagnosis:v1:11111111-1111-4111-8111-111111111111:44444444-4444-4444-8444-444444444444";
  const newScopeStorageKey =
    "kuchitoru-zero:gbp-health-diagnosis:v1:22222222-2222-4222-8222-222222222222:55555555-5555-4555-8555-555555555555";
  const newScopeIntentKey = "33333333-3333-4333-8333-333333333333";
  const request = deferred<Record<string, unknown>>();
  window.sessionStorage.setItem(
    newScopeStorageKey,
    JSON.stringify({ version: 1, idempotencyKey: newScopeIntentKey }),
  );
  serviceMocks.checkGbpHealth.mockReturnValue(request.promise);
  renderGbpHealthScopeSwitchHarness();

  fireEvent.click(await waitForGbpHealthInput());
  await waitFor(() =>
    expect(serviceMocks.checkGbpHealth).toHaveBeenCalledTimes(1),
  );
  const oldScopeIntentKey = serviceMocks.checkGbpHealth.mock.calls[0]?.[2];
  expect(serviceMocks.checkGbpHealth).toHaveBeenCalledWith(
    "44444444-4444-4444-8444-444444444444",
    { useConnection: true },
    oldScopeIntentKey,
  );
  expect(
    JSON.parse(window.sessionStorage.getItem(oldScopeStorageKey) ?? "null"),
  ).toEqual({ version: 1, idempotencyKey: oldScopeIntentKey });

  fireEvent.click(
    screen.getByRole("button", { name: "ownerと店舗を切り替える" }),
  );
  expect(
    await screen.findByRole("button", { name: "結果を確認する" }),
  ).toBeVisible();
  request.resolve(gbpHealthDiagnosis({ score: 100, checks: [] }));

  await waitFor(() =>
    expect(window.sessionStorage.getItem(oldScopeStorageKey)).toBeNull(),
  );
  expect(
    JSON.parse(window.sessionStorage.getItem(newScopeStorageKey) ?? "null"),
  ).toEqual({ version: 1, idempotencyKey: newScopeIntentKey });
  expect(screen.getByRole("button", { name: "結果を確認する" })).toBeVisible();
  expect(screen.queryByText("診断結果：100点")).not.toBeInTheDocument();
});

test("診断期限切れまでにownerと店舗を切り替えても旧scopeのkeyだけを消す", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_health",
        title: "プロフィール診断",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  const oldScopeStorageKey =
    "kuchitoru-zero:gbp-health-diagnosis:v1:11111111-1111-4111-8111-111111111111:44444444-4444-4444-8444-444444444444";
  const newScopeStorageKey =
    "kuchitoru-zero:gbp-health-diagnosis:v1:22222222-2222-4222-8222-222222222222:55555555-5555-4555-8555-555555555555";
  const newScopeIntentKey = "33333333-3333-4333-8333-333333333333";
  const request = deferred<Record<string, unknown>>();
  window.sessionStorage.setItem(
    newScopeStorageKey,
    JSON.stringify({ version: 1, idempotencyKey: newScopeIntentKey }),
  );
  serviceMocks.checkGbpHealth.mockReturnValue(request.promise);
  renderGbpHealthScopeSwitchHarness();

  fireEvent.click(await waitForGbpHealthInput());
  await waitFor(() =>
    expect(serviceMocks.checkGbpHealth).toHaveBeenCalledTimes(1),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "ownerと店舗を切り替える" }),
  );
  expect(
    await screen.findByRole("button", { name: "結果を確認する" }),
  ).toBeVisible();
  request.reject(
    new ApiError({
      code: "HEALTH_DIAGNOSIS_RESULT_EXPIRED",
      message:
        "保存期間を過ぎたため前回の診断結果は破棄されました。新しい診断としてやり直してください。",
      status: 410,
    }),
  );

  await waitFor(() =>
    expect(window.sessionStorage.getItem(oldScopeStorageKey)).toBeNull(),
  );
  expect(
    JSON.parse(window.sessionStorage.getItem(newScopeStorageKey) ?? "null"),
  ).toEqual({ version: 1, idempotencyKey: newScopeIntentKey });
  expect(screen.getByRole("button", { name: "結果を確認する" })).toBeVisible();
  expect(
    screen.queryByText(/前回の診断結果は保存期限を過ぎたため確認できません/u),
  ).not.toBeInTheDocument();
});

test("手入力診断は表示した9項目をAPIの同じ評価軸へ送る", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_health",
        title: "プロフィール診断",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  serviceMocks.checkGbpHealth.mockResolvedValue(
    gbpHealthDiagnosis(
      { score: 100, checks: [] },
      "manual",
      "2026-08-12T14:25:00.000Z",
    ),
  );
  renderPage(<GbpHealthPage />);

  await waitForGbpHealthInput();

  for (const label of [
    "店舗の説明文を登録している",
    "営業時間と定休日が最新",
    "Webサイトまたは予約ページが正しい",
    "お客様向けの電話番号が正しい",
    "主なカテゴリを1つ選んでいる",
    "写真が5枚以上あり、30日以内に更新した",
    "30日以内に最新情報を投稿した",
    "最近の口コミに返信している",
    "直近90日に口コミが5件以上ある",
  ]) {
    fireEvent.click(screen.getByLabelText(label));
  }
  fireEvent.click(screen.getByRole("button", { name: "手入力で診断する" }));

  await waitFor(() => {
    expect(serviceMocks.checkGbpHealth).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444",
      {
        useConnection: false,
        hasBusinessDescription: true,
        hasWebsite: true,
        hasBusinessHours: true,
        hasPhoneNumber: true,
        hasPrimaryCategory: true,
        photoCount: 5,
        videoCount: 0,
        daysSinceLastMedia: 0,
        postCount: 1,
        daysSinceLastPost: 0,
        reviewReplyRate: 1,
        recentReviewCount: 5,
      },
      expect.stringMatching(/^[0-9a-f-]{36}$/u),
    );
  });
  expect(await screen.findByText("診断結果：100点")).toBeVisible();
  expect(screen.getByText("2026年8月12日 23:25")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "手入力で診断する" }),
  ).not.toBeInTheDocument();
});

test("保存済み診断はreload時に入力を出さず結果画面として表示し、再診断へ戻れる", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_health",
        title: "プロフィール診断",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  serviceMocks.getLatestGbpHealthResult.mockResolvedValue({
    source: "manual",
    diagnosedAt: "2026-08-12T12:00:00.000Z",
    result: {
      score: 56,
      checks: [
        {
          id: "hours",
          title: "営業時間",
          status: "good",
          summary: "営業時間を登録済みです。",
          nextAction: null,
        },
      ],
    },
  });
  renderPage(<GbpHealthPage />);

  expect(await screen.findByText("診断結果：56点")).toBeVisible();
  expect(screen.getByText("2026年8月12日 21:00")).toBeVisible();
  expect(
    screen.getByText("2026年8月12日 21:00").closest("time"),
  ).toHaveAttribute("dateTime", "2026-08-12T12:00:00.000Z");
  expect(screen.getByRole("heading", { name: "診断結果：56点" })).toHaveFocus();
  expect(
    screen.queryByRole("button", { name: "Googleの登録内容を診断する" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "手入力で診断する" }),
  ).not.toBeInTheDocument();
  expect(serviceMocks.checkGbpHealth).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "もう一度診断する" }));
  expect(
    screen.getByRole("button", { name: "Googleの登録内容を診断する" }),
  ).toBeVisible();
  expect(screen.queryByText("診断結果：56点")).not.toBeInTheDocument();
});

test("保存済み結果から再診断を始めると、処理中に古い結果へ戻らない", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_health",
        title: "プロフィール診断",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  serviceMocks.getLatestGbpHealthResult.mockResolvedValue({
    source: "manual",
    diagnosedAt: "2026-08-12T12:00:00.000Z",
    result: { score: 56, checks: [] },
  });
  const nextDiagnosis =
    deferred<
      ReturnType<typeof gbpHealthDiagnosis<{ score: number; checks: never[] }>>
    >();
  serviceMocks.checkGbpHealth.mockReturnValue(nextDiagnosis.promise);
  renderPage(<GbpHealthPage />);

  expect(await screen.findByText("診断結果：56点")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "もう一度診断する" }));
  fireEvent.click(screen.getByRole("button", { name: "手入力で診断する" }));

  expect(screen.queryByText("診断結果：56点")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "手入力で診断する" }),
  ).toHaveAttribute("aria-busy", "true");
  nextDiagnosis.resolve(
    gbpHealthDiagnosis(
      { score: 78, checks: [] },
      "manual",
      "2026-08-12T14:30:00.000Z",
    ),
  );
  expect(await screen.findByText("診断結果：78点")).toBeVisible();
  expect(screen.getByText("2026年8月12日 23:30")).toBeVisible();
});

test("保存済み診断の読込中は入力を表示せず、失敗後も新しい診断を実行できる", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_health",
        title: "プロフィール診断",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  const latest = deferred<null>();
  serviceMocks.getLatestGbpHealthResult.mockReturnValue(latest.promise);
  renderPage(<GbpHealthPage />);

  expect(screen.getByText("保存した診断結果を読み込んでいます")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Googleの登録内容を診断する" }),
  ).not.toBeInTheDocument();
  latest.reject(
    new ApiError({
      code: "NETWORK_ERROR",
      message: "通信できませんでした。",
      status: 0,
    }),
  );

  expect(
    await screen.findByText(
      "保存した診断結果を読み込めませんでした。新しい診断は実行できます。",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Googleの登録内容を診断する" }),
  ).toBeVisible();
});

test("別店舗のlatestが遅れて返っても現在店舗へ表示しない", async () => {
  capabilitiesMock.mockResolvedValue({
    serverTime: "2026-08-11T03:00:00.000Z",
    features: [
      {
        key: "gbp_health",
        title: "プロフィール診断",
        status: "available",
        releaseAt: null,
        executionMode: "native",
        reason: null,
      },
    ],
  });
  const oldLatest = deferred<{
    source: "manual";
    diagnosedAt: string;
    result: { score: number; checks: never[] };
  } | null>();
  serviceMocks.getLatestGbpHealthResult.mockImplementation((storeId: string) =>
    storeId === "44444444-4444-4444-8444-444444444444"
      ? oldLatest.promise
      : Promise.resolve(null),
  );
  renderGbpHealthScopeSwitchHarness();

  expect(screen.getByText("保存した診断結果を読み込んでいます")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "ownerと店舗を切り替える" }),
  );
  expect(
    await screen.findByRole("button", { name: "Googleの登録内容を診断する" }),
  ).toBeVisible();
  oldLatest.resolve({
    source: "manual",
    diagnosedAt: "2026-08-12T12:00:00.000Z",
    result: { score: 12, checks: [] },
  });

  await waitFor(() =>
    expect(serviceMocks.getLatestGbpHealthResult).toHaveBeenCalledTimes(2),
  );
  expect(screen.queryByText("診断結果：12点")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Googleの登録内容を診断する" }),
  ).toBeVisible();
});
