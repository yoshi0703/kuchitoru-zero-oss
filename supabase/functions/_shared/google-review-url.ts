import { appError } from "./http.ts";

const SAFE_ID = /^[A-Za-z0-9_-]{3,512}$/;
const PLACE_ID = /^[A-Za-z0-9_:+-]{3,512}$/;

export function normalizeGoogleReviewUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw appError(
      "INVALID_GOOGLE_REVIEW_URL",
      "Google口コミURLを確認してください。",
      400,
    );
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw appError(
      "INVALID_GOOGLE_REVIEW_URL",
      "Google口コミURLを確認してください。",
      400,
    );
  }
  url.hash = "";

  if (
    url.hostname === "search.google.com" &&
    url.pathname.replace(/\/$/, "") === "/local/writereview"
  ) {
    const placeId = url.searchParams.get("placeid")?.trim() ?? "";
    if (!PLACE_ID.test(placeId)) {
      throw appError(
        "INVALID_GOOGLE_REVIEW_URL",
        "Google口コミURLを確認してください。",
        400,
      );
    }
    const normalized = new URL("https://search.google.com/local/writereview");
    normalized.searchParams.set("placeid", placeId);
    return normalized.toString();
  }

  if (
    url.hostname === "g.page" &&
    /^\/r\/[A-Za-z0-9_-]+\/review\/?$/.test(url.pathname) && url.search === ""
  ) {
    const id = url.pathname.split("/")[2] ?? "";
    if (!SAFE_ID.test(id)) {
      throw appError(
        "INVALID_GOOGLE_REVIEW_URL",
        "Google口コミURLを確認してください。",
        400,
      );
    }
    return `https://g.page/r/${id}/review`;
  }

  if (["google.com", "www.google.com"].includes(url.hostname)) {
    const q = url.searchParams.get("q") ?? "";
    const isPlaceIdQuery = /^place_id:[A-Za-z0-9_:+-]{3,512}$/.test(q);
    const isExplicitReviewPath = url.pathname.startsWith("/maps/place/") &&
      url.pathname.includes("!9m1!1b1");
    const hasRedirectParameter = ["url", "u", "redirect", "continue", "next"]
      .some((key) => url.searchParams.has(key));
    if (
      !hasRedirectParameter &&
      ((url.pathname === "/maps/place/" && isPlaceIdQuery) ||
        isExplicitReviewPath)
    ) {
      url.hostname = "www.google.com";
      return url.toString();
    }
  }

  throw appError(
    "INVALID_GOOGLE_REVIEW_URL",
    "Google口コミURLを確認してください。",
    400,
  );
}
