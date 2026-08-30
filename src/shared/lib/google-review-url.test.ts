import { describe, expect, it } from 'vitest'
import { validateGoogleReviewUrl } from './google-review-url'

describe('validateGoogleReviewUrl', () => {
  it('accepts explicit Google review URLs and removes fragments', () => {
    expect(validateGoogleReviewUrl('https://search.google.com/local/writereview?placeid=abc#fragment')).toBe(
      'https://search.google.com/local/writereview?placeid=abc',
    )
    expect(validateGoogleReviewUrl('https://g.page/r/Abc_123-/review')).toBe(
      'https://g.page/r/Abc_123-/review',
    )
  })

  it('accepts explicit Google Maps paths', () => {
    expect(validateGoogleReviewUrl('https://www.google.com/maps/place/example')).toBe(
      'https://www.google.com/maps/place/example',
    )
  })

  it.each([
    'http://search.google.com/local/writereview?placeid=abc',
    'https://search.google.com/local/writereview',
    'https://google.com/url?url=https://evil.example',
    'https://google.com.evil.example/maps/place/a',
    'https://maps.app.goo.gl/short',
    'https://user:pass@www.google.com/maps/place/a',
    'https://www.google.com:8443/maps/place/a',
  ])('rejects unsafe URL %s', (value) => {
    expect(() => validateGoogleReviewUrl(value)).toThrow()
  })
})
