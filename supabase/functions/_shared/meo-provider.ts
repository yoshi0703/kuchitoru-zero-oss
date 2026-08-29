import type {
  CredentialCipher,
  EncryptedCredential,
} from "./ai-credentials.ts";

export type ExternalProvider = "google_business" | "instagram" | "dataforseo";

export type StoredExternalCredential = EncryptedCredential & {
  provider: ExternalProvider;
};

export type GoogleToken = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  scopes: string[];
};

export type InstagramToken = {
  accessToken: string;
  expiresAt: string;
  instagramUserId: string;
};

export type DataForSeoCredential = {
  login: string;
  password: string;
};

export type MapsRankResult = {
  position: number;
  placeId: string | null;
  title: string | null;
  cid: string | null;
};

export type MapsTaskInput = {
  keyword: string;
  latitude: number;
  longitude: number;
  zoom?: number;
  tag: string;
};

export type GoogleLocation = {
  name: string;
  title: string;
  accountName: string;
  storefrontAddress: string | null;
  latlng: {
    latitude: number;
    longitude: number;
  } | null;
};

export type GoogleReview = {
  name: string;
  reviewerName: string | null;
  rating: number | null;
  comment: string | null;
  createTime: string | null;
  updateTime: string | null;
  replyComment: string | null;
  replyUpdateTime: string | null;
};

export type GoogleReviewPage = {
  reviews: GoogleReview[];
  complete: boolean;
  totalReviewCount: number | null;
};

export type GoogleMediaItem = {
  name: string;
  mediaFormat: "PHOTO" | "VIDEO" | "UNKNOWN";
  createTime: string | null;
};

export type GoogleMediaPage = {
  mediaItems: GoogleMediaItem[];
  complete: boolean;
  totalMediaItemCount: number | null;
};

export type GoogleLocalPostSummary = {
  name: string;
  createTime: string | null;
  updateTime: string | null;
};

export type GoogleLocalPostPage = {
  posts: GoogleLocalPostSummary[];
  complete: boolean;
};

export type GoogleLocalPost = {
  name: string;
  summary: string;
  media: Array<{ sourceUrl: string | null }>;
};

export type InstagramMedia = {
  id: string;
  caption: string | null;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "UNKNOWN";
  mediaUrl: string | null;
  permalink: string | null;
  timestamp: string | null;
};

type FetchLike = typeof fetch;

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/business.manage";
const GOOGLE_LOCATION_PATTERN =
  /^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+$/;
const GOOGLE_V1_LOCATION_PATTERN = /^locations\/[A-Za-z0-9_-]+$/;
const GOOGLE_REVIEW_PATTERN =
  /^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+\/reviews\/[A-Za-z0-9_-]+$/;
const GOOGLE_POST_PATTERN =
  /^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+$/;
const GOOGLE_LOCAL_POST_PATTERN =
  /^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+\/localPosts\/[A-Za-z0-9_-]+$/;
const GOOGLE_ACCOUNT_PAGE_LIMIT = 5;
const GOOGLE_LOCATION_PAGE_LIMIT = 20;
const GOOGLE_REVIEW_PAGE_LIMIT = 20;
const GOOGLE_MEDIA_PAGE_LIMIT = 4;
const GOOGLE_LOCAL_POST_PAGE_LIMIT = 10;

function requiredString(value: unknown, code: string, max = 4_096): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new Error(code);
  }
  return value;
}

function optionalString(value: unknown, max = 4_096): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}

function nextPageToken(
  value: unknown,
  previous: string | null,
  code: string,
): string | null {
  if (value === undefined || value === null) return null;
  const token = requiredString(value, code, 2_048);
  if (token === previous) throw new Error(code);
  return token;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function object(
  value: unknown,
  code = "INVALID_PROVIDER_RESPONSE",
): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(code);
  }
  return value as Record<string, unknown>;
}

async function providerJson(
  fetcher: FetchLike,
  url: string,
  init: RequestInit,
  safeCode: string,
  timeoutMs = 15_000,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(safeCode);
    }
    if (!response.ok) {
      const providerError = object(data)["error"];
      const status = providerError && typeof providerError === "object"
        ? (providerError as Record<string, unknown>)["status"]
        : null;
      const error = new Error(safeCode);
      Object.assign(error, {
        providerStatus: typeof status === "string" ? status : null,
        httpStatus: response.status,
      });
      throw error;
    }
    return object(data);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("PROVIDER_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function encodeExternalCredential(
  provider: ExternalProvider,
  value: GoogleToken | InstagramToken | DataForSeoCredential,
): string {
  if (
    (provider === "dataforseo" && !("login" in value && "password" in value)) ||
    (provider === "google_business" &&
      !("scopes" in value && "refreshToken" in value)) ||
    (provider === "instagram" && !("instagramUserId" in value))
  ) throw new Error("EXTERNAL_CREDENTIAL_PROVIDER_MISMATCH");
  const json = JSON.stringify(value);
  if (json.length > 4_096) throw new Error("EXTERNAL_CREDENTIAL_TOO_LARGE");
  return json;
}

export function decodeExternalCredential<
  T extends GoogleToken | InstagramToken | DataForSeoCredential,
>(
  provider: ExternalProvider,
  value: string,
): T {
  const parsed = object(JSON.parse(value), "INVALID_EXTERNAL_CREDENTIAL");
  if (provider === "dataforseo") {
    requiredString(parsed.login, "INVALID_EXTERNAL_CREDENTIAL");
    requiredString(parsed.password, "INVALID_EXTERNAL_CREDENTIAL");
    if (
      "accessToken" in parsed || "instagramUserId" in parsed ||
      "scopes" in parsed
    ) {
      throw new Error("INVALID_EXTERNAL_CREDENTIAL");
    }
    return parsed as T;
  }

  requiredString(parsed.accessToken, "INVALID_EXTERNAL_CREDENTIAL");
  const expiresAt = requiredString(
    parsed.expiresAt,
    "INVALID_EXTERNAL_CREDENTIAL",
    100,
  );
  if (!Number.isFinite(new Date(expiresAt).getTime())) {
    throw new Error("INVALID_EXTERNAL_CREDENTIAL");
  }
  if (provider === "google_business") {
    if (
      parsed.refreshToken !== null && typeof parsed.refreshToken !== "string"
    ) {
      throw new Error("INVALID_EXTERNAL_CREDENTIAL");
    }
    if (
      !Array.isArray(parsed.scopes) ||
      parsed.scopes.some((scope) =>
        typeof scope !== "string" || scope.length === 0 || scope.length > 500
      ) ||
      "instagramUserId" in parsed || "login" in parsed || "password" in parsed
    ) {
      throw new Error("INVALID_EXTERNAL_CREDENTIAL");
    }
  } else {
    requiredString(parsed.instagramUserId, "INVALID_EXTERNAL_CREDENTIAL", 500);
    if (
      "refreshToken" in parsed || "scopes" in parsed || "login" in parsed ||
      "password" in parsed
    ) {
      throw new Error("INVALID_EXTERNAL_CREDENTIAL");
    }
  }
  return parsed as T;
}

export async function encryptExternalCredential(
  cipher: CredentialCipher,
  storeId: string,
  provider: ExternalProvider,
  value: GoogleToken | InstagramToken | DataForSeoCredential,
): Promise<EncryptedCredential> {
  return await cipher.encrypt(
    encodeExternalCredential(provider, value),
    storeId,
    `integration:${provider}`,
  );
}

export async function decryptExternalCredential<
  T extends GoogleToken | InstagramToken | DataForSeoCredential,
>(
  cipher: CredentialCipher,
  storeId: string,
  credential: StoredExternalCredential,
): Promise<T> {
  return decodeExternalCredential<T>(
    credential.provider,
    await cipher.decrypt(
      credential,
      storeId,
      `integration:${credential.provider}`,
    ),
  );
}

function googleReview(value: Record<string, unknown>): GoogleReview {
  const reviewer = value.reviewer && typeof value.reviewer === "object"
    ? value.reviewer as Record<string, unknown>
    : {};
  const reply = value.reviewReply && typeof value.reviewReply === "object"
    ? value.reviewReply as Record<string, unknown>
    : {};
  const ratingNames: Record<string, number> = {
    ONE: 1,
    TWO: 2,
    THREE: 3,
    FOUR: 4,
    FIVE: 5,
  };
  return {
    name: requiredString(value.name, "INVALID_GOOGLE_REVIEW", 500),
    reviewerName: optionalString(reviewer.displayName, 300),
    rating: typeof value.starRating === "string"
      ? ratingNames[value.starRating] ?? null
      : finiteNumber(value.starRating),
    comment: optionalString(value.comment, 4_096),
    createTime: optionalString(value.createTime, 100),
    updateTime: optionalString(value.updateTime, 100),
    replyComment: optionalString(reply.comment, 4_096),
    replyUpdateTime: optionalString(reply.updateTime, 100),
  };
}

export function googleAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set(
    "client_id",
    requiredString(input.clientId, "MISSING_GOOGLE_CLIENT_ID"),
  );
  url.searchParams.set(
    "redirect_uri",
    requiredString(input.redirectUri, "MISSING_GOOGLE_REDIRECT_URI"),
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPE);
  url.searchParams.set("access_type", "offline");
  // Keep this client isolated to GBP. Incremental authorization can merge
  // unrelated grants from the same Google user and make an otherwise valid
  // business.manage request fail before consent.
  url.searchParams.set("prompt", "consent");
  url.searchParams.set(
    "code_challenge",
    requiredString(input.codeChallenge, "MISSING_GOOGLE_CODE_CHALLENGE", 128),
  );
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set(
    "state",
    requiredString(input.state, "MISSING_OAUTH_STATE", 512),
  );
  return url.toString();
}

export function instagramAuthorizationUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set(
    "client_id",
    requiredString(input.appId, "MISSING_INSTAGRAM_APP_ID"),
  );
  url.searchParams.set(
    "redirect_uri",
    requiredString(input.redirectUri, "MISSING_INSTAGRAM_REDIRECT_URI"),
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "instagram_business_basic");
  url.searchParams.set(
    "state",
    requiredString(input.state, "MISSING_OAUTH_STATE", 512),
  );
  return url.toString();
}

export class GoogleBusinessClient {
  readonly #fetch: FetchLike;
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #redirectUri: string;

  constructor(input: {
    fetcher?: FetchLike;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }) {
    this.#fetch = input.fetcher ?? fetch;
    this.#clientId = requiredString(input.clientId, "MISSING_GOOGLE_CLIENT_ID");
    this.#clientSecret = requiredString(
      input.clientSecret,
      "MISSING_GOOGLE_CLIENT_SECRET",
    );
    this.#redirectUri = requiredString(
      input.redirectUri,
      "MISSING_GOOGLE_REDIRECT_URI",
    );
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<GoogleToken> {
    const data = await providerJson(
      this.#fetch,
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: requiredString(code, "MISSING_GOOGLE_CODE", 2_048),
          client_id: this.#clientId,
          client_secret: this.#clientSecret,
          redirect_uri: this.#redirectUri,
          grant_type: "authorization_code",
          code_verifier: requiredString(
            codeVerifier,
            "MISSING_GOOGLE_CODE_VERIFIER",
            128,
          ),
        }),
      },
      "GOOGLE_TOKEN_EXCHANGE_FAILED",
    );
    const expiresIn = finiteNumber(data.expires_in) ?? 3_600;
    return {
      accessToken: requiredString(
        data.access_token,
        "GOOGLE_TOKEN_EXCHANGE_FAILED",
      ),
      refreshToken: optionalString(data.refresh_token),
      expiresAt: new Date(Date.now() + Math.max(60, expiresIn) * 1_000)
        .toISOString(),
      scopes: typeof data.scope === "string"
        ? data.scope.split(" ").filter(Boolean)
        : [GOOGLE_SCOPE],
    };
  }

  async refresh(token: GoogleToken): Promise<GoogleToken> {
    if (!token.refreshToken) throw new Error("GOOGLE_RECONNECT_REQUIRED");
    const data = await providerJson(
      this.#fetch,
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.#clientId,
          client_secret: this.#clientSecret,
          refresh_token: token.refreshToken,
          grant_type: "refresh_token",
        }),
      },
      "GOOGLE_TOKEN_REFRESH_FAILED",
    );
    const expiresIn = finiteNumber(data.expires_in) ?? 3_600;
    return {
      accessToken: requiredString(
        data.access_token,
        "GOOGLE_TOKEN_REFRESH_FAILED",
      ),
      refreshToken: token.refreshToken,
      expiresAt: new Date(Date.now() + Math.max(60, expiresIn) * 1_000)
        .toISOString(),
      scopes: token.scopes,
    };
  }

  async locations(accessToken: string): Promise<GoogleLocation[]> {
    const accounts: unknown[] = [];
    let accountPageToken: string | null = null;
    for (let page = 0; page < GOOGLE_ACCOUNT_PAGE_LIMIT; page += 1) {
      const url = new URL(
        "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
      );
      url.searchParams.set("pageSize", "20");
      if (accountPageToken) url.searchParams.set("pageToken", accountPageToken);
      const accountData = await providerJson(
        this.#fetch,
        url.toString(),
        { headers: { Authorization: `Bearer ${accessToken}` } },
        "GOOGLE_ACCOUNTS_FETCH_FAILED",
      );
      accounts.push(
        ...(Array.isArray(accountData.accounts) ? accountData.accounts : []),
      );
      accountPageToken = nextPageToken(
        accountData.nextPageToken,
        accountPageToken,
        "INVALID_GOOGLE_ACCOUNT_PAGE_TOKEN",
      );
      if (!accountPageToken) break;
    }
    if (accountPageToken) throw new Error("GOOGLE_ACCOUNT_LIST_TOO_LARGE");

    const results: GoogleLocation[] = [];
    let remainingLocationPages = GOOGLE_LOCATION_PAGE_LIMIT;
    for (const rawAccount of accounts) {
      const account = object(rawAccount);
      const accountName = requiredString(
        account.name,
        "INVALID_GOOGLE_ACCOUNT",
        300,
      );
      let locationPageToken: string | null = null;
      do {
        if (remainingLocationPages === 0) {
          throw new Error("GOOGLE_LOCATION_LIST_TOO_LARGE");
        }
        remainingLocationPages -= 1;
        const url = new URL(
          `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`,
        );
        url.searchParams.set("readMask", "name,title,storefrontAddress,latlng");
        url.searchParams.set("pageSize", "100");
        if (locationPageToken) {
          url.searchParams.set("pageToken", locationPageToken);
        }
        const data = await providerJson(
          this.#fetch,
          url.toString(),
          { headers: { Authorization: `Bearer ${accessToken}` } },
          "GOOGLE_LOCATIONS_FETCH_FAILED",
        );
        for (
          const rawLocation of Array.isArray(data.locations)
            ? data.locations
            : []
        ) {
          const location = object(rawLocation);
          const v1Name = requiredString(
            location.name,
            "INVALID_GOOGLE_LOCATION",
            300,
          );
          if (!GOOGLE_V1_LOCATION_PATTERN.test(v1Name)) continue;
          const addressObject = location.storefrontAddress &&
              typeof location.storefrontAddress === "object"
            ? location.storefrontAddress as Record<string, unknown>
            : null;
          const addressLines =
            addressObject && Array.isArray(addressObject.addressLines)
              ? addressObject.addressLines.filter((line): line is string =>
                typeof line === "string"
              )
              : [];
          const latlngObject = location.latlng &&
              typeof location.latlng === "object"
            ? location.latlng as Record<string, unknown>
            : null;
          const latitude = finiteNumber(latlngObject?.latitude);
          const longitude = finiteNumber(latlngObject?.longitude);
          results.push({
            name: `${accountName}/${v1Name}`,
            title: requiredString(
              location.title,
              "INVALID_GOOGLE_LOCATION",
              300,
            ),
            accountName,
            storefrontAddress: addressLines.length > 0
              ? addressLines.join(" ")
              : null,
            latlng: latitude !== null && latitude >= -90 && latitude <= 90 &&
                longitude !== null && longitude >= -180 && longitude <= 180
              ? { latitude, longitude }
              : null,
          });
        }
        locationPageToken = nextPageToken(
          data.nextPageToken,
          locationPageToken,
          "INVALID_GOOGLE_LOCATION_PAGE_TOKEN",
        );
      } while (locationPageToken);
    }
    return results;
  }

  async reviews(
    accessToken: string,
    locationName: string,
  ): Promise<GoogleReviewPage> {
    if (!GOOGLE_LOCATION_PATTERN.test(locationName)) {
      throw new Error("INVALID_GOOGLE_LOCATION");
    }
    const reviews: GoogleReview[] = [];
    let pageToken: string | null = null;
    let totalReviewCount: number | null = null;
    for (let page = 0; page < GOOGLE_REVIEW_PAGE_LIMIT; page += 1) {
      const url = new URL(
        `https://mybusiness.googleapis.com/v4/${locationName}/reviews`,
      );
      // Google Business Profile v4 accepts at most 50 reviews per page.
      url.searchParams.set("pageSize", "50");
      url.searchParams.set("orderBy", "updateTime desc");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const data = await providerJson(
        this.#fetch,
        url.toString(),
        { headers: { Authorization: `Bearer ${accessToken}` } },
        "GOOGLE_REVIEWS_FETCH_FAILED",
      );
      reviews.push(
        ...(Array.isArray(data.reviews) ? data.reviews : [])
          .map((raw) => googleReview(object(raw))),
      );
      const responseTotal = finiteNumber(data.totalReviewCount);
      if (
        responseTotal !== null && Number.isSafeInteger(responseTotal) &&
        responseTotal >= 0
      ) {
        totalReviewCount = responseTotal;
      }
      pageToken = nextPageToken(
        data.nextPageToken,
        pageToken,
        "INVALID_GOOGLE_REVIEW_PAGE_TOKEN",
      );
      if (!pageToken) break;
    }
    return {
      reviews,
      complete: pageToken === null &&
        (totalReviewCount === null || reviews.length >= totalReviewCount),
      totalReviewCount,
    };
  }

  async media(
    accessToken: string,
    locationName: string,
  ): Promise<GoogleMediaPage> {
    if (!GOOGLE_LOCATION_PATTERN.test(locationName)) {
      throw new Error("INVALID_GOOGLE_LOCATION");
    }
    const mediaItems: GoogleMediaItem[] = [];
    let pageToken: string | null = null;
    let totalMediaItemCount: number | null = null;
    for (let page = 0; page < GOOGLE_MEDIA_PAGE_LIMIT; page += 1) {
      const url = new URL(
        `https://mybusiness.googleapis.com/v4/${locationName}/media`,
      );
      url.searchParams.set("pageSize", "2500");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const data = await providerJson(
        this.#fetch,
        url.toString(),
        { headers: { Authorization: `Bearer ${accessToken}` } },
        "GOOGLE_MEDIA_FETCH_FAILED",
      );
      mediaItems.push(
        ...(Array.isArray(data.mediaItems) ? data.mediaItems : []).slice(
          0,
          2500,
        ).map((raw) => {
          const item = object(raw);
          const format = item.mediaFormat;
          const mediaFormat: GoogleMediaItem["mediaFormat"] =
            format === "PHOTO" || format === "VIDEO" ? format : "UNKNOWN";
          return {
            name: requiredString(item.name, "INVALID_GOOGLE_MEDIA", 500),
            mediaFormat,
            createTime: optionalString(item.createTime, 100),
          };
        }),
      );
      const responseTotal = finiteNumber(data.totalMediaItemCount);
      if (
        responseTotal !== null && Number.isSafeInteger(responseTotal) &&
        responseTotal >= 0
      ) {
        totalMediaItemCount = responseTotal;
      }
      pageToken = nextPageToken(
        data.nextPageToken,
        pageToken,
        "INVALID_GOOGLE_MEDIA_PAGE_TOKEN",
      );
      if (!pageToken) break;
    }
    return {
      mediaItems,
      complete: pageToken === null &&
        (totalMediaItemCount === null ||
          mediaItems.length >= totalMediaItemCount),
      totalMediaItemCount,
    };
  }

  async localPosts(
    accessToken: string,
    locationName: string,
  ): Promise<GoogleLocalPostPage> {
    if (!GOOGLE_LOCATION_PATTERN.test(locationName)) {
      throw new Error("INVALID_GOOGLE_LOCATION");
    }
    const posts: GoogleLocalPostSummary[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < GOOGLE_LOCAL_POST_PAGE_LIMIT; page += 1) {
      const url = new URL(
        `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
      );
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const data = await providerJson(
        this.#fetch,
        url.toString(),
        { headers: { Authorization: `Bearer ${accessToken}` } },
        "GOOGLE_LOCAL_POSTS_FETCH_FAILED",
      );
      posts.push(
        ...(Array.isArray(data.localPosts) ? data.localPosts : []).slice(0, 100)
          .map((raw) => {
            const post = object(raw);
            return {
              name: requiredString(post.name, "INVALID_GOOGLE_LOCAL_POST", 500),
              createTime: optionalString(post.createTime, 100),
              updateTime: optionalString(post.updateTime, 100),
            };
          }),
      );
      pageToken = nextPageToken(
        data.nextPageToken,
        pageToken,
        "INVALID_GOOGLE_LOCAL_POST_PAGE_TOKEN",
      );
      if (!pageToken) break;
    }
    return { posts, complete: pageToken === null };
  }

  async reply(
    accessToken: string,
    locationName: string,
    reviewName: string,
    comment: string,
  ): Promise<void> {
    if (
      !GOOGLE_LOCATION_PATTERN.test(locationName) ||
      !GOOGLE_REVIEW_PATTERN.test(reviewName)
    ) {
      throw new Error("INVALID_GOOGLE_REVIEW");
    }
    if (!reviewName.startsWith(`${locationName}/reviews/`)) {
      throw new Error("REVIEW_LOCATION_MISMATCH");
    }
    const safeComment = requiredString(
      comment.trim(),
      "EMPTY_REVIEW_REPLY",
      4_096,
    );
    await providerJson(
      this.#fetch,
      `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ comment: safeComment }),
      },
      "GOOGLE_REVIEW_REPLY_FAILED",
    );
  }

  async review(
    accessToken: string,
    locationName: string,
    reviewName: string,
  ): Promise<GoogleReview> {
    if (
      !GOOGLE_LOCATION_PATTERN.test(locationName) ||
      !GOOGLE_REVIEW_PATTERN.test(reviewName)
    ) {
      throw new Error("INVALID_GOOGLE_REVIEW");
    }
    if (!reviewName.startsWith(`${locationName}/reviews/`)) {
      throw new Error("REVIEW_LOCATION_MISMATCH");
    }
    const review = googleReview(
      await providerJson(
        this.#fetch,
        `https://mybusiness.googleapis.com/v4/${reviewName}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        "GOOGLE_REVIEW_READBACK_FAILED",
      ),
    );
    if (review.name !== reviewName) {
      throw new Error("GOOGLE_REVIEW_READBACK_MISMATCH");
    }
    return review;
  }

  async profile(
    accessToken: string,
    locationName: string,
  ): Promise<Record<string, unknown>> {
    if (!GOOGLE_LOCATION_PATTERN.test(locationName)) {
      throw new Error("INVALID_GOOGLE_LOCATION");
    }
    const locationId = locationName.match(/locations\/([A-Za-z0-9_-]+)$/)?.[1];
    if (!locationId) throw new Error("INVALID_GOOGLE_LOCATION");
    const url = new URL(
      `https://mybusinessbusinessinformation.googleapis.com/v1/locations/${locationId}`,
    );
    url.searchParams.set(
      "readMask",
      "name,title,profile,websiteUri,phoneNumbers,categories,regularHours,specialHours,storefrontAddress,metadata",
    );
    return await providerJson(
      this.#fetch,
      url.toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
      "GOOGLE_PROFILE_FETCH_FAILED",
    );
  }

  async performance(
    accessToken: string,
    locationName: string,
    startDate: string,
    endDate: string,
  ): Promise<Record<string, unknown>> {
    if (!GOOGLE_LOCATION_PATTERN.test(locationName)) {
      throw new Error("INVALID_GOOGLE_LOCATION");
    }
    const locationId = locationName.match(/locations\/([A-Za-z0-9_-]+)$/)?.[1];
    if (!locationId) throw new Error("INVALID_GOOGLE_LOCATION");
    const start = dateParts(startDate);
    const end = dateParts(endDate);
    const url = new URL(
      `https://businessprofileperformance.googleapis.com/v1/locations/${locationId}:fetchMultiDailyMetricsTimeSeries`,
    );
    const metrics = [
      "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
      "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
      "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
      "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
      "WEBSITE_CLICKS",
      "CALL_CLICKS",
      "BUSINESS_DIRECTION_REQUESTS",
    ];
    for (const metric of metrics) {
      url.searchParams.append("dailyMetrics", metric);
    }
    for (
      const [prefix, value] of [["startDate", start], ["endDate", end]] as const
    ) {
      url.searchParams.set(`dailyRange.${prefix}.year`, String(value.year));
      url.searchParams.set(`dailyRange.${prefix}.month`, String(value.month));
      url.searchParams.set(`dailyRange.${prefix}.day`, String(value.day));
    }
    return await providerJson(
      this.#fetch,
      url.toString(),
      { headers: { Authorization: `Bearer ${accessToken}` } },
      "GOOGLE_PERFORMANCE_FETCH_FAILED",
    );
  }

  async createLocalPost(accessToken: string, locationName: string, input: {
    summary: string;
    imageUrl?: string | null;
  }): Promise<{ name: string }> {
    if (!GOOGLE_POST_PATTERN.test(locationName)) {
      throw new Error("INVALID_GOOGLE_LOCATION");
    }
    const summary = requiredString(
      input.summary.trim(),
      "EMPTY_GBP_POST",
      1_500,
    );
    const body: Record<string, unknown> = {
      languageCode: "ja",
      summary,
      topicType: "STANDARD",
    };
    if (input.imageUrl) {
      const imageUrl = safeHttpsUrl(input.imageUrl);
      body.media = [{ mediaFormat: "PHOTO", sourceUrl: imageUrl }];
    }
    const result = await providerJson(
      this.#fetch,
      `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      "GOOGLE_POST_CREATE_FAILED",
    );
    const name = requiredString(result.name, "INVALID_GOOGLE_POST", 500);
    if (
      !GOOGLE_LOCAL_POST_PATTERN.test(name) ||
      !name.startsWith(`${locationName}/localPosts/`)
    ) {
      throw new Error("INVALID_GOOGLE_POST");
    }
    return { name };
  }

  async localPost(
    accessToken: string,
    locationName: string,
    postName: string,
  ): Promise<GoogleLocalPost> {
    if (
      !GOOGLE_POST_PATTERN.test(locationName) ||
      !GOOGLE_LOCAL_POST_PATTERN.test(postName) ||
      !postName.startsWith(`${locationName}/localPosts/`)
    ) {
      throw new Error("INVALID_GOOGLE_POST");
    }
    const result = await providerJson(
      this.#fetch,
      `https://mybusiness.googleapis.com/v4/${postName}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      "GOOGLE_POST_READBACK_FAILED",
    );
    const name = requiredString(result.name, "INVALID_GOOGLE_POST", 500);
    if (name !== postName) throw new Error("GOOGLE_POST_READBACK_MISMATCH");
    const media = result.media === undefined ? [] : result.media;
    if (!Array.isArray(media) || media.length > 10) {
      throw new Error("INVALID_GOOGLE_POST");
    }
    return {
      name,
      summary: requiredString(result.summary, "INVALID_GOOGLE_POST", 1_500),
      media: media.map((value) => {
        const row = object(value, "INVALID_GOOGLE_POST");
        return { sourceUrl: optionalString(row.sourceUrl, 2_048) };
      }),
    };
  }
}

export class GooglePlacesClient {
  readonly #fetch: FetchLike;
  readonly #apiKey: string;

  constructor(input: { fetcher?: FetchLike; apiKey: string }) {
    this.#fetch = input.fetcher ?? fetch;
    this.#apiKey = requiredString(input.apiKey, "MISSING_GOOGLE_PLACES_KEY");
  }

  async textSearch(input: {
    textQuery: string;
    latitude?: number | null;
    longitude?: number | null;
    radiusMeters?: number | null;
  }): Promise<Array<{ id: string }>> {
    const body: Record<string, unknown> = {
      textQuery: requiredString(
        input.textQuery.trim(),
        "INVALID_RANK_QUERY",
        300,
      ),
      languageCode: "ja",
      regionCode: "JP",
      pageSize: 20,
    };
    if (input.latitude != null && input.longitude != null) {
      if (
        !Number.isFinite(input.latitude) || input.latitude < -90 ||
        input.latitude > 90 ||
        !Number.isFinite(input.longitude) || input.longitude < -180 ||
        input.longitude > 180
      ) {
        throw new Error("INVALID_RANK_LOCATION");
      }
      body.locationBias = {
        circle: {
          center: { latitude: input.latitude, longitude: input.longitude },
          radius: Math.min(50_000, Math.max(100, input.radiusMeters ?? 5_000)),
        },
      };
    }
    const data = await providerJson(
      this.#fetch,
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.#apiKey,
          // Ranking only needs immutable place IDs. Keeping the IDs-only mask
          // avoids pulling chargeable display fields and minimizes response size.
          "X-Goog-FieldMask": "places.id",
        },
        body: JSON.stringify(body),
      },
      "GOOGLE_PLACES_SEARCH_FAILED",
    );
    return (Array.isArray(data.places) ? data.places : []).slice(0, 20).map(
      (raw) => {
        const place = object(raw);
        return {
          id: requiredString(place.id, "INVALID_PLACES_RESULT", 300),
        };
      },
    );
  }
}

export class DataForSeoClient {
  readonly #fetch: FetchLike;
  readonly #authorization: string;

  constructor(input: { fetcher?: FetchLike; login: string; password: string }) {
    this.#fetch = input.fetcher ?? fetch;
    const login = requiredString(
      input.login.trim(),
      "MISSING_DATAFORSEO_LOGIN",
      320,
    );
    const password = requiredString(
      input.password,
      "MISSING_DATAFORSEO_PASSWORD",
      1_024,
    );
    this.#authorization = `Basic ${btoa(`${login}:${password}`)}`;
  }

  async validate(): Promise<void> {
    const result = await providerJson(
      this.#fetch,
      "https://api.dataforseo.com/v3/appendix/user_data",
      { headers: { Authorization: this.#authorization } },
      "DATAFORSEO_CREDENTIAL_INVALID",
    );
    if (result.status_code !== 20000) {
      throw new Error("DATAFORSEO_CREDENTIAL_INVALID");
    }
  }

  async submitMapsTask(
    input: MapsTaskInput,
  ): Promise<{ taskId: string }> {
    const tag = requiredString(input.tag, "INVALID_RANK_TASK_TAG", 255);
    const payload = [{
      keyword: requiredString(
        input.keyword.trim(),
        "INVALID_RANK_QUERY",
        300,
      ),
      location_coordinate: rankCoordinate(
        input.latitude,
        input.longitude,
        input.zoom ?? 15,
      ),
      language_code: "ja",
      device: "desktop",
      os: "windows",
      depth: 100,
      tag,
    }];
    const result = await providerJson(
      this.#fetch,
      "https://api.dataforseo.com/v3/serp/google/maps/task_post",
      {
        method: "POST",
        headers: {
          Authorization: this.#authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      "DATAFORSEO_TASK_SUBMIT_FAILED",
    );
    if (
      result.status_code !== 20000 || !Array.isArray(result.tasks) ||
      result.tasks.length !== 1
    ) {
      throw new Error("DATAFORSEO_TASK_SUBMIT_FAILED");
    }
    const task = object(result.tasks[0], "DATAFORSEO_TASK_SUBMIT_FAILED");
    const statusCode = task.status_code;
    if (
      typeof statusCode !== "number" || !Number.isInteger(statusCode) ||
      statusCode < 20000 || statusCode >= 30000
    ) {
      throw new Error(
        typeof statusCode === "number" && Number.isInteger(statusCode)
          ? `DATAFORSEO_TASK_${statusCode}`
          : "DATAFORSEO_TASK_SUBMIT_FAILED",
      );
    }
    const taskData = object(task.data, "DATAFORSEO_TASK_SUBMIT_FAILED");
    if (taskData.tag !== tag) throw new Error("DATAFORSEO_TASK_SUBMIT_FAILED");
    return {
      taskId: requiredString(task.id, "DATAFORSEO_TASK_SUBMIT_FAILED", 200),
    };
  }

  async mapsTask(taskId: string): Promise<{
    ready: boolean;
    results: MapsRankResult[];
  }> {
    const safeTaskId = requiredString(
      taskId,
      "INVALID_DATAFORSEO_TASK_ID",
      200,
    );
    if (!/^[A-Za-z0-9_-]+$/.test(safeTaskId)) {
      throw new Error("INVALID_DATAFORSEO_TASK_ID");
    }
    const data = await providerJson(
      this.#fetch,
      `https://api.dataforseo.com/v3/serp/google/maps/task_get/advanced/${safeTaskId}`,
      { headers: { Authorization: this.#authorization } },
      "DATAFORSEO_TASK_FETCH_FAILED",
    );
    if (data.status_code !== 20000 || !Array.isArray(data.tasks)) {
      throw new Error("DATAFORSEO_TASK_FETCH_FAILED");
    }
    const task = object(data.tasks[0], "DATAFORSEO_TASK_FETCH_FAILED");
    if (task.status_code === 40601 || task.result === null) {
      return { ready: false, results: [] };
    }
    if (task.status_code !== 20000 || !Array.isArray(task.result)) {
      throw new Error("DATAFORSEO_TASK_FETCH_FAILED");
    }
    const rows: MapsRankResult[] = [];
    for (const rawResult of task.result) {
      const result = object(rawResult, "INVALID_DATAFORSEO_RESULT");
      for (const rawItem of Array.isArray(result.items) ? result.items : []) {
        const item = object(rawItem, "INVALID_DATAFORSEO_RESULT");
        if (item.type !== "maps_search" && item.type !== "maps_paid_item") {
          continue;
        }
        const position = finiteNumber(item.rank_absolute) ??
          finiteNumber(item.rank_group);
        if (
          position === null || !Number.isInteger(position) || position < 1 ||
          position > 100
        ) continue;
        rows.push({
          position,
          placeId: optionalString(item.place_id, 300),
          title: optionalString(item.title, 500),
          cid: optionalString(item.cid, 300),
        });
      }
    }
    rows.sort((left, right) => left.position - right.position);
    return {
      ready: true,
      results: rows.slice(0, 100),
    };
  }
}

export class InstagramClient {
  readonly #fetch: FetchLike;
  readonly #appId: string;
  readonly #appSecret: string;
  readonly #redirectUri: string;
  readonly #version: string;

  constructor(input: {
    fetcher?: FetchLike;
    appId: string;
    appSecret: string;
    redirectUri: string;
    apiVersion?: string;
  }) {
    this.#fetch = input.fetcher ?? fetch;
    this.#appId = requiredString(input.appId, "MISSING_INSTAGRAM_APP_ID");
    this.#appSecret = requiredString(
      input.appSecret,
      "MISSING_INSTAGRAM_APP_SECRET",
    );
    this.#redirectUri = requiredString(
      input.redirectUri,
      "MISSING_INSTAGRAM_REDIRECT_URI",
    );
    this.#version = input.apiVersion ?? "v25.0";
    if (!/^v[1-9][0-9]*\.0$/.test(this.#version)) {
      throw new Error("INVALID_INSTAGRAM_API_VERSION");
    }
  }

  async exchangeCode(code: string): Promise<InstagramToken> {
    const short = await providerJson(
      this.#fetch,
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        body: new URLSearchParams({
          client_id: this.#appId,
          client_secret: this.#appSecret,
          grant_type: "authorization_code",
          redirect_uri: this.#redirectUri,
          code: requiredString(code, "MISSING_INSTAGRAM_CODE", 2_048),
        }),
      },
      "INSTAGRAM_TOKEN_EXCHANGE_FAILED",
    );
    const shortToken = requiredString(
      short.access_token,
      "INSTAGRAM_TOKEN_EXCHANGE_FAILED",
    );
    const userId = typeof short.user_id === "number"
      ? String(short.user_id)
      : requiredString(short.user_id, "INSTAGRAM_TOKEN_EXCHANGE_FAILED", 200);
    const longUrl = new URL("https://graph.instagram.com/access_token");
    longUrl.searchParams.set("grant_type", "ig_exchange_token");
    longUrl.searchParams.set("client_secret", this.#appSecret);
    longUrl.searchParams.set("access_token", shortToken);
    const long = await providerJson(
      this.#fetch,
      longUrl.toString(),
      { method: "GET" },
      "INSTAGRAM_LONG_TOKEN_FAILED",
    );
    const expiresIn = finiteNumber(long.expires_in) ?? 5_184_000;
    return {
      accessToken: requiredString(
        long.access_token,
        "INSTAGRAM_LONG_TOKEN_FAILED",
      ),
      expiresAt: new Date(Date.now() + Math.max(3_600, expiresIn) * 1_000)
        .toISOString(),
      instagramUserId: userId,
    };
  }

  async refresh(token: InstagramToken): Promise<InstagramToken> {
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", token.accessToken);
    const data = await providerJson(
      this.#fetch,
      url.toString(),
      { method: "GET" },
      "INSTAGRAM_TOKEN_REFRESH_FAILED",
    );
    const expiresIn = finiteNumber(data.expires_in) ?? 5_184_000;
    return {
      ...token,
      accessToken: requiredString(
        data.access_token,
        "INSTAGRAM_TOKEN_REFRESH_FAILED",
      ),
      expiresAt: new Date(Date.now() + Math.max(3_600, expiresIn) * 1_000)
        .toISOString(),
    };
  }

  async media(token: InstagramToken): Promise<InstagramMedia[]> {
    const url = new URL(
      `https://graph.instagram.com/${this.#version}/${
        encodeURIComponent(token.instagramUserId)
      }/media`,
    );
    url.searchParams.set(
      "fields",
      "id,caption,media_type,media_url,permalink,timestamp",
    );
    url.searchParams.set("limit", "25");
    url.searchParams.set("access_token", token.accessToken);
    const result = await providerJson(
      this.#fetch,
      url.toString(),
      { method: "GET" },
      "INSTAGRAM_MEDIA_FETCH_FAILED",
    );
    return (Array.isArray(result.data) ? result.data : []).slice(0, 25).map(
      (raw) => {
        const row = object(raw);
        const mediaType =
          row.media_type === "IMAGE" || row.media_type === "VIDEO" ||
            row.media_type === "CAROUSEL_ALBUM"
            ? row.media_type
            : "UNKNOWN";
        return {
          id: requiredString(row.id, "INVALID_INSTAGRAM_MEDIA", 200),
          caption: optionalString(row.caption, 10_000),
          mediaType,
          mediaUrl: optionalString(row.media_url, 2_048),
          permalink: optionalString(row.permalink, 2_048),
          timestamp: optionalString(row.timestamp, 100),
        };
      },
    );
  }
}

function dateParts(
  value: string,
): { year: number; month: number; day: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_DATE_RANGE");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("INVALID_DATE_RANGE");
  }
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function safeHttpsUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("INVALID_MEDIA_URL");
  }
  if (
    url.protocol !== "https:" || url.username || url.password || url.port ||
    url.hash
  ) {
    throw new Error("INVALID_MEDIA_URL");
  }
  return url.toString();
}

function rankCoordinate(
  latitude: number,
  longitude: number,
  zoom: number,
): string {
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    !Number.isInteger(zoom) || zoom < 3 || zoom > 21
  ) {
    throw new Error("INVALID_RANK_LOCATION");
  }
  return `${latitude.toFixed(7)},${longitude.toFixed(7)},${zoom}`;
}

export const meoProviderInternals = {
  dateParts,
  safeHttpsUrl,
  rankCoordinate,
  providerJson,
  GOOGLE_SCOPE,
};
