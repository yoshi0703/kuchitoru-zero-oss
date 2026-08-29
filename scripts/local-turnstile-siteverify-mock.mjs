import { timingSafeEqual } from 'node:crypto'
import http from 'node:http'

const secret = requiredEnvironment('KUCHITORU_INTEGRATION_TURNSTILE_SECRET')
const token = requiredEnvironment('KUCHITORU_INTEGRATION_TURNSTILE_TOKEN')
const idempotencyKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
let tokenConsumed = false

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required by the local Turnstile mock`)
  return value
}

function sameValue(actual, expected) {
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
}

function json(response, status, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(body))
}

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    json(response, 200, { ready: true })
    return
  }
  if (
    request.method !== 'POST' ||
    request.url !== '/turnstile/v0/siteverify' ||
    request.headers['content-type']?.split(';', 1)[0] !==
      'application/x-www-form-urlencoded'
  ) {
    json(response, 404, { success: false })
    return
  }

  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => {
    body += chunk
    if (body.length > 8_192) request.destroy()
  })
  request.on('end', () => {
    const form = new URLSearchParams(body)
    const valid = !tokenConsumed &&
      sameValue(form.get('secret') ?? '', secret) &&
      sameValue(form.get('response') ?? '', token) &&
      (form.get('remoteip')?.length ?? 0) > 0 &&
      idempotencyKeyPattern.test(form.get('idempotency_key') ?? '')
    if (valid) tokenConsumed = true
    json(response, 200, valid
      ? { success: true, hostname: '127.0.0.1', action: 'interview_start' }
      : { success: false })
  })
})

server.listen(4175, '0.0.0.0')

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
