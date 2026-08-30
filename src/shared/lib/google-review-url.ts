const G_PAGE_REVIEW_PATH = /^\/r\/[A-Za-z0-9_-]+\/review\/?$/

function isAllowedGoogleMapsUrl(url: URL): boolean {
  if (url.hostname !== 'google.com' && url.hostname !== 'www.google.com') return false

  if (url.pathname === '/maps' || url.pathname === '/maps/') {
    const cid = url.searchParams.get('cid')
    const query = url.searchParams.get('q')
    return Boolean(cid?.trim()) || Boolean(query?.startsWith('place_id:'))
  }

  return /^\/maps\/(place|search)\//.test(url.pathname)
}

export function validateGoogleReviewUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('Google口コミ投稿URLを確認してください。')
  }

  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== ''
  ) {
    throw new Error('HTTPSのGoogle口コミ投稿URLを入力してください。')
  }

  const searchReview =
    url.hostname === 'search.google.com' &&
    url.pathname === '/local/writereview' &&
    Boolean(url.searchParams.get('placeid')?.trim())
  const gPageReview = url.hostname === 'g.page' && G_PAGE_REVIEW_PATH.test(url.pathname)

  if (!searchReview && !gPageReview && !isAllowedGoogleMapsUrl(url)) {
    throw new Error('許可されたGoogle口コミ投稿URLを入力してください。')
  }

  url.hash = ''
  return url.toString()
}
