import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  Clipboard,
  ExternalLink,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ApiError } from "../../shared/api/http";
import { useI18n, type Locale } from "../../shared/i18n";
import { copyText } from "../../shared/lib/clipboard";
import { createIdempotencyKey } from "../../shared/lib/idempotency";
import {
  Button,
  LoadingState,
  Notice,
  PageTitle,
  Panel,
} from "../../shared/ui/ui";
import { useAuth } from "../auth/auth-context";
import { getOwnerStore } from "../owner/owner-api";
import { ownerStorePath, useActiveStoreId } from "../owner/store-scope";
import type { MeoFeatureKey } from "./feature-registry";
import { meoFeatureCapabilitiesQueryOptions } from "./meo-api";
import {
  HEALTH_CHECKS,
  buildGoogleMapsSearchUrl,
  summarizeInsights,
  type HealthCheckKey,
  type InsightSummary,
} from "./meo-tools";
import {
  checkGbpHealth,
  createInstagramGbpDraft,
  createReviewReplyDraft,
  getInsightHistory,
  getLatestGbpHealthResult,
  getGoogleReviews,
  getMeoExternalWriteSettings,
  getInstagramMedia,
  getRankHistory,
  publishGoogleReviewReply,
  publishInstagramDraftToGoogle,
  requestRankMeasurement,
  saveManualInsights,
  saveManualRank,
  syncGoogleInsights,
  type GoogleReview,
  type GbpHealthResult,
  type InsightMetrics,
  type InsightSnapshot,
  type RankHistoryItem,
} from "./meo-service-api";

function useExecutionMode(featureKey: MeoFeatureKey) {
  const storeId = useActiveStoreId();
  const query = useQuery(meoFeatureCapabilitiesQueryOptions(storeId));
  return query.data?.features.find((feature) => feature.key === featureKey)
    ?.executionMode;
}

function ManualFirstNotice({
  featureKey,
  writeAction = false,
}: {
  featureKey: MeoFeatureKey;
  writeAction?: boolean;
}) {
  const { locale } = useI18n();
  const t = (ja: string, en: string) => (locale === "ja" ? ja : en);
  const executionMode = useExecutionMode(featureKey);
  if (writeAction) {
    const modeNotice =
      executionMode === "owner_provider"
        ? t(
            "文章生成には店舗管理者の外部AI接続を使います。",
            "Text generation uses the external AI provider connected by the store owner.",
          )
        : "";
    return (
      <Notice tone="info">
        {modeNotice}
        {modeNotice ? " " : ""}
        {t(
          "Googleへは確認後に送信します。",
          "Nothing is sent to Google until you review it.",
        )}
      </Notice>
    );
  }
  if (executionMode === "owner_provider")
    return (
      <Notice tone="info">
        {t(
          "自動取得には外部サービス接続が必要です。",
          "Automatic retrieval requires an external service connection.",
        )}
      </Notice>
    );
  return null;
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const { locale } = useI18n();
  label ??= locale === "ja" ? "コピーする" : "Copy";
  const [message, setMessage] = useState("");
  const copy = async () => {
    const copied = await copyText(value);
    setMessage(
      copied
        ? locale === "ja"
          ? "コピーしました。"
          : "Copied."
        : locale === "ja"
          ? "コピーできませんでした。文章を選択してコピーしてください。"
          : "Could not copy. Select the text and copy it manually.",
    );
  };
  return (
    <div className="meo-copy-action">
      <Button type="button" variant="secondary" onClick={() => void copy()}>
        <Clipboard aria-hidden="true" />
        {label}
      </Button>
      {message ? <span role="status">{message}</span> : null}
    </div>
  );
}

function OperationError({ error }: { error: Error; storeId: string }) {
  const { locale } = useI18n();
  return (
    <Notice tone="error">
      <strong>
        {locale === "ja"
          ? error.message
          : "The operation could not be completed. Please try again."}
      </strong>
    </Notice>
  );
}

function PublishGate({
  previewReady,
  approvalKey,
  actionLabel,
  onPublish,
}: {
  previewReady: boolean;
  approvalKey: string;
  actionLabel: string;
  onPublish?: () => Promise<unknown>;
}) {
  const { locale } = useI18n();
  const t = (ja: string, en: string) => (locale === "ja" ? ja : en);
  const storeId = useActiveStoreId();
  const [approvedKey, setApprovedKey] = useState<string | null>(null);
  const approved = approvedKey === approvalKey;
  const [showConnectionNotice, setShowConnectionNotice] = useState(false);
  const externalWritesQuery = useQuery({
    queryKey: ["meo-external-writes", storeId],
    queryFn: () => getMeoExternalWriteSettings(storeId),
    retry: false,
  });
  const externalWritesEnabled = externalWritesQuery.data?.enabled === true;
  const canExecuteExternalWrites = externalWritesQuery.data?.canExecute === true;
  const mutation = useMutation({ mutationFn: async () => onPublish?.() });
  const submit = () => {
    if (!externalWritesEnabled || !canExecuteExternalWrites) return;
    if (!onPublish) {
      setShowConnectionNotice(true);
      return;
    }
    mutation.mutate();
  };
  return (
    <section className="meo-publish-gate" aria-labelledby="meo-publish-title">
      <div>
        <h2 id="meo-publish-title">
          {t("Googleへ投稿する前の確認", "Review before posting to Google")}
        </h2>
      </div>
      <label className="consent-row">
        <input
          type="checkbox"
          checked={externalWritesEnabled && canExecuteExternalWrites && approved}
          disabled={!previewReady || !externalWritesEnabled || !canExecuteExternalWrites || mutation.isSuccess}
          onChange={(event) => {
            setApprovedKey(event.target.checked ? approvalKey : null);
            setShowConnectionNotice(false);
          }}
        />
        {t(
          "この内容をGoogleに投稿してよいことを確認しました",
          "I confirm that this content may be posted to Google",
        )}
      </label>
      <Button
        type="button"
        disabled={!previewReady || !externalWritesEnabled || !canExecuteExternalWrites || !approved || mutation.isSuccess}
        busy={mutation.isPending}
        onClick={submit}
      >
        <ShieldCheck aria-hidden="true" />
        {actionLabel}
      </Button>
      {externalWritesQuery.isLoading ? (
        <LoadingState
          label={t(
            "外部書き込みの設定を確認しています",
            "Checking the external write setting",
          )}
        />
      ) : null}
      {externalWritesQuery.isError ? (
        <Notice tone="warning">
          {t(
            "外部書き込みの設定を確認できないため、Googleへの送信を止めています。文章はコピーできます。",
            "Posting to Google is disabled because the external write setting could not be loaded. You can still copy the text.",
          )}
        </Notice>
      ) : null}
      {externalWritesQuery.isSuccess && !externalWritesQuery.data.enabled ? (
        <Notice tone="info">
          <strong>
            {t(
              "外部書き込みは無効です。",
              "Writes to external services are disabled.",
            )}
          </strong>
          <p>
            {externalWritesQuery.data.canManage
              ? t(
                  "外部サービス接続で有効にすると、この画面から送信できます。文章のコピーはいつでも使えます。",
                  "Enable this under External service connections to post from this page. You can copy the text at any time.",
                )
              : t(
                  "店舗のオーナーまたは管理者に有効化を依頼してください。文章のコピーはいつでも使えます。",
                  "Ask a store owner or administrator to enable it. You can copy the text at any time.",
                )}
          </p>
          {externalWritesQuery.data.canManage ? (
            <Link to={ownerStorePath(storeId, "/connections")}>
              {t("外部書き込み設定を開く", "Open external write settings")}
            </Link>
          ) : null}
        </Notice>
      ) : null}
      {externalWritesQuery.isSuccess && externalWritesQuery.data.enabled && !externalWritesQuery.data.canExecute ? (
        <Notice tone="info">
          {t(
            "閲覧専用の担当者はGoogleへ送信できません。文章のコピーは利用できます。",
            "Read-only members cannot send to Google. You can still copy the text.",
          )}
        </Notice>
      ) : null}
      {mutation.isSuccess ? (
        <Notice tone="success">
          {t("Googleへ送信しました。", "Sent to Google.")}
        </Notice>
      ) : null}
      {mutation.isError ? (
        <OperationError error={mutation.error} storeId={storeId} />
      ) : null}
      {showConnectionNotice ? (
        <Notice tone="warning">
          <strong>
            {t(
              "この入力だけではGoogleへ直接送信できません。",
              "This input alone cannot be sent directly to Google.",
            )}
          </strong>
          <p>
            {t(
              "文章をコピーしてGoogleから送信するか、外部サービス接続からGoogleを接続してください。",
              "Copy the text and send it from Google, or connect Google under External services.",
            )}
          </p>
          <Link to={ownerStorePath(storeId, "/connections")}>
            {t("外部サービス接続を開く", "Open external service connections")}
          </Link>
        </Notice>
      ) : null}
    </section>
  );
}

export function ReviewReplyPage() {
  const { locale } = useI18n();
  const t = (ja: string, en: string) => (locale === "ja" ? ja : en);
  const storeId = useActiveStoreId();
  const executionMode = useExecutionMode("review_reply");
  const storeQuery = useQuery({
    queryKey: ["owner-store", storeId],
    queryFn: () => getOwnerStore(storeId),
  });
  const [review, setReview] = useState("");
  const [rating, setRating] = useState(5);
  const [tone, setTone] = useState<"polite" | "warm" | "short">("polite");
  const [reply, setReply] = useState("");
  const [replyRevision, setReplyRevision] = useState(0);
  const updateReply = (value: string) => {
    setReply(value);
    setReplyRevision((revision) => revision + 1);
  };
  const [loadGoogleReviews, setLoadGoogleReviews] = useState(false);
  const [selectedReview, setSelectedReview] = useState<GoogleReview | null>(
    null,
  );
  const reviewsQuery = useQuery({
    queryKey: ["meo-google-reviews", storeId],
    queryFn: () => getGoogleReviews(storeId),
    enabled: loadGoogleReviews,
    retry: false,
  });
  const draftMutation = useMutation({
    mutationFn: () =>
      createReviewReplyDraft(storeId, {
        rating,
        reviewComment: review,
        ...(selectedReview?.reviewerName
          ? { reviewerName: selectedReview.reviewerName }
          : {}),
        ...(storeQuery.data?.name ? { storeName: storeQuery.data.name } : {}),
        tone,
        locale,
        generationMode:
          executionMode === "owner_provider" ? "owner_provider" : "template",
      }),
    onSuccess: (draft) => updateReply(draft.reply),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    draftMutation.mutate();
  };

  return (
    <div className="owner-page meo-feature-page">
      <PageTitle title={t("口コミ返信", "Review replies")} showTitle />
      <ManualFirstNotice featureKey="review_reply" writeAction />
      <Panel>
        <h2>{t("Googleの口コミから選ぶ", "Choose a Google review")}</h2>
        <p className="field-help">
          {t(
            "接続済みなら、口コミを読み込んで返信できます。",
            "If connected, load a review and write a reply.",
          )}
        </p>
        <Button
          type="button"
          variant="secondary"
          busy={reviewsQuery.isFetching}
          onClick={() => setLoadGoogleReviews(true)}
        >
          {t("Googleの口コミを読み込む", "Load Google reviews")}
        </Button>
        {reviewsQuery.isError ? (
          <Notice tone="warning">
            <strong>
              {t(
                "Googleの口コミを読み込めませんでした。",
                "Could not load Google reviews.",
              )}
            </strong>
            <p>
              {t(
                "接続を確認するか、下の欄へ口コミを貼り付けて返信案だけ作れます。",
                "Check the connection, or paste a review below to create a reply draft.",
              )}
            </p>
          </Notice>
        ) : null}
        {(reviewsQuery.data ?? []).length > 0 ? (
          <div
            className="meo-review-list"
            aria-label={t("Googleの口コミ一覧", "Google reviews")}
          >
            {(reviewsQuery.data ?? []).map((item) => (
              <button
                type="button"
                key={item.name}
                className="meo-review-card"
                aria-pressed={selectedReview?.name === item.name}
                onClick={() => {
                  setSelectedReview(item);
                  setReview(item.comment ?? "");
                  setRating(
                    Math.min(5, Math.max(1, Math.round(item.rating ?? 3))),
                  );
                  updateReply("");
                }}
              >
                <strong>
                  {item.reviewerName ?? t("名前なし", "No name")}
                  {t("・星", " · Rating ")}
                  {item.rating ?? "—"}
                </strong>
                <span>
                  {item.comment ||
                    t("コメントのない口コミ", "Review without a comment")}
                </span>
                <small>
                  {item.replyComment
                    ? t(
                        "返信済み（新しい返信で更新されます）",
                        "Replied (a new reply will replace it)",
                      )
                    : t("未返信", "Not replied")}
                </small>
              </button>
            ))}
          </div>
        ) : null}
      </Panel>
      <Panel>
        <form className="form-stack meo-primary-form" onSubmit={submit}>
          <label>
            {t("お客様の口コミ", "Customer review")}
            <textarea
              required
              maxLength={2000}
              value={review}
              onChange={(event) => {
                setReview(event.target.value);
                setSelectedReview(null);
              }}
              placeholder={t(
                "例：料理がおいしく、店員さんも親切でした。",
                "Example: The food was delicious and the staff were very helpful.",
              )}
            />
          </label>
          <div className="meo-form-grid">
            <label>
              {t("星の数", "Rating")}
              <select
                value={rating}
                onChange={(event) => setRating(Number(event.target.value))}
              >
                <option value={5}>{t("星5", "5 stars")}</option>
                <option value={4}>{t("星4", "4 stars")}</option>
                <option value={3}>{t("星3", "3 stars")}</option>
                <option value={2}>{t("星2", "2 stars")}</option>
                <option value={1}>{t("星1", "1 stars")}</option>
              </select>
            </label>
            <label>
              {t("文章の雰囲気", "Tone")}
              <select
                value={tone}
                onChange={(event) => setTone(event.target.value as typeof tone)}
              >
                <option value="polite">
                  {t("きちんと丁寧", "Professional and polite")}
                </option>
                <option value="warm">
                  {t("親しみやすい", "Warm and friendly")}
                </option>
                <option value="short">
                  {t("短く簡潔", "Short and concise")}
                </option>
              </select>
            </label>
          </div>
          <Button type="submit" busy={draftMutation.isPending}>
            <Sparkles aria-hidden="true" />
            {t("返信案を作る", "Create reply draft")}
          </Button>
          {draftMutation.isError ? (
            <OperationError error={draftMutation.error} storeId={storeId} />
          ) : null}
        </form>
      </Panel>
      {reply ? (
        <Panel className="meo-result" aria-live="polite">
          <div className="meo-result__heading">
            <Check aria-hidden="true" />
            <h2>{t("返信案ができました", "Your reply draft is ready")}</h2>
          </div>
          <label>
            {t(
              "投稿前に、必ず内容を確認してください",
              "Review the content before posting",
            )}
            <textarea
              value={reply}
              onChange={(event) => updateReply(event.target.value)}
            />
          </label>
          <CopyButton
            value={reply}
            label={t("返信案をコピー", "Copy reply draft")}
          />
          <PublishGate
            previewReady={reply.trim() !== ""}
            approvalKey={JSON.stringify([
              storeId,
              selectedReview?.name ?? null,
              replyRevision,
            ])}
            actionLabel={
              selectedReview
                ? t("確認してGoogleへ返信する", "Review and reply on Google")
                : t("Googleへの返信準備をする", "Prepare a Google reply")
            }
            {...(selectedReview
              ? {
                  onPublish: () =>
                    publishGoogleReviewReply(storeId, {
                      reviewName: selectedReview.name,
                      comment: reply,
                      confirmed: true,
                    }),
                }
              : {})}
          />
        </Panel>
      ) : null}
    </div>
  );
}

const placeIdPattern = /^[A-Za-z0-9_-]{10,255}$/;

function rankPositionLabel(
  position: number | null,
  locale: Locale = "ja",
): string {
  return position === null
    ? locale === "ja"
      ? "100位以内に見つからず"
      : "Not found in the top 100"
    : locale === "ja"
      ? `${position}位`
      : `No. ${position}`;
}

function rankSourceLabel(
  source: RankHistoryItem["source"],
  locale: Locale = "ja",
): string {
  if (source === "manual")
    return locale === "ja" ? "手動チェック" : "Manual check";
  if (source === "owner_provider")
    return locale === "ja" ? "自分のDataForSEO" : "Your DataForSEO";
  return locale === "ja" ? "手動チェック" : "Manual check";
}

function formatJapaneseDateTime(value: string, locale: Locale = "ja"): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    return locale === "ja" ? "日時不明" : "Unknown date";
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tokyo",
  }).format(parsed);
}

function formatJapaneseDiagnosisDateTime(
  value: string,
  locale: Locale = "ja",
): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    return locale === "ja" ? "日時不明" : "Unknown date";
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Tokyo",
  }).format(parsed);
}

function shortPlaceId(value: string): string {
  return value.length <= 8 ? value : `…${value.slice(-8)}`;
}

export function MeoRankPage() {
  const { locale } = useI18n();
  const t = (ja: string, en: string) => (locale === "ja" ? ja : en);
  const storeId = useActiveStoreId();
  const queryClient = useQueryClient();
  const executionMode = useExecutionMode("meo_rank");
  const storeQuery = useQuery({
    queryKey: ["owner-store", storeId],
    queryFn: () => getOwnerStore(storeId),
  });
  const [keyword, setKeyword] = useState("");
  const [area, setArea] = useState("");
  const [searchUrl, setSearchUrl] = useState("");
  const [ownRank, setOwnRank] = useState("");
  const [ownNotFound, setOwnNotFound] = useState(false);
  const [competitorRank, setCompetitorRank] = useState("");
  const [competitorPlaceIds, setCompetitorPlaceIds] = useState(["", "", ""]);
  const [locationError, setLocationError] = useState("");
  const [pollHistoryUntil, setPollHistoryUntil] = useState(0);
  const historyQuery = useQuery({
    queryKey: ["meo-rank-history", storeId],
    queryFn: () => getRankHistory(storeId),
    retry: false,
    refetchInterval: () => (Date.now() < pollHistoryUntil ? 10_000 : false),
  });
  const normalizedCompetitorPlaceIds = competitorPlaceIds
    .map((value) => value.trim())
    .filter(Boolean);
  const competitorPlaceIdError = normalizedCompetitorPlaceIds.some(
    (value) => !placeIdPattern.test(value),
  )
    ? t(
        "競合店のPlace IDは、10文字以上の英数字で入力してください。",
        "Enter a competitor Place ID with at least 10 letters or numbers.",
      )
    : new Set(normalizedCompetitorPlaceIds).size !==
        normalizedCompetitorPlaceIds.length
      ? t(
          "同じ競合店のPlace IDが重複しています。",
          "A competitor Place ID is duplicated.",
        )
      : normalizedCompetitorPlaceIds.includes(
            storeQuery.data?.google_place_id ?? "",
          )
        ? t(
            "自店と同じPlace IDは競合店に指定できません。",
            "Your own Place ID cannot be a competitor.",
          )
        : "";
  const manualMutation = useMutation({
    mutationFn: () =>
      saveManualRank(storeId, {
        keyword,
        targetPlaceId: storeQuery.data?.google_place_id ?? "",
        position: ownNotFound ? null : Number(ownRank),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["meo-rank-history", storeId],
      }),
  });
  const measureMutation = useMutation({
    mutationFn: ({
      latitude,
      longitude,
    }: {
      latitude: number;
      longitude: number;
    }) =>
      requestRankMeasurement(storeId, {
        keyword,
        targetPlaceId: storeQuery.data?.google_place_id ?? "",
        competitorPlaceIds: normalizedCompetitorPlaceIds,
        latitude,
        longitude,
        credentialSource: "owner_provider",
      }),
    onSuccess: () => {
      setPollHistoryUntil(Date.now() + 5 * 60_000);
      void queryClient.invalidateQueries({
        queryKey: ["meo-rank-history", storeId],
      });
    },
  });
  const own = Number(ownRank);
  const competitor = Number(competitorRank);
  const comparison =
    own > 0 && competitor > 0
      ? own < competitor
        ? t(
            `自店が${competitor - own}位上です。`,
            `Your business is ${competitor - own} places higher.`,
          )
        : own > competitor
          ? t(
              `競合店が${own - competitor}位上です。`,
              `The competitor is ${own - competitor} places higher.`,
            )
          : t("同じ順位です。", "The ranks are the same.")
      : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSearchUrl(buildGoogleMapsSearchUrl(keyword, area));
    setOwnRank("");
    setOwnNotFound(false);
    setCompetitorRank("");
  };

  const measureFromCurrentLocation = () => {
    setLocationError("");
    if (!navigator.geolocation) {
      setLocationError(
        t(
          "この端末では現在地を取得できません。手動チェックをご利用ください。",
          "This device cannot provide its location. Use the manual check.",
        ),
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        measureMutation.mutate({
          latitude: coords.latitude,
          longitude: coords.longitude,
        }),
      () =>
        setLocationError(
          t(
            "現在地を取得できませんでした。位置情報を許可するか、手動チェックをご利用ください。",
            "Could not get your location. Allow location access or use the manual check.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  return (
    <div className="owner-page meo-feature-page">
      <PageTitle
        title={t("順位・競合チェック", "Rank and competitor check")}
        showTitle
      />
      <ManualFirstNotice featureKey="meo_rank" />
      {historyQuery.isError ? (
        <Notice tone="error">
          {t(
            "順位機能の状態を確認できません。再読み込みしてお試しください。",
            "Could not check the rank feature. Reload and try again.",
          )}
        </Notice>
      ) : null}
      <Panel>
        <form className="form-stack meo-primary-form" onSubmit={submit}>
          <label>
            {t("調べる地域", "Search area")}
            <input
              required
              value={area}
              onChange={(event) => setArea(event.target.value)}
              placeholder={t("例：新宿駅", "Example: Shinjuku Station")}
            />
          </label>
          <label>
            {t("お客様が検索する言葉", "Customer search term")}
            <input
              required
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t("例：焼肉", "Example: barbecue")}
            />
          </label>
          <Button type="submit">
            <ArrowUpRight aria-hidden="true" />
            {t("Googleマップで確認する", "Check Google Maps")}
          </Button>
        </form>
      </Panel>
      {searchUrl ? (
        <Panel className="meo-result" aria-live="polite">
          <div className="meo-result__heading">
            <Check aria-hidden="true" />
            <h2>{t("順位を入力", "Enter ranks")}</h2>
          </div>
          <p>
            {t(
              "Googleマップを開き、自店と競合店の順位を入力します。",
              "Open Google Maps and enter your rank and a competitor rank.",
            )}
          </p>
          <a
            className="button button--secondary"
            href={searchUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("Googleマップを開く ", "Open Google Maps ")}
            <ExternalLink aria-hidden="true" />
          </a>
          <div className="meo-form-grid meo-rank-inputs">
            <label>
              {t("自店の順位", "Your rank")}
              <input
                type="number"
                min="1"
                max="100"
                inputMode="numeric"
                value={ownRank}
                disabled={ownNotFound}
                onChange={(event) => {
                  setOwnRank(event.target.value);
                  setOwnNotFound(false);
                }}
              />
            </label>
            <label className="consent-row">
              <input
                type="checkbox"
                checked={ownNotFound}
                onChange={(event) => {
                  setOwnNotFound(event.target.checked);
                  if (event.target.checked) setOwnRank("");
                }}
              />
              {t(
                "100位まで見ても自店が見つからなかった",
                "My business was not found in the top 100",
              )}
            </label>
            <label>
              {t("競合店の順位", "Competitor rank")}
              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={competitorRank}
                onChange={(event) => setCompetitorRank(event.target.value)}
              />
            </label>
          </div>
          {comparison ? (
            <Notice tone="success">
              <strong>{comparison}</strong>
              <p>
                {t(
                  "この手動比較は画面を閉じると消えます。競合も履歴に残す場合は、下の自動計測で競合店のPlace IDを入力してください。",
                  "This manual comparison disappears when you close the page. To keep competitor history, enter competitor Place IDs in the automatic measurement below.",
                )}
              </p>
            </Notice>
          ) : null}
          {storeQuery.data?.google_place_id ? (
            <Button
              type="button"
              variant="secondary"
              busy={manualMutation.isPending}
              disabled={(!ownRank && !ownNotFound) || historyQuery.isError}
              onClick={() => manualMutation.mutate()}
            >
              {t("今日の自店順位を保存する", "Save today’s rank")}
            </Button>
          ) : (
            <Notice tone="warning">
              <strong>
                {t(
                  "順位を保存するには店舗のPlace IDが必要です。",
                  "A business Place ID is required to save rank history.",
                )}
              </strong>
              <p>
                <Link to={ownerStorePath(storeId, "/store")}>
                  {t("店舗情報を開いて設定する", "Open business settings")}
                </Link>
              </p>
            </Notice>
          )}
          {manualMutation.isSuccess ? (
            <Notice tone="success">
              {t("今日の順位を保存しました。", "Today’s rank was saved.")}
            </Notice>
          ) : null}
          {manualMutation.isError ? (
            <Notice tone="error">
              {locale === "ja"
                ? manualMutation.error.message
                : t(
                    "",
                    "The operation could not be completed. Please try again.",
                  )}
            </Notice>
          ) : null}
          <p className="meo-disclaimer">
            {t(
              "これはGoogleマップを実際に見て記録する手動チェックです。自動取得した順位ではありません。",
              "This is a manual check recorded from Google Maps, not an automatically retrieved rank.",
            )}
          </p>
        </Panel>
      ) : null}
      {searchUrl &&
      storeQuery.data?.google_place_id &&
      executionMode === "owner_provider" ? (
        <Panel className="meo-result">
          <div className="meo-result__heading">
            <Sparkles aria-hidden="true" />
            <h2>{t("1日1回の自動計測", "Daily automatic measurement")}</h2>
          </div>
          <p>
            {t(
              "現在地を基準に計測し、結果を履歴へ保存します。",
              "Measure from your current location and save the result to history.",
            )}
          </p>
          <Notice tone="info">
            <strong>
              {t(
                "店舗管理者が接続したDataForSEOを利用します。",
                "The DataForSEO connection configured by the store owner will be used.",
              )}
            </strong>
            <p>
              <Link to={ownerStorePath(storeId, "/connections")}>
                {t("接続状態を確認する", "Check connection status")}
              </Link>
            </p>
          </Notice>
          <fieldset className="meo-competitor-fields">
            <legend>
              {t(
                "一緒に追う競合店（任意・3店舗まで）",
                "Competitors to track (optional, up to 3)",
              )}
            </legend>
            <p className="field-help">
              {t(
                "競合店のGoogle Place IDを入力します。わからなければ空欄のままで自店だけ計測できます。",
                "Enter competitor Google Place IDs. Leave them blank to measure only your business.",
              )}
            </p>
            {competitorPlaceIds.map((value, index) => (
              <label key={index}>
                {t(
                  `競合店${index + 1}のPlace ID`,
                  `Competitor ${index + 1} Place ID`,
                )}
                <input
                  value={value}
                  maxLength={255}
                  placeholder={t("例：ChIJ...", "Example: ChIJ...")}
                  onChange={(event) =>
                    setCompetitorPlaceIds((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? event.target.value : item,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </fieldset>
          {competitorPlaceIdError ? (
            <Notice tone="warning">{competitorPlaceIdError}</Notice>
          ) : null}
          <Button
            type="button"
            busy={measureMutation.isPending}
            disabled={historyQuery.isError || Boolean(competitorPlaceIdError)}
            onClick={measureFromCurrentLocation}
          >
            {t(
              "現在地で自動計測を予約する",
              "Schedule measurement from current location",
            )}
          </Button>
          {measureMutation.isSuccess ? (
            <Notice tone="success">
              {t(
                "計測を受け付けました。完了後に履歴へ追加します。",
                "Measurement requested. It will appear in history when complete.",
              )}
            </Notice>
          ) : null}
          {measureMutation.isError ? (
            <OperationError error={measureMutation.error} storeId={storeId} />
          ) : null}
          {locationError ? (
            <Notice tone="warning">{locationError}</Notice>
          ) : null}
          <p className="meo-disclaimer">
            {t(
              "順位は検索地点・時刻・Google側の表示により変わります。検索順位を保証するものではありません。",
              "Rank varies by location, time, and Google results; it is not guaranteed.",
            )}
          </p>
        </Panel>
      ) : null}
      <Panel>
        <h2>{t("過去30日の順位", "Rank history for the last 30 days")}</h2>
        {historyQuery.isLoading ? (
          <p role="status">
            {t("順位履歴を読み込んでいます。", "Loading rank history.")}
          </p>
        ) : null}
        {!historyQuery.isLoading && (historyQuery.data?.length ?? 0) === 0 ? (
          <Notice tone="info">
            {t("順位の記録はまだありません。", "No rank records yet.")}
          </Notice>
        ) : null}
        {(historyQuery.data ?? []).length > 0 ? (
          <div
            className="meo-history-list"
            aria-label={t("順位履歴", "Rank history")}
          >
            {(historyQuery.data ?? []).slice(0, 30).map((item) => (
              <article className="meo-history-card" key={item.id}>
                <header>
                  <div>
                    <strong>{item.keyword}</strong>
                    <small>{rankSourceLabel(item.source, locale)}</small>
                  </div>
                  <time dateTime={item.observed_at}>
                    {formatJapaneseDateTime(item.observed_at, locale)}
                  </time>
                </header>
                <dl className="meo-history-metrics">
                  <div>
                    <dt>{t("自店", "Your business")}</dt>
                    <dd>{rankPositionLabel(item.position, locale)}</dd>
                  </div>
                  {(Array.isArray(item.competitor_positions)
                    ? item.competitor_positions
                    : []
                  ).map((competitor, index) => (
                    <div key={competitor.place_id}>
                      <dt>
                        {t(`競合${index + 1}`, `Competitor ${index + 1}`)}{" "}
                        <small>{shortPlaceId(competitor.place_id)}</small>
                      </dt>
                      <dd>{rankPositionLabel(competitor.position, locale)}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

const insightMetricDefinitions: ReadonlyArray<{
  key: keyof InsightMetrics;
  label: Record<Locale, string>;
}> = [
  { key: "searches", label: { ja: "検索", en: "Searches" } },
  { key: "views", label: { ja: "表示", en: "Views" } },
  { key: "calls", label: { ja: "電話", en: "Calls" } },
  {
    key: "websiteClicks",
    label: { ja: "Webサイト", en: "Website visits" },
  },
  {
    key: "directionRequests",
    label: { ja: "経路", en: "Direction requests" },
  },
];

function insightMetricValue(
  metrics: InsightMetrics,
  key: keyof InsightMetrics,
): number {
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0;
}

function insightSourceLabel(
  source: InsightSnapshot["source"],
  locale: Locale,
): string {
  return source === "google_business"
    ? locale === "ja"
      ? "Googleから自動取得"
      : "Imported from Google"
    : locale === "ja"
      ? "手入力"
      : "Manual entry";
}

function insightPeriodLabel(
  snapshot: InsightSnapshot,
  locale: Locale,
): string {
  const separator = locale === "ja" ? "〜" : " – ";
  return `${snapshot.period_start.replaceAll("-", "/")}${separator}${snapshot.period_end.replaceAll("-", "/")}`;
}

export function GbpInsightsPage() {
  const { locale } = useI18n();
  const t = (ja: string, en: string) => (locale === "ja" ? ja : en);
  const storeId = useActiveStoreId();
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState<InsightSummary | null>(null);
  const [summarySource, setSummarySource] = useState<
    "manual" | "google_business" | null
  >(null);
  const historyQuery = useQuery({
    queryKey: ["meo-insight-history", storeId],
    queryFn: () => getInsightHistory(storeId),
    retry: false,
  });
  const dateDaysAgo = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const manualMutation = useMutation({
    mutationFn: (input: {
      views: number;
      calls: number;
      websiteClicks: number;
      directionRequests: number;
    }) =>
      saveManualInsights(storeId, {
        periodStart: dateDaysAgo(30),
        periodEnd: dateDaysAgo(1),
        current: { searches: 0, ...input },
        previous: {
          searches: 0,
          views: 0,
          calls: 0,
          websiteClicks: 0,
          directionRequests: 0,
        },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["meo-insight-history", storeId],
      }),
  });
  const syncMutation = useMutation({
    mutationFn: () =>
      syncGoogleInsights(storeId, {
        periodStart: dateDaysAgo(30),
        periodEnd: dateDaysAgo(1),
      }),
    onSuccess: (snapshot) => {
      setSummary(
        summarizeInsights({
          views: insightMetricValue(snapshot.metrics, "views"),
          calls: insightMetricValue(snapshot.metrics, "calls"),
          websiteClicks: insightMetricValue(snapshot.metrics, "websiteClicks"),
          directionRequests: insightMetricValue(
            snapshot.metrics,
            "directionRequests",
          ),
        }, locale),
      );
      setSummarySource("google_business");
      void queryClient.invalidateQueries({
        queryKey: ["meo-insight-history", storeId],
      });
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const number = (name: string) => Math.max(0, Number(data.get(name)) || 0);
    const input = {
      views: number("views"),
      calls: number("calls"),
      websiteClicks: number("websiteClicks"),
      directionRequests: number("directionRequests"),
    };
    manualMutation.mutate(input, {
      onSuccess: () => {
        setSummary(summarizeInsights(input, locale));
        setSummarySource("manual");
      },
    });
  };

  return (
    <div className="owner-page meo-feature-page">
      <PageTitle
        title={t("Googleマップ分析", "Google Maps insights")}
        showTitle
      />
      <ManualFirstNotice featureKey="gbp_insights" />
      <Panel>
        <form className="form-stack meo-primary-form" onSubmit={submit}>
          <p className="field-help">
            {t(
              "Googleビジネスプロフィールと同じ期間の数字を入力します。",
              "Enter figures for the same period as Google Business Profile.",
            )}
          </p>
          <div className="meo-form-grid">
            <label>
              {t("プロフィールを見た回数", "Profile views")}
              <input
                required
                name="views"
                type="number"
                min="0"
                inputMode="numeric"
                defaultValue="0"
              />
            </label>
            <label>
              {t("電話をかけた回数", "Calls")}
              <input
                required
                name="calls"
                type="number"
                min="0"
                inputMode="numeric"
                defaultValue="0"
              />
            </label>
            <label>
              {t("Webサイトを開いた回数", "Website visits")}
              <input
                required
                name="websiteClicks"
                type="number"
                min="0"
                inputMode="numeric"
                defaultValue="0"
              />
            </label>
            <label>
              {t("経路を調べた回数", "Direction requests")}
              <input
                required
                name="directionRequests"
                type="number"
                min="0"
                inputMode="numeric"
                defaultValue="0"
              />
            </label>
          </div>
          <Button type="submit" busy={manualMutation.isPending}>
            {t("数字をまとめて保存する", "Save figures")}
          </Button>
          {manualMutation.isError ? (
            <Notice tone="error">
              {locale === "ja"
                ? manualMutation.error.message
                : t(
                    "",
                    "The operation could not be completed. Please try again.",
                  )}
            </Notice>
          ) : null}
        </form>
      </Panel>
      <Panel>
        <h2>
          {t("Googleから自動で取り込む", "Import automatically from Google")}
        </h2>
        <p className="field-help">
          {t(
            "昨日までの30日分を取り込みます。手入力の履歴は残ります。",
            "Import the 30 days through yesterday. Manual history is retained.",
          )}
        </p>
        <Button
          type="button"
          variant="secondary"
          busy={syncMutation.isPending}
          onClick={() => syncMutation.mutate()}
        >
          {t("Googleの数字を取り込む", "Import Google figures")}
        </Button>
        {syncMutation.isSuccess ? (
          <Notice tone="success">
            {t(
              "昨日までの30日分を取り込み、履歴に保存しました。",
              "Imported the 30 days through yesterday and saved them to history.",
            )}
          </Notice>
        ) : null}
        {syncMutation.isError ? (
          <Notice tone="warning">
            <strong>
              {t(
                "自動取り込みができませんでした。",
                "Automatic import failed.",
              )}
            </strong>
            <p>
              {locale === "ja"
                ? `${syncMutation.error.message} 手入力はそのまま利用できます。`
                : "Google data could not be imported. Manual entry is still available."}
            </p>
          </Notice>
        ) : null}
      </Panel>
      <Panel>
        <h2>{t("保存した数字", "Saved figures")}</h2>
        <p className="field-help">
          {t(
            "前回比は、同じ取得方法の前回との差です。",
            "Change is compared with the previous record from the same source.",
          )}
        </p>
        {historyQuery.isLoading ? (
          <p role="status">
            {t("保存した数字を読み込んでいます。", "Loading saved figures.")}
          </p>
        ) : null}
        {historyQuery.isError ? (
          <Notice tone="error">
            {t(
              "保存した数字を読み込めませんでした。再読み込みしてお試しください。",
              "Could not load saved figures. Reload and try again.",
            )}
          </Notice>
        ) : null}
        {!historyQuery.isLoading &&
        !historyQuery.isError &&
        (historyQuery.data?.length ?? 0) === 0 ? (
          <Notice tone="info">
            {t("記録はまだありません。", "No records yet.")}
          </Notice>
        ) : null}
        {(historyQuery.data ?? []).length > 0 ? (
          <div
            className="meo-history-list"
            aria-label={t(
              "Googleマップ分析の履歴",
              "Google Maps insights history",
            )}
          >
            {(historyQuery.data ?? [])
              .slice(0, 24)
              .map((snapshot, index, all) => {
                const previous = all
                  .slice(index + 1)
                  .find((item) => item.source === snapshot.source);
                return (
                  <article className="meo-history-card" key={snapshot.id}>
                    <header>
                      <div>
                        <strong>{insightPeriodLabel(snapshot, locale)}</strong>
                        <small>
                          {insightSourceLabel(snapshot.source, locale)}
                        </small>
                      </div>
                    </header>
                    <dl className="meo-history-metrics meo-history-metrics--insights">
                      {insightMetricDefinitions.map(({ key, label }) => {
                        const current = insightMetricValue(
                          snapshot.metrics,
                          key,
                        );
                        const difference = previous
                          ? current - insightMetricValue(previous.metrics, key)
                          : null;
                        return (
                          <div key={key}>
                            <dt>{label[locale]}</dt>
                            <dd>
                              {current.toLocaleString(
                                locale === "ja" ? "ja-JP" : "en-US",
                              )}
                              {t("回", "")}
                            </dd>
                            <small>
                              {difference === null
                                ? t("前回記録なし", "No previous record")
                                : `${t("前回比", "Change")} ${difference > 0 ? "+" : ""}${difference.toLocaleString(locale === "ja" ? "ja-JP" : "en-US")}`}
                            </small>
                          </div>
                        );
                      })}
                    </dl>
                  </article>
                );
              })}
          </div>
        ) : null}
      </Panel>
      {summary ? (
        <Panel className="meo-result" aria-live="polite">
          <div className="meo-result__heading">
            <Check aria-hidden="true" />
            <h2>{t("集計結果", "Summary")}</h2>
          </div>
          <dl className="meo-metrics">
            <div>
              <dt>{t("お客様の行動", "Customer actions")}</dt>
              <dd>
                {summary.totalActions}
                {t("回", "")}
              </dd>
            </div>
            <div>
              <dt>{t("見た人が行動した割合", "Viewer action rate")}</dt>
              <dd>
                {summary.actionRate === null
                  ? t("表示なし", "No views")
                  : `${summary.actionRate}%`}
              </dd>
            </div>
            <div>
              <dt>{t("一番多い行動", "Most common action")}</dt>
              <dd>{summary.strongestAction}</dd>
            </div>
          </dl>
          <Notice tone="success">{summary.nextStep}</Notice>
          <p className="meo-disclaimer">
            {summarySource === "google_business"
              ? t(
                  "Googleから取得した数字を集計しています。",
                  "This summary uses figures imported from Google.",
                )
              : t(
                  "手入力した数字を集計しています。",
                  "This summary uses manually entered figures.",
                )}
          </p>
        </Panel>
      ) : null}
    </div>
  );
}

type GbpHealthCheckDisplay = {
  id: string;
  title: string;
  status: "good" | "warning" | "action" | "unknown";
  summary: string;
  nextAction: string | null;
};

type GbpHealthMutationInput = {
  ownerId: string;
  storeId: string;
  input: Record<string, unknown>;
  idempotencyKey: string;
};

type StoredGbpHealthIntent = {
  version: 1;
  idempotencyKey: string;
};

const GBP_HEALTH_INTENT_STORAGE_PREFIX =
  "kuchitoru-zero:gbp-health-diagnosis:v1:";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const GBP_HEALTH_STATUS_LABELS: Record<
  GbpHealthCheckDisplay["status"],
  string
> = {
  good: "良好",
  warning: "要確認",
  action: "改善が必要",
  unknown: "未確認",
};

const GBP_HEALTH_ENGLISH_COPY: Record<
  string,
  { title: string; good: string; issue: string; unknown: string; next: string }
> = {
  description: {
    title: "Business description",
    good: "A business description is set.",
    issue: "A business description is missing.",
    unknown: "The business description could not be confirmed.",
    next: "Add a natural description of the store, its main products or services, and the area.",
  },
  hours: {
    title: "Business hours",
    good: "Business hours are set.",
    issue: "Business hours are missing.",
    unknown: "Business hours could not be confirmed.",
    next: "Add regular hours and temporary closure dates.",
  },
  website: {
    title: "Website",
    good: "A website is set.",
    issue: "A website is missing.",
    unknown: "The website could not be confirmed.",
    next: "Add the official website or booking page.",
  },
  phone: {
    title: "Phone number",
    good: "A phone number is set.",
    issue: "A phone number is missing.",
    unknown: "The phone number could not be confirmed.",
    next: "Add a phone number customers can use to contact the store.",
  },
  category: {
    title: "Primary category",
    good: "A primary category is set.",
    issue: "A primary category is missing.",
    unknown: "The primary category could not be confirmed.",
    next: "Choose the one category that best represents the store.",
  },
  media: {
    title: "Photos and videos",
    good: "Photos and videos are current.",
    issue: "Photos and videos need attention.",
    unknown: "Photo and video counts could not be confirmed.",
    next: "Add recent photos of the exterior, interior, and products or services.",
  },
  posts: {
    title: "Updates",
    good: "Recent updates are available.",
    issue: "Recent updates need attention.",
    unknown: "The latest update could not be confirmed.",
    next: "Publish one update this week.",
  },
  "review-replies": {
    title: "Review replies",
    good: "The review reply rate is healthy.",
    issue: "The review reply rate needs attention.",
    unknown: "The review reply rate could not be confirmed.",
    next: "Reply to one unanswered review at a time.",
  },
  "recent-reviews": {
    title: "Recent reviews",
    good: "Recent review activity is healthy.",
    issue: "Recent review activity needs attention.",
    unknown: "The number of recent reviews could not be confirmed.",
    next: "Show customers the Kuchitoru Zero QR code at checkout.",
  },
};

function gbpHealthCheckDisplay(
  value: unknown,
  index: number,
  locale: "ja" | "en",
): GbpHealthCheckDisplay {
  const check =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const status =
    check.status === "good" ||
    check.status === "warning" ||
    check.status === "action" ||
    check.status === "unknown"
      ? check.status
      : "unknown";
  const id = typeof check.id === "string" ? check.id : `check-${index + 1}`;
  const english = GBP_HEALTH_ENGLISH_COPY[id];
  if (locale === "en") {
    return {
      id,
      title: english?.title ?? `Check ${index + 1}`,
      status,
      summary: english
        ? status === "good"
          ? english.good
          : status === "unknown"
            ? english.unknown
            : english.issue
        : "Details could not be confirmed.",
      nextAction:
        typeof check.nextAction === "string" ? (english?.next ?? null) : null,
    };
  }
  return {
    id,
    title:
      typeof check.title === "string" ? check.title : `診断項目${index + 1}`,
    status,
    summary:
      typeof check.summary === "string"
        ? check.summary
        : "詳細を確認できません。",
    nextAction: typeof check.nextAction === "string" ? check.nextAction : null,
  };
}

function gbpHealthIntentStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function gbpHealthIntentStorageKey(ownerId: string, storeId: string): string {
  return `${GBP_HEALTH_INTENT_STORAGE_PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(storeId)}`;
}

function loadGbpHealthIntent(ownerId: string, storeId: string): string | null {
  const storage = gbpHealthIntentStorage();
  if (!storage || ownerId === "") return null;
  const key = gbpHealthIntentStorageKey(ownerId, storeId);
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (
      value !== null &&
      !Array.isArray(value) &&
      typeof value === "object" &&
      (value as Record<string, unknown>).version === 1 &&
      typeof (value as Record<string, unknown>).idempotencyKey === "string" &&
      UUID_PATTERN.test(
        (value as Record<string, unknown>).idempotencyKey as string,
      ) &&
      Object.keys(value).length === 2
    ) {
      return (value as StoredGbpHealthIntent).idempotencyKey;
    }
    storage.removeItem(key);
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Unavailable storage is handled as no recoverable intent.
    }
  }
  return null;
}

function saveGbpHealthIntent(
  ownerId: string,
  storeId: string,
  idempotencyKey: string,
): boolean {
  const storage = gbpHealthIntentStorage();
  if (!storage || ownerId === "" || !UUID_PATTERN.test(idempotencyKey))
    return false;
  try {
    storage.setItem(
      gbpHealthIntentStorageKey(ownerId, storeId),
      JSON.stringify({
        version: 1,
        idempotencyKey,
      } satisfies StoredGbpHealthIntent),
    );
    return true;
  } catch {
    return false;
  }
}

function clearGbpHealthIntent(ownerId: string, storeId: string): void {
  if (ownerId === "") return;
  try {
    gbpHealthIntentStorage()?.removeItem(
      gbpHealthIntentStorageKey(ownerId, storeId),
    );
  } catch {
    // The successful result is already known even if browser cleanup fails.
  }
}

export function GbpHealthPage() {
  const { locale } = useI18n();
  const t = (ja: string, en: string) => (locale === "ja" ? ja : en);
  const { user } = useAuth();
  const ownerId = user?.id ?? "";
  const storeId = useActiveStoreId();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<HealthCheckKey>>(() => new Set());
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const [editingScope, setEditingScope] = useState<{
    ownerId: string;
    storeId: string;
  } | null>(null);
  const storedConnectedIntentKey = useMemo(
    () => loadGbpHealthIntent(ownerId, storeId),
    [ownerId, storeId],
  );
  const [connectedIntent, setConnectedIntent] = useState<{
    ownerId: string;
    storeId: string;
    key: string | null;
  }>(() => ({
    ownerId,
    storeId,
    key: storedConnectedIntentKey,
  }));
  const [intentStorageError, setIntentStorageError] = useState("");
  const connectedIntentKey =
    connectedIntent.ownerId === ownerId && connectedIntent.storeId === storeId
      ? connectedIntent.key
      : storedConnectedIntentKey;
  const latestQueryKey = ["meo-gbp-health-latest", ownerId, storeId] as const;
  const latestQuery = useQuery({
    queryKey: latestQueryKey,
    queryFn: () => getLatestGbpHealthResult(storeId),
    enabled: ownerId !== "" && storeId !== "",
    retry: false,
  });
  const healthMutation = useMutation({
    mutationFn: (request: GbpHealthMutationInput) =>
      checkGbpHealth(request.storeId, request.input, request.idempotencyKey),
    onSuccess: (diagnosis, request) => {
      if (request.input.useConnection === true) {
        clearGbpHealthIntent(request.ownerId, request.storeId);
        setConnectedIntent((current) =>
          current.ownerId === request.ownerId &&
          current.storeId === request.storeId
            ? { ...current, key: null }
            : current,
        );
      }
      queryClient.setQueryData(
        ["meo-gbp-health-latest", request.ownerId, request.storeId],
        diagnosis,
      );
      if (request.ownerId === ownerId && request.storeId === storeId) {
        setEditingScope(null);
      }
      void queryClient.invalidateQueries({
        queryKey: ["meo-gbp-health-latest", request.ownerId, request.storeId],
      });
    },
    onError: (error, request) => {
      if (
        request.input.useConnection === true &&
        error instanceof ApiError &&
        (error.code === "HEALTH_DIAGNOSIS_PREVIOUSLY_FAILED" ||
          error.code === "HEALTH_DIAGNOSIS_RESULT_EXPIRED")
      ) {
        clearGbpHealthIntent(request.ownerId, request.storeId);
        setConnectedIntent((current) =>
          current.ownerId === request.ownerId &&
          current.storeId === request.storeId
            ? { ...current, key: null }
            : current,
        );
      }
    },
  });
  const mutationMatchesActiveScope =
    healthMutation.variables?.ownerId === ownerId &&
    healthMutation.variables.storeId === storeId;
  const activeMutationPending =
    mutationMatchesActiveScope && healthMutation.isPending;
  const activeMutationDiagnosis = mutationMatchesActiveScope
    ? healthMutation.data
    : undefined;
  const activeMutationError = mutationMatchesActiveScope
    ? healthMutation.error
    : null;
  const isEditing =
    editingScope?.ownerId === ownerId && editingScope.storeId === storeId;
  const recoveringConnectedResult = connectedIntentKey !== null;
  const displayedDiagnosis =
    activeMutationDiagnosis ??
    (!isEditing && !recoveringConnectedResult
      ? (latestQuery.data ?? null)
      : null);
  const displayedResult: GbpHealthResult | null =
    displayedDiagnosis?.result ?? null;
  const remoteScore = displayedResult?.score ?? 0;
  const remoteChecks = Array.isArray(displayedResult?.checks)
    ? displayedResult.checks
    : [];
  const displayChecks = remoteChecks.map((check, index) =>
    gbpHealthCheckDisplay(check, index, locale),
  );
  const nextFix =
    displayChecks.find((check) => check.nextAction !== null)?.nextAction ??
    null;
  const unknownCheckCount = displayChecks.filter(
    (check) => check.status === "unknown",
  ).length;
  const hasUnknownChecks = unknownCheckCount > 0;
  const healthErrorMessage = locale === "en"
    ? activeMutationError instanceof ApiError &&
        activeMutationError.code === "HEALTH_DIAGNOSIS_RESULT_EXPIRED"
      ? "The previous result has expired. Start a new check to continue."
      : "The check result could not be confirmed. Check the connection before trying again."
    :
    activeMutationError instanceof ApiError
      ? activeMutationError.code === "NETWORK_ERROR"
        ? "処理結果を確認できません。再実行せず接続状態を確認してください。"
        : activeMutationError.code === "HEALTH_DIAGNOSIS_RESULT_EXPIRED"
          ? "前回の診断結果は保存期限を過ぎたため確認できません。新しい診断を始める場合は、もう一度「Googleの登録内容を診断する」を押してください。"
          : activeMutationError.message
      : activeMutationError?.message;
  const connectedRequestError =
    mutationMatchesActiveScope &&
    healthMutation.isError &&
    healthMutation.variables?.input.useConnection === true;

  useEffect(() => {
    if (displayedResult === null) return;
    const heading = resultHeadingRef.current;
    if (heading === null) return;
    heading.focus({ preventScroll: true });
    if (typeof heading.scrollIntoView === "function") {
      heading.scrollIntoView({ block: "start" });
    }
  }, [displayedResult]);

  const runConnectedDiagnosis = () => {
    const idempotencyKey = connectedIntentKey ?? createIdempotencyKey();
    if (
      connectedIntentKey === null &&
      !saveGbpHealthIntent(ownerId, storeId, idempotencyKey)
    ) {
      setIntentStorageError(
        "診断の処理状態を保存できません。ブラウザの設定を確認してください。",
      );
      return;
    }
    setIntentStorageError("");
    healthMutation.reset();
    setEditingScope({ ownerId, storeId });
    setConnectedIntent({ ownerId, storeId, key: idempotencyKey });
    healthMutation.mutate({
      ownerId,
      storeId,
      input: { useConnection: true },
      idempotencyKey,
    });
  };

  const runManualDiagnosis = () => {
    healthMutation.reset();
    setEditingScope({ ownerId, storeId });
    healthMutation.mutate({
      ownerId,
      storeId,
      idempotencyKey: createIdempotencyKey(),
      input: {
        useConnection: false,
        hasBusinessDescription: checked.has("description"),
        hasWebsite: checked.has("website"),
        hasBusinessHours: checked.has("hours"),
        hasPhoneNumber: checked.has("phone"),
        hasPrimaryCategory: checked.has("category"),
        photoCount: checked.has("photos") ? 5 : 0,
        videoCount: 0,
        daysSinceLastMedia: checked.has("photos") ? 0 : 31,
        postCount: checked.has("posts") ? 1 : 0,
        daysSinceLastPost: checked.has("posts") ? 0 : 61,
        reviewReplyRate: checked.has("replies") ? 1 : 0,
        recentReviewCount: checked.has("recentReviews") ? 5 : 0,
      },
    });
  };

  return (
    <div className="owner-page meo-feature-page">
      <PageTitle
        title={t("プロフィール診断", "Profile health check")}
        showTitle
      />
      {latestQuery.isLoading ? (
        <LoadingState label={t("保存した診断結果を読み込んでいます", "Loading the saved check result")} />
      ) : displayedDiagnosis && displayedResult ? (
        <Panel className="meo-result" aria-live="polite">
          <div className="meo-result__heading">
            <Check aria-hidden="true" />
            <h2 ref={resultHeadingRef} tabIndex={-1}>
              {locale === "ja"
                ? `${hasUnknownChecks ? "確認できた範囲" : "診断結果"}：${remoteScore}点`
                : `${hasUnknownChecks ? "Confirmed results" : "Check result"}: ${remoteScore}/100`}
            </h2>
          </div>
          <p className="field-help">
            {t("診断日時：", "Checked: ")}
            <time dateTime={displayedDiagnosis.diagnosedAt}>
              {formatJapaneseDiagnosisDateTime(
                displayedDiagnosis.diagnosedAt,
                locale,
              )}
            </time>
          </p>
          {hasUnknownChecks ? (
            <p className="field-help">{t(`未確認：${unknownCheckCount}項目`, `${unknownCheckCount} not confirmed`)}</p>
          ) : null}
          {nextFix ? (
            <Notice tone="success">
              <strong>{t("優先する項目", "Priority item")}</strong>
              <p>{nextFix}</p>
            </Notice>
          ) : hasUnknownChecks ? (
            <Notice tone="info">
              <strong>{t("一部項目は未確認です。", "Some items could not be confirmed.")}</strong>
              <p>
                {t("確認できた項目には改善候補がありません。件数を取得できなかった写真や投稿は、Googleビジネスプロフィールで確認してください。", "No improvements were found in the confirmed items. Check unavailable photo and post counts in your Google Business Profile.")}
              </p>
            </Notice>
          ) : (
            <Notice tone="success">
              <strong>{t("基本設定はそろっています。", "The basic settings are complete.")}</strong>
              <p>{t("月に1回、営業時間と写真を見直しましょう。", "Review your hours and photos once a month.")}</p>
            </Notice>
          )}
          {displayChecks.length > 0 ? (
            <section
              className="meo-history-list"
              aria-label={t("診断項目", "Health check items")}
            >
              {displayChecks.map((check, index) => (
                <article
                  className="meo-history-card"
                  key={`${check.id}-${index}`}
                >
                  <header>
                    <div>
                      <strong>{check.title}</strong>
                      <small>
                        {t("状態：", "Status: ")}{locale === "ja" ? GBP_HEALTH_STATUS_LABELS[check.status] : ({ good: "Good", warning: "Check needed", action: "Action needed", unknown: "Not confirmed" } as const)[check.status]}
                      </small>
                    </div>
                  </header>
                  <p className="meo-disclaimer">{check.summary}</p>
                </article>
              ))}
            </section>
          ) : null}
          <p className="meo-disclaimer">
            {t("この診断は基本設定のチェックです。Googleの検索順位を保証するものではありません。", "This checks basic profile settings and does not guarantee a Google search ranking.")}
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              healthMutation.reset();
              setEditingScope({ ownerId, storeId });
            }}
          >
            {t("もう一度診断する", "Run check again")}
          </Button>
        </Panel>
      ) : (
        <>
          <ManualFirstNotice featureKey="gbp_health" />
          {latestQuery.isError ? (
            <Notice tone="error">
              {t("保存した診断結果を読み込めませんでした。新しい診断は実行できます。", "The saved result could not be loaded. You can run a new check.")}
            </Notice>
          ) : null}
          <Panel>
            <h2>
              {t(
                "Google接続済みなら自動診断",
                "Automatic check when Google is connected",
              )}
            </h2>
            <p className="field-help">
              {t(
                "登録内容と口コミ返信を読み取ります。変更はしません。",
                "Reads profile details and review replies without changing them.",
              )}
            </p>
            <Button
              type="button"
              variant="secondary"
              busy={activeMutationPending}
              onClick={runConnectedDiagnosis}
            >
              {connectedIntentKey === null
                ? t("Googleの登録内容を診断する", "Check Google profile")
                : t("結果を確認する", "Check result")}
            </Button>
            {connectedIntentKey !== null ? (
              <p className="field-help">
                {t("前回と同じ操作として、保存済みの結果を確認します。", "Checking the saved result for the previous request.")}
              </p>
            ) : null}
            {intentStorageError ? (
              <Notice tone="error">{intentStorageError}</Notice>
            ) : null}
            {connectedRequestError ? (
              <Notice tone="error">{healthErrorMessage}</Notice>
            ) : null}
          </Panel>
          <Panel>
            <form
              className="form-stack meo-primary-form"
              onSubmit={(event) => {
                event.preventDefault();
                runManualDiagnosis();
              }}
            >
              <fieldset className="meo-checklist">
                <legend>
                  {t(
                    "今のGoogleプロフィールを見ながら確認",
                    "Check while viewing your current Google profile",
                  )}
                </legend>
                {HEALTH_CHECKS.map((check) => (
                  <label key={check.key}>
                    <input
                      type="checkbox"
                      checked={checked.has(check.key)}
                      onChange={(event) => {
                        healthMutation.reset();
                        setChecked((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(check.key);
                          else next.delete(check.key);
                          return next;
                        });
                      }}
                    />
                    {locale === "ja" ? check.label : check.labelEn}
                  </label>
                ))}
              </fieldset>
              <Button type="submit" busy={activeMutationPending}>
                {t("手入力で診断する", "Run manual check")}
              </Button>
              {mutationMatchesActiveScope &&
              healthMutation.isError &&
              !connectedRequestError ? (
                <Notice tone="error">{healthErrorMessage}</Notice>
              ) : null}
            </form>
          </Panel>
        </>
      )}
    </div>
  );
}

function normalizeExcludedHashtags(value: string): string[] {
  const normalized = value
    .split(/[\s,]+/u)
    .map((hashtag) => hashtag.trim())
    .filter(Boolean)
    .map((hashtag) => (hashtag.startsWith("#") ? hashtag : `#${hashtag}`))
    .filter((hashtag) => /^#[^\s#]{1,80}$/u.test(hashtag));
  return [...new Set(normalized)].slice(0, 20);
}

export function InstagramToGbpPage() {
  const { locale } = useI18n();
  const t = (ja: string, en: string) => (locale === "ja" ? ja : en);
  const storeId = useActiveStoreId();
  const [caption, setCaption] = useState("");
  const [post, setPost] = useState("");
  const [postRevision, setPostRevision] = useState(0);
  const updatePost = (value: string) => {
    setPost(value);
    setPostRevision((revision) => revision + 1);
  };
  const [imageUrl, setImageUrl] = useState("");
  const [loadMedia, setLoadMedia] = useState(false);
  const [excludedHashtags, setExcludedHashtags] = useState("");
  const mediaQuery = useQuery({
    queryKey: ["meo-instagram-media", storeId],
    queryFn: () => getInstagramMedia(storeId),
    enabled: loadMedia,
    retry: false,
  });
  const normalizedExcludedHashtags =
    normalizeExcludedHashtags(excludedHashtags);
  const draftMutation = useMutation({
    mutationFn: () =>
      createInstagramGbpDraft(storeId, {
        caption,
        excludedHashtags: normalizedExcludedHashtags,
      }),
    onSuccess: (draft) => updatePost(draft.summary),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    draftMutation.mutate();
  };

  return (
    <div className="owner-page meo-feature-page">
      <PageTitle
        title={t("Instagram投稿の再利用", "Reuse Instagram posts")}
        showTitle
      />
      <ManualFirstNotice featureKey="instagram_to_gbp" writeAction />
      <Panel>
        <h2>{t("Instagramから投稿を選ぶ", "Choose an Instagram post")}</h2>
        <p className="field-help">
          {t(
            "Instagramの投稿は変更しません。",
            "Your Instagram post will not be changed.",
          )}
        </p>
        <Button
          type="button"
          variant="secondary"
          busy={mediaQuery.isFetching}
          onClick={() =>
            loadMedia ? void mediaQuery.refetch() : setLoadMedia(true)
          }
        >
          {t("最近の投稿を読み込む", "Load recent posts")}
        </Button>
        {mediaQuery.isError ? (
          <Notice tone="warning">
            <strong>
              {t(
                "Instagramを読み込めませんでした。",
                "Could not load Instagram.",
              )}
            </strong>
            <p>
              {t(
                "接続を確認するか、下の欄へ文章を貼り付けて利用できます。",
                "Check the connection, or paste text below.",
              )}
            </p>
          </Notice>
        ) : null}
        {(mediaQuery.data ?? []).length > 0 ? (
          <div
            className="meo-review-list"
            aria-label={t("Instagramの投稿一覧", "Instagram posts")}
          >
            {(mediaQuery.data ?? []).map((media) => (
              <button
                type="button"
                className="meo-review-card"
                key={media.id}
                onClick={() => {
                  setCaption(media.caption ?? "");
                  setImageUrl(media.mediaUrl ?? "");
                  updatePost("");
                }}
              >
                <strong>
                  {media.mediaType === "VIDEO"
                    ? t("動画投稿", "Video post")
                    : t("画像投稿", "Image post")}
                </strong>
                <span>
                  {media.caption ||
                    t("文章のない投稿", "Post without a caption")}
                </span>
                <small>{t("この投稿を使う", "Use this post")}</small>
              </button>
            ))}
          </div>
        ) : null}
      </Panel>
      <Panel>
        <form className="form-stack meo-primary-form" onSubmit={submit}>
          <label>
            {t("Instagramに投稿した文章", "Instagram caption")}
            <textarea
              required
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              placeholder={t(
                "投稿文をここに貼り付けてください。",
                "Paste the post caption here.",
              )}
            />
          </label>
          <label>
            {t(
              "Googleには載せないハッシュタグ（任意）",
              "Hashtags to exclude from Google (optional)",
            )}
            <input
              value={excludedHashtags}
              onChange={(event) => setExcludedHashtags(event.target.value)}
              placeholder={t(
                "例：#社内用 #スタッフ募集",
                "Example: #internal #hiring",
              )}
            />
          </label>
          <Button type="submit" busy={draftMutation.isPending}>
            <Sparkles aria-hidden="true" />
            {t("Google投稿用に整える", "Prepare for Google")}
          </Button>
          {draftMutation.isError ? (
            <Notice tone="error">
              {locale === "ja"
                ? draftMutation.error.message
                : t(
                    "",
                    "The operation could not be completed. Please try again.",
                  )}
            </Notice>
          ) : null}
        </form>
      </Panel>
      {post ? (
        <Panel className="meo-result" aria-live="polite">
          <div className="meo-result__heading">
            <Check aria-hidden="true" />
            <h2>{t("Google投稿用の文章", "Google post text")}</h2>
          </div>
          <label>
            {t(
              "日付・価格・リンクを確認してから使ってください",
              "Check dates, prices, and links before use",
            )}
            <textarea
              value={post}
              maxLength={1500}
              onChange={(event) => updatePost(event.target.value)}
            />
          </label>
          <div className="meo-character-count">
            {post.length} / 1,500 {t("文字", "characters")}
          </div>
          <CopyButton
            value={post}
            label={t("投稿文をコピー", "Copy post text")}
          />
          <PublishGate
            previewReady={post.trim() !== ""}
            approvalKey={JSON.stringify([
              storeId,
              imageUrl || null,
              postRevision,
            ])}
            actionLabel={t(
              "確認してGoogleへ投稿する",
              "Review and post to Google",
            )}
            onPublish={() =>
              publishInstagramDraftToGoogle(storeId, {
                summary: post,
                ...(imageUrl ? { imageUrl } : {}),
                confirmed: true,
              })
            }
          />
        </Panel>
      ) : null}
    </div>
  );
}
