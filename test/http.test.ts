import { afterEach, describe, expect, it } from 'vitest'
import { HttpClient } from '../src/http.js'
import { MauKirimError } from '../src/errors.js'
import { startServer, json, type TestServer } from './helpers.js'

let server: TestServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

function clientFor(s: TestServer, overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) {
  return new HttpClient({
    apiKey: 'mk_live_test',
    baseUrl: s.baseUrl,
    maxRetries: 2,
    retryDelayMs: () => 0,
    ...overrides,
  })
}

describe('HttpClient', () => {
  it('defaults to the MauKirim production base URL', () => {
    expect(new HttpClient({ apiKey: 'k' }).baseUrl).toBe('https://app.maukirim.com/api/v1')
  })

  it('normalizes a trailing slash on a custom base URL', () => {
    expect(new HttpClient({ apiKey: 'k', baseUrl: 'https://example.test/api/v1/' }).baseUrl).toBe(
      'https://example.test/api/v1',
    )
  })

  it('sends the API key as a bearer token and identifies itself', async () => {
    server = await startServer((_req, res) => json(res, 200, { ok: true }))
    await clientFor(server).request({ method: 'GET', path: '/devices' })

    const [req] = server.requests
    expect(req?.headers.authorization).toBe('Bearer mk_live_test')
    expect(String(req?.headers['user-agent'])).toContain('maukirim-node/')
  })

  it('builds the URL from base URL and path', async () => {
    server = await startServer((_req, res) => json(res, 200, { ok: true }))
    await clientFor(server).request({ method: 'GET', path: '/devices/gwd_1' })
    expect(server.requests[0]?.url).toBe('/api/v1/devices/gwd_1')
  })

  it('appends only defined query values and skips blanks', async () => {
    server = await startServer((_req, res) => json(res, 200, { ok: true }))
    await clientFor(server).request({
      method: 'GET',
      path: '/webhook-deliveries',
      query: { deviceId: 'gwd_1', limit: 25, offset: undefined, empty: '' },
    })
    expect(server.requests[0]?.url).toBe('/api/v1/webhook-deliveries?deviceId=gwd_1&limit=25')
  })

  it('serializes a JSON body with the JSON content type', async () => {
    server = await startServer((_req, res) => json(res, 200, { ok: true }))
    await clientFor(server).request({
      method: 'POST',
      path: '/otp/send',
      body: { phone: '+6281234567890', purpose: 'signup' },
    })

    const [req] = server.requests
    expect(req?.headers['content-type']).toBe('application/json')
    expect(JSON.parse(String(req?.body))).toEqual({ phone: '+6281234567890', purpose: 'signup' })
  })

  it('sends an Idempotency-Key header when one is given', async () => {
    server = await startServer((_req, res) => json(res, 200, { ok: true }))
    await clientFor(server).request({ method: 'POST', path: '/otp/send', body: {}, idempotencyKey: 'signup-1' })
    expect(server.requests[0]?.headers['idempotency-key']).toBe('signup-1')
  })

  it('refuses a route that requires an Idempotency-Key when none is supplied, without calling the API', async () => {
    server = await startServer((_req, res) => json(res, 200, { ok: true }))
    const client = clientFor(server)
    await expect(
      client.request({ method: 'POST', path: '/otp/send', body: {}, requireIdempotencyKey: true }),
    ).rejects.toThrowError(/Idempotency-Key/)
    expect(server.requests).toHaveLength(0)
  })

  it('decodes a JSON success response', async () => {
    server = await startServer((_req, res) => json(res, 200, { ok: true, verified: true }))
    const out = await clientFor(server).request<{ verified: boolean }>({
      method: 'POST',
      path: '/otp/verify',
      body: {},
    })
    expect(out.verified).toBe(true)
  })

  it('posts multipart form data without setting its own content type', async () => {
    server = await startServer((_req, res) => json(res, 200, { ok: true, media: { id: 'gwm_1' } }))
    const form = new FormData()
    form.set('phone', '+6281234567890')
    form.set('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'receipt.png')
    await clientFor(server).request({ method: 'POST', path: '/messages/media', form })

    const [req] = server.requests
    expect(String(req?.headers['content-type'])).toMatch(/^multipart\/form-data; boundary=/)
    expect(String(req?.body)).toContain('receipt.png')
  })

  it('turns the failure envelope into a MauKirimError carrying status and code', async () => {
    server = await startServer((_req, res) => json(res, 422, { ok: false, code: 'invalid_input' }))
    const err = await clientFor(server)
      .request({ method: 'POST', path: '/otp/send', body: {} })
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(MauKirimError)
    expect(err).toBeInstanceOf(Error)
    const e = err as MauKirimError
    expect(e.status).toBe(422)
    expect(e.code).toBe('invalid_input')
    expect(e.retryable).toBe(false)
    expect(e.message).toContain('invalid_input')
  })

  it('keeps the status when the failure body is not a MauKirim envelope', async () => {
    server = await startServer((_req, res) => {
      res.writeHead(502, { 'Content-Type': 'text/html' })
      res.end('<html>bad gateway</html>')
    })
    const err = (await clientFor(server)
      .request({ method: 'GET', path: '/devices' })
      .catch((e: unknown) => e)) as MauKirimError

    expect(err).toBeInstanceOf(MauKirimError)
    expect(err.status).toBe(502)
    expect(err.code).toBeUndefined()
    expect(err.retryable).toBe(true)
  })

  it('marks 5xx and 429 as retryable and 4xx as not', async () => {
    expect(MauKirimError.retryableStatus(503)).toBe(true)
    expect(MauKirimError.retryableStatus(500)).toBe(true)
    expect(MauKirimError.retryableStatus(502)).toBe(true)
    expect(MauKirimError.retryableStatus(429)).toBe(true)
    expect(MauKirimError.retryableStatus(404)).toBe(false)
    expect(MauKirimError.retryableStatus(409)).toBe(false)
    expect(MauKirimError.retryableStatus(402)).toBe(false)
  })

  it('retries a 503 with the same Idempotency-Key and succeeds', async () => {
    server = await startServer((_req, res, n) =>
      n < 3 ? json(res, 503, { ok: false, code: 'worker_offline' }) : json(res, 200, { ok: true, batchId: 'gwb_1' }),
    )
    const out = await clientFor(server).request<{ batchId: string }>({
      method: 'POST',
      path: '/messages/send',
      body: { phone: '+6281' },
      idempotencyKey: 'order-1',
      requireIdempotencyKey: true,
    })

    expect(out.batchId).toBe('gwb_1')
    expect(server.requests).toHaveLength(3)
    expect(server.requests.map((r) => r.headers['idempotency-key'])).toEqual(['order-1', 'order-1', 'order-1'])
  })

  it('gives up after maxRetries and surfaces the last error', async () => {
    server = await startServer((_req, res) => json(res, 503, { ok: false, code: 'worker_offline' }))
    const err = (await clientFor(server, { maxRetries: 1 })
      .request({ method: 'GET', path: '/devices' })
      .catch((e: unknown) => e)) as MauKirimError

    expect(err.status).toBe(503)
    expect(err.code).toBe('worker_offline')
    expect(err.retryable).toBe(true)
    expect(server.requests).toHaveLength(2)
  })

  it('does not retry a 400', async () => {
    server = await startServer((_req, res) => json(res, 400, { ok: false, code: 'invalid_input' }))
    await clientFor(server)
      .request({ method: 'POST', path: '/otp/verify', body: {} })
      .catch(() => undefined)
    expect(server.requests).toHaveLength(1)
  })

  it('reports a transport failure as a retryable error with status 0', async () => {
    const client = new HttpClient({
      apiKey: 'k',
      baseUrl: 'http://127.0.0.1:9/api/v1',
      maxRetries: 0,
      retryDelayMs: () => 0,
    })
    const err = (await client.request({ method: 'GET', path: '/devices' }).catch((e: unknown) => e)) as MauKirimError
    expect(err).toBeInstanceOf(MauKirimError)
    expect(err.status).toBe(0)
    expect(err.retryable).toBe(true)
  })

  // Real timers on purpose: the timeout path races a real socket against AbortSignal, which fake
  // timers cannot drive. The delay is the server's, well under vitest's 10s test timeout.
  it('aborts a request that exceeds the timeout', async () => {
    server = await startServer((_req, res) => {
      setTimeout(() => json(res, 200, { ok: true }), 300)
    })
    const err = (await clientFor(server, { timeoutMs: 60, maxRetries: 0 })
      .request({ method: 'GET', path: '/devices' })
      .catch((e: unknown) => e)) as MauKirimError

    expect(err).toBeInstanceOf(MauKirimError)
    expect(err.code).toBe('timeout')
    expect(err.retryable).toBe(true)
  })

  // Real timer on purpose: aborting a live socket cannot be driven by fake timers.
  it('honours a caller-supplied AbortSignal', async () => {
    server = await startServer((_req, res) => {
      setTimeout(() => json(res, 200, { ok: true }), 300)
    })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 20)
    const err = (await clientFor(server, { maxRetries: 0 })
      .request({ method: 'GET', path: '/devices', signal: controller.signal })
      .catch((e: unknown) => e)) as MauKirimError

    expect(err).toBeInstanceOf(MauKirimError)
    expect(err.code).toBe('aborted')
    expect(err.status).toBe(0)
  })

  it('returns undefined for an empty response body', async () => {
    server = await startServer((_req, res) => {
      res.writeHead(200)
      res.end()
    })
    await expect(clientFor(server).request({ method: 'DELETE', path: '/devices/gwd_1/webhook' })).resolves.toBeUndefined()
  })
})
