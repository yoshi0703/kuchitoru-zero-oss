import { VersionedCredentialCipher } from "../_shared/ai-credentials.ts";
import {
  DataForSeoClient,
  decodeExternalCredential,
  decryptExternalCredential,
  encryptExternalCredential,
  googleAuthorizationUrl,
  GoogleBusinessClient,
  GooglePlacesClient,
  type GoogleToken,
  instagramAuthorizationUrl,
  InstagramClient,
} from "../_shared/meo-provider.ts";
import { assert, assertEquals } from "./assert.ts";

const rawKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

Deno.test("external tokens are encrypted with a provider-scoped credential domain", async () => {
  const cipher = await VersionedCredentialCipher.fromBase64Keys(
    new Map([[1, rawKey]]),
    1,
  );
  const token: GoogleToken = {
    accessToken: "access-secret-value",
    refreshToken: "refresh-secret-value",
    expiresAt: "2026-08-11T00:00:00.000Z",
    scopes: ["scope"],
  };
  const encrypted = await encryptExternalCredential(
    cipher,
    "store-a",
    "google_business",
    token,
  );
  assert(!encrypted.ciphertext.includes("access-secret-value"));
  const decrypted = await decryptExternalCredential<GoogleToken>(
    cipher,
    "store-a",
    {
      provider: "google_business",
      ...encrypted,
    },
  );
  assertEquals(decrypted, token);
});

Deno.test("external credential decoding rejects a payload for a different provider", () => {
  let message = "";
  try {
    decodeExternalCredential(
      "google_business",
      JSON.stringify({
        login: "owner@example.test",
        password: "password-secret",
      }),
    );
  } catch (error) {
    message = error instanceof Error ? error.message : "unknown";
  }
  assertEquals(message, "INVALID_EXTERNAL_CREDENTIAL");
});

Deno.test("DataForSEO submits one bounded Maps SERP task for own and competitors", async () => {
  let request: Request | null = null;
  const client = new DataForSeoClient({
    login: "owner@example.test",
    password: "password-secret",
    fetcher: (input, init) => {
      request = new Request(input, init);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status_code: 20000,
            tasks: [{
              id: "task-1",
              status_code: 20100,
              cost: 0.0006,
              data: { tag: "job-1" },
            }],
          }),
          { status: 200 },
        ),
      );
    },
  });
  const submitted = await client.submitMapsTask({
    keyword: "新宿 カフェ",
    latitude: 35.6895,
    longitude: 139.6917,
    tag: "job-1",
  });
  assertEquals(submitted.taskId, "task-1");
  const sent = request as Request | null;
  assert(sent !== null);
  const payload = await sent.clone().json() as Array<Record<string, unknown>>;
  assertEquals(payload.length, 1);
  assertEquals(payload[0]?.depth, 100);
  assertEquals(payload[0]?.location_coordinate, "35.6895000,139.6917000,15");
});

Deno.test("DataForSEO parses all competitor positions from one snapshot", async () => {
  const client = new DataForSeoClient({
    login: "owner@example.test",
    password: "password-secret",
    fetcher: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status_code: 20000,
            tasks: [{
              id: "task-1",
              status_code: 20000,
              cost: 0.0006,
              result: [{
                items: [
                  {
                    type: "maps_search",
                    rank_absolute: 2,
                    place_id: "place-own",
                    title: "自店",
                  },
                  {
                    type: "maps_search",
                    rank_absolute: 1,
                    place_id: "place-rival",
                    title: "競合",
                  },
                ],
              }],
            }],
          }),
          { status: 200 },
        ),
      ),
  });
  const result = await client.mapsTask("task-1");
  assertEquals(result.ready, true);
  assertEquals(result.results.map((item) => item.placeId), [
    "place-rival",
    "place-own",
  ]);
});

Deno.test("OAuth URLs request only the required business scopes and bind state", () => {
  const google = new URL(googleAuthorizationUrl({
    clientId: "google-client",
    redirectUri: "https://api.example.test/google/callback",
    state: "state-google",
    codeChallenge: "c".repeat(43),
  }));
  assertEquals(google.searchParams.get("state"), "state-google");
  assertEquals(
    google.searchParams.get("scope"),
    "https://www.googleapis.com/auth/business.manage",
  );
  assertEquals(google.searchParams.get("code_challenge"), "c".repeat(43));
  assertEquals(google.searchParams.get("code_challenge_method"), "S256");
  assertEquals(google.searchParams.has("include_granted_scopes"), false);
  const instagram = new URL(instagramAuthorizationUrl({
    appId: "instagram-app",
    redirectUri: "https://api.example.test/instagram/callback",
    state: "state-instagram",
  }));
  assertEquals(instagram.searchParams.get("scope"), "instagram_business_basic");
  assertEquals(instagram.searchParams.get("state"), "state-instagram");
});

Deno.test("Google token exchange binds the authorization code to the PKCE verifier", async () => {
  let request: Request | null = null;
  const client = new GoogleBusinessClient({
    clientId: "client",
    clientSecret: "secret-value",
    redirectUri: "https://api.example.test/callback",
    fetcher: (input, init) => {
      request = new Request(input, init);
      return Promise.resolve(
        new Response(JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/business.manage",
        })),
      );
    },
  });

  await client.exchangeCode("authorization-code", "v".repeat(43));

  const sent = request as Request | null;
  assert(sent !== null);
  const body = new URLSearchParams(await sent.clone().text());
  assertEquals(body.get("code_verifier"), "v".repeat(43));
  assertEquals(body.get("grant_type"), "authorization_code");
});

Deno.test("Google review reply rejects a review from another location before fetch", async () => {
  let calls = 0;
  const client = new GoogleBusinessClient({
    clientId: "client",
    clientSecret: "secret-value",
    redirectUri: "https://api.example.test/callback",
    fetcher: () => {
      calls += 1;
      return Promise.resolve(new Response("{}"));
    },
  });
  let message = "";
  try {
    await client.reply(
      "token",
      "accounts/a/locations/one",
      "accounts/a/locations/two/reviews/r",
      "返信です",
    );
  } catch (error) {
    message = error instanceof Error ? error.message : "unknown";
  }
  assertEquals(message, "REVIEW_LOCATION_MISMATCH");
  assertEquals(calls, 0);
});

Deno.test("Google profile requests only valid Business Information Location fields", async () => {
  let requestedUrl = "";
  const client = new GoogleBusinessClient({
    clientId: "client",
    clientSecret: "secret-value",
    redirectUri: "https://api.example.test/callback",
    fetcher: (input) => {
      requestedUrl = String(input);
      return Promise.resolve(
        new Response(JSON.stringify({ name: "locations/one" }), {
          status: 200,
        }),
      );
    },
  });

  await client.profile("token", "accounts/a/locations/one");

  const readMask = new URL(requestedUrl).searchParams.get("readMask") ?? "";
  assert(readMask.split(",").includes("categories"));
  assert(!readMask.split(",").includes("primaryCategory"));
  assert(!readMask.split(",").includes("additionalCategories"));
});

Deno.test("Google health read endpoints use bounded documented list requests", async () => {
  const requested: URL[] = [];
  const locationName = "accounts/a/locations/one";
  const client = new GoogleBusinessClient({
    clientId: "client",
    clientSecret: "secret-value",
    redirectUri: "https://api.example.test/callback",
    fetcher: (input) => {
      const url = new URL(String(input));
      requested.push(url);
      if (url.pathname.endsWith("/reviews")) {
        return Promise.resolve(
          new Response(JSON.stringify(
            url.searchParams.has("pageToken")
              ? { reviews: [] }
              : { reviews: [], nextPageToken: "reviews-page-2" },
          )),
        );
      }
      if (url.pathname.endsWith("/media")) {
        return Promise.resolve(
          new Response(JSON.stringify(
            url.searchParams.has("pageToken")
              ? {
                mediaItems: [{
                  name: `${locationName}/media/video`,
                  mediaFormat: "VIDEO",
                  createTime: "2026-08-11T00:00:00Z",
                }],
                totalMediaItemCount: 2,
              }
              : {
                mediaItems: [{
                  name: `${locationName}/media/photo`,
                  mediaFormat: "PHOTO",
                  createTime: "2026-08-10T00:00:00Z",
                }],
                totalMediaItemCount: 2,
                nextPageToken: "media-page-2",
              },
          )),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(
          url.searchParams.has("pageToken")
            ? {
              localPosts: [{
                name: `${locationName}/localPosts/post-2`,
                createTime: "2026-08-10T00:00:00Z",
                updateTime: "2026-08-12T00:00:00Z",
              }],
            }
            : {
              localPosts: [{
                name: `${locationName}/localPosts/post-1`,
                createTime: "2026-08-09T00:00:00Z",
                updateTime: "2026-08-11T00:00:00Z",
              }],
              nextPageToken: "posts-page-2",
            },
        )),
      );
    },
  });

  const [reviews, media, posts] = await Promise.all([
    client.reviews("token", locationName),
    client.media("token", locationName),
    client.localPosts("token", locationName),
  ]);

  assertEquals(reviews, {
    reviews: [],
    complete: true,
    totalReviewCount: null,
  });
  assertEquals(media.complete, true);
  assertEquals(media.totalMediaItemCount, 2);
  assertEquals(media.mediaItems.map((item) => item.mediaFormat), [
    "PHOTO",
    "VIDEO",
  ]);
  assertEquals(posts.complete, true);
  assertEquals(posts.posts.map((post) => post.updateTime), [
    "2026-08-11T00:00:00Z",
    "2026-08-12T00:00:00Z",
  ]);
  assertEquals(
    requested.filter((url) => url.pathname.endsWith("/reviews"))[0]
      ?.searchParams
      .get("pageSize"),
    "50",
  );
  assertEquals(
    requested.filter((url) => url.pathname.endsWith("/reviews"))[1]
      ?.searchParams
      .get("pageToken"),
    "reviews-page-2",
  );
  assertEquals(
    requested.filter((url) => url.pathname.endsWith("/media"))[0]?.searchParams
      .get("pageSize"),
    "2500",
  );
  assertEquals(
    requested.filter((url) => url.pathname.endsWith("/media"))[1]?.searchParams
      .get("pageToken"),
    "media-page-2",
  );
  assertEquals(
    requested.filter((url) => url.pathname.endsWith("/localPosts"))[0]
      ?.searchParams
      .get("pageSize"),
    "100",
  );
  assertEquals(
    requested.filter((url) => url.pathname.endsWith("/localPosts"))[1]
      ?.searchParams
      .get("pageToken"),
    "posts-page-2",
  );
});

Deno.test("Google account and location discovery follows both bounded page tokens", async () => {
  const requested: URL[] = [];
  const client = new GoogleBusinessClient({
    clientId: "client",
    clientSecret: "secret-value",
    redirectUri: "https://api.example.test/callback",
    fetcher: (input) => {
      const url = new URL(String(input));
      requested.push(url);
      if (url.hostname.startsWith("mybusinessaccountmanagement")) {
        return Promise.resolve(
          new Response(JSON.stringify(
            url.searchParams.get("pageToken") === "account-page-2"
              ? { accounts: [{ name: "accounts/b" }] }
              : {
                accounts: [{ name: "accounts/a" }],
                nextPageToken: "account-page-2",
              },
          )),
        );
      }
      if (url.pathname.includes("/accounts/a/locations")) {
        return Promise.resolve(
          new Response(JSON.stringify(
            url.searchParams.get("pageToken") === "location-page-2"
              ? { locations: [{ name: "locations/a2", title: "店舗A2" }] }
              : {
                locations: [{
                  name: "locations/a1",
                  title: "店舗A1",
                  latlng: { latitude: 35.693825, longitude: 139.703356 },
                }],
                nextPageToken: "location-page-2",
              },
          )),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({
          locations: [{ name: "locations/b1", title: "店舗B1" }],
        })),
      );
    },
  });

  const locations = await client.locations("token");

  assertEquals(locations.map((location) => location.name), [
    "accounts/a/locations/a1",
    "accounts/a/locations/a2",
    "accounts/b/locations/b1",
  ]);
  assertEquals(locations[0]?.latlng, {
    latitude: 35.693825,
    longitude: 139.703356,
  });
  assertEquals(locations[1]?.latlng, null);
  assertEquals(
    requested.find((url) => url.pathname.includes("/accounts/a/locations"))
      ?.searchParams.get("readMask"),
    "name,title,storefrontAddress,latlng",
  );
  assertEquals(
    requested.find((url) =>
      url.hostname.startsWith("mybusinessaccountmanagement") &&
      url.searchParams.has("pageToken")
    )?.searchParams.get("pageToken"),
    "account-page-2",
  );
  assertEquals(
    requested.find((url) =>
      url.pathname.includes("/accounts/a/locations") &&
      url.searchParams.has("pageToken")
    )?.searchParams.get("pageToken"),
    "location-page-2",
  );
});

Deno.test("Google review pagination marks a bounded truncated result incomplete", async () => {
  let calls = 0;
  const client = new GoogleBusinessClient({
    clientId: "client",
    clientSecret: "secret-value",
    redirectUri: "https://api.example.test/callback",
    fetcher: () => {
      calls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({
          reviews: [{
            name: `accounts/a/locations/one/reviews/${calls}`,
            createTime: "2026-08-01T00:00:00Z",
          }],
          totalReviewCount: 2_000,
          nextPageToken: `page-${calls + 1}`,
        })),
      );
    },
  });

  const result = await client.reviews("token", "accounts/a/locations/one");

  assertEquals(calls, 20);
  assertEquals(result.reviews.length, 20);
  assertEquals(result.complete, false);
  assertEquals(result.totalReviewCount, 2_000);
});

Deno.test("Google health media and local post bounds expose incomplete pages", async () => {
  const locationName = "accounts/a/locations/one";
  let mediaCalls = 0;
  let postCalls = 0;
  const client = new GoogleBusinessClient({
    clientId: "client",
    clientSecret: "secret-value",
    redirectUri: "https://api.example.test/callback",
    fetcher: (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/media")) {
        mediaCalls += 1;
        return Promise.resolve(
          new Response(JSON.stringify({
            mediaItems: [{
              name: `${locationName}/media/${mediaCalls}`,
              mediaFormat: "PHOTO",
            }],
            totalMediaItemCount: 20_000,
            nextPageToken: `media-${mediaCalls + 1}`,
          })),
        );
      }
      postCalls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({
          localPosts: [{
            name: `${locationName}/localPosts/${postCalls}`,
            createTime: "2026-08-01T00:00:00Z",
          }],
          nextPageToken: `posts-${postCalls + 1}`,
        })),
      );
    },
  });

  const [media, posts] = await Promise.all([
    client.media("token", locationName),
    client.localPosts("token", locationName),
  ]);

  assertEquals(mediaCalls, 4);
  assertEquals(media.mediaItems.length, 4);
  assertEquals(media.complete, false);
  assertEquals(media.totalMediaItemCount, 20_000);
  assertEquals(postCalls, 10);
  assertEquals(posts.posts.length, 10);
  assertEquals(posts.complete, false);
});

Deno.test("Google local post pagination is complete when page ten has no next token", async () => {
  const locationName = "accounts/a/locations/one";
  let calls = 0;
  const client = new GoogleBusinessClient({
    clientId: "client",
    clientSecret: "secret-value",
    redirectUri: "https://api.example.test/callback",
    fetcher: () => {
      calls += 1;
      return Promise.resolve(
        new Response(JSON.stringify({
          localPosts: [{
            name: `${locationName}/localPosts/${calls}`,
            createTime: `2026-08-${String(calls).padStart(2, "0")}T00:00:00Z`,
          }],
          ...(calls < 10 ? { nextPageToken: `posts-${calls + 1}` } : {}),
        })),
      );
    },
  });

  const result = await client.localPosts("token", locationName);

  assertEquals(calls, 10);
  assertEquals(result.posts.length, 10);
  assertEquals(result.posts.at(-1)?.createTime, "2026-08-10T00:00:00Z");
  assertEquals(result.complete, true);
});

Deno.test("Google health pagination rejects malformed and repeated next tokens", async () => {
  const locationName = "accounts/a/locations/one";
  const cases = [
    { token: 42, expected: "INVALID_GOOGLE_REVIEW_PAGE_TOKEN" },
    { token: "x".repeat(2_049), expected: "INVALID_GOOGLE_MEDIA_PAGE_TOKEN" },
    { token: "same-token", expected: "INVALID_GOOGLE_LOCAL_POST_PAGE_TOKEN" },
  ] as const;

  for (const testCase of cases) {
    let calls = 0;
    const client = new GoogleBusinessClient({
      clientId: "client",
      clientSecret: "secret-value",
      redirectUri: "https://api.example.test/callback",
      fetcher: () => {
        calls += 1;
        return Promise.resolve(
          new Response(JSON.stringify({
            reviews: [],
            mediaItems: [],
            localPosts: [],
            nextPageToken: testCase.token,
          })),
        );
      },
    });

    let message = "";
    try {
      if (testCase.expected.includes("REVIEW")) {
        await client.reviews("token", locationName);
      } else if (testCase.expected.includes("MEDIA")) {
        await client.media("token", locationName);
      } else {
        await client.localPosts("token", locationName);
      }
    } catch (error) {
      message = error instanceof Error ? error.message : "unknown";
    }
    assertEquals(message, testCase.expected);
    assertEquals(calls, testCase.token === "same-token" ? 2 : 1);
  }
});

Deno.test("Google write readback is fetched from the exact review and local post resource", async () => {
  const requests: Request[] = [];
  const locationName = "accounts/a/locations/one";
  const reviewName = `${locationName}/reviews/r`;
  const postName = `${locationName}/localPosts/p`;
  const imageUrl = "https://cdn.example.test/post.jpg";
  const client = new GoogleBusinessClient({
    clientId: "client",
    clientSecret: "secret-value",
    redirectUri: "https://api.example.test/callback",
    fetcher: (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.method === "PUT") {
        return Promise.resolve(
          new Response(JSON.stringify({ comment: "返信です" }), {
            status: 200,
          }),
        );
      }
      if (request.method === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ name: postName }), { status: 200 }),
        );
      }
      if (request.url.endsWith(`/v4/${reviewName}`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              name: reviewName,
              reviewReply: {
                comment: "返信です",
                updateTime: "2026-08-11T00:00:00Z",
              },
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            name: postName,
            summary: "投稿です",
            media: [{ sourceUrl: imageUrl }],
          }),
          { status: 200 },
        ),
      );
    },
  });

  await client.reply("token", locationName, reviewName, "返信です");
  const review = await client.review("token", locationName, reviewName);
  const created = await client.createLocalPost("token", locationName, {
    summary: "投稿です",
    imageUrl,
  });
  const post = await client.localPost("token", locationName, created.name);

  assertEquals(review.replyComment, "返信です");
  assertEquals(post, {
    name: postName,
    summary: "投稿です",
    media: [{ sourceUrl: imageUrl }],
  });
  assertEquals(requests.map((request) => request.method), [
    "PUT",
    "GET",
    "POST",
    "GET",
  ]);
});

Deno.test("Google review readback rejects a different review resource", async () => {
  const locationName = "accounts/a/locations/one";
  const reviewName = `${locationName}/reviews/requested`;
  const client = new GoogleBusinessClient({
    clientId: "client",
    clientSecret: "secret-value",
    redirectUri: "https://api.example.test/callback",
    fetcher: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            name: `${locationName}/reviews/different`,
            reviewReply: { comment: "同じ返信です" },
          }),
          { status: 200 },
        ),
      ),
  });

  let message = "";
  try {
    await client.review("token", locationName, reviewName);
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }
  assertEquals(message, "GOOGLE_REVIEW_READBACK_MISMATCH");
});

Deno.test("Places search uses the lowest bounded field mask", async () => {
  const requests: Request[] = [];
  const client = new GooglePlacesClient({
    apiKey: "places-key",
    fetcher: (input, init) => {
      requests.push(new Request(input, init));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            places: [{
              id: "place-one",
              displayName: { text: "テスト店" },
              formattedAddress: "東京都",
            }],
          }),
          { status: 200 },
        ),
      );
    },
  });
  const result = await client.textSearch({ textQuery: "新宿 カフェ" });
  assertEquals(result[0]?.id, "place-one");
  assertEquals(requests[0]?.headers.get("X-Goog-FieldMask"), "places.id");
});

Deno.test("Instagram media parser uses the current Instagram Login host", async () => {
  let calledUrl = "";
  const client = new InstagramClient({
    appId: "app-id",
    appSecret: "app-secret-value",
    redirectUri: "https://api.example.test/callback",
    fetcher: (input) => {
      calledUrl = String(input);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{
              id: "media-1",
              caption: "投稿",
              media_type: "IMAGE",
              media_url: "https://cdn.example.test/a.jpg",
            }],
          }),
          { status: 200 },
        ),
      );
    },
  });
  const media = await client.media({
    accessToken: "instagram-token",
    expiresAt: "2026-10-01T00:00:00.000Z",
    instagramUserId: "123",
  });
  assert(calledUrl.startsWith("https://graph.instagram.com/v25.0/123/media"));
  assertEquals(media[0]?.mediaType, "IMAGE");
});
