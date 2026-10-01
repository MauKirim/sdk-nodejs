import { MauKirimError } from './errors.js'
import { DEFAULT_BASE_URL, USER_AGENT } from './version.js'

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export type QueryValue = string | number | boolean | null | undefined

export interface HttpClientOptions {
  /** A MauKirim API key (`mk_live_…`). Scoped; send it from a backend only. */
  apiKey: string
  /** Origin + version prefix. Defaults to `https://app.maukirim.com/api/v1`. */
  baseUrl?: string
  /** Injectable for tests or a proxied environment. Defaults to the global `fetch`. */
  fetch?: typeof fetch
  /** Retries for retryable failures. Default `2`. */
  maxRetries?: number
  /** Backoff in ms before retry `attempt` (1-based). Default 250ms, 500ms, 1s, capped at 4s. */
  retryDelayMs?: (attempt: number) => number
  /** Per-attempt timeout. Default `30000`. `0` disables it. */
  timeoutMs?: number
  userAgent?: string
}

export interface RequestOptions {
  method: HttpMethod
  /** Path below the base URL, e.g. `/otp/send`. */
  path: string
  /** JSON body. Mutually exclusive with `form`. */
  body?: unknown
  /** Multipart body; `Content-Type` is left to `fetch` so the boundary is correct. */
  form?: FormData
  /** Appended to the URL; `undefined`, `null` and `''` are dropped. */
  query?: Record<string, QueryValue>
  /** Sent as `Idempotency-Key`. Required by `/otp/send`, `/messages/send` and device sends. */
  idempotencyKey?: string
  /** Enforce the header client-side for a route that mandates it. */
  requireIdempotencyKey?: boolean
  signal?: AbortSignal
}

/**
 * The transport under every service: URL building, auth, idempotency, retries and error decoding.
 *
 * Not usually constructed directly — {@link MauKirim} owns one. Exposed for advanced use.
 */
export class HttpClient {
  readonly baseUrl: string
  readonly maxRetries: number
  private readonly apiKey: string
  private readonly fetchImpl: typeof fetch
  private readonly retryDelayMs: (attempt: number) => number
  private readonly timeoutMs: number
  private readonly userAgent: string

  constructor(options: HttpClientOptions) {
    if (!options.apiKey) {
      throw new MauKirimError('A MauKirim API key is required', { status: 0, code: 'missing_api_key', retryable: false })
    }
    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.maxRetries = options.maxRetries ?? 2
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.userAgent = options.userAgent ?? USER_AGENT
    this.retryDelayMs = options.retryDelayMs ?? ((attempt) => Math.min(250 * 2 ** (attempt - 1), 4_000))
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  async request<T>(options: RequestOptions): Promise<T> {
    if (options.requireIdempotencyKey && !options.idempotencyKey) {
      throw new MauKirimError('MauKirim requires an Idempotency-Key for this request', {
        status: 0,
        code: 'missing_idempotency_key',
        retryable: false,
      })
    }

    const url = this.urlFor(options)
    const headers = this.headersFor(options)
    const body = options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body))

    let attempt = 0
    for (;;) {
      if (attempt > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, this.retryDelayMs(attempt)))
      }
      try {
        return await this.send<T>(url, options.method, headers, body, options.signal)
      } catch (error) {
        const failure = error as MauKirimError
        if (attempt >= this.maxRetries || !failure.retryable) throw failure
        attempt += 1
      }
    }
  }

  private urlFor(options: RequestOptions): string {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === '') continue
      search.append(key, String(value))
    }
    const suffix = search.toString()
    return `${this.baseUrl}${options.path}${suffix ? `?${suffix}` : ''}`
  }

  private headersFor(options: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey
    return headers
  }

  private async send<T>(
    url: string,
    method: HttpMethod,
    headers: Record<string, string>,
    body: string | FormData | undefined,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const controller = new AbortController()
    let timedOut = false
    const timer =
      this.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            controller.abort()
          }, this.timeoutMs)
        : undefined
    const forwardAbort = () => controller.abort()
    signal?.addEventListener('abort', forwardAbort, { once: true })

    try {
      const response = await this.fetchImpl(url, { method, headers, body, signal: controller.signal })
      const text = await response.text()
      const payload = decodeBody(text)

      if (!response.ok) {
        const code = failureCode(payload)
        throw new MauKirimError(
          code ? `MauKirim API error ${response.status} (${code})` : `MauKirim API error ${response.status}`,
          { status: response.status, code, body: payload, retryable: MauKirimError.retryableStatus(response.status) },
        )
      }
      return payload as T
    } catch (error) {
      if (error instanceof MauKirimError) throw error
      if (timedOut) {
        throw new MauKirimError(`MauKirim request timed out after ${this.timeoutMs}ms`, {
          status: 0,
          code: 'timeout',
          retryable: true,
          cause: error,
        })
      }
      if (signal?.aborted) {
        throw new MauKirimError('MauKirim request was aborted', {
          status: 0,
          code: 'aborted',
          retryable: false,
          cause: error,
        })
      }
      throw new MauKirimError(`MauKirim request failed: ${error instanceof Error ? error.message : String(error)}`, {
        status: 0,
        retryable: true,
        cause: error,
      })
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', forwardAbort)
    }
  }
}

function decodeBody(text: string): unknown {
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Extract `code` from a `{ ok: false, code }` envelope; `undefined` for anything else. */
function failureCode(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const envelope = payload as { ok?: unknown; code?: unknown }
  return envelope.ok === false && typeof envelope.code === 'string' ? envelope.code : undefined
}
