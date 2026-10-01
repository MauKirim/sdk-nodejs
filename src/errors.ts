/** HTTP statuses MauKirim documents as safe to retry with the same Idempotency-Key. */
const RETRYABLE_STATUSES: Record<number, true> = {
  408: true,
  425: true,
  429: true,
  500: true,
  502: true,
  503: true,
  504: true,
}

export interface MauKirimErrorInit {
  /** HTTP status, or `0` when the request never reached the API (transport failure, timeout, abort). */
  status: number
  /** The machine-readable `code` from `{ ok: false, code }`, when the body carried one. */
  code?: string
  /** Defaults to `MauKirimError.retryableStatus(status)`. */
  retryable?: boolean
  /** The decoded response body, when there was one. Never contains customer data. */
  body?: unknown
  cause?: unknown
}

/**
 * Every failure the SDK raises: an HTTP error envelope, a transport failure, a timeout or an abort.
 */
export class MauKirimError extends Error {
  /** HTTP status, or `0` for a failure that never produced a response. */
  readonly status: number
  /** The API's machine-readable failure code, e.g. `api_key_scope_denied`. */
  readonly code?: string
  /** Whether retrying with the same Idempotency-Key is documented as safe. */
  readonly retryable: boolean
  /** The decoded response body for an HTTP failure. */
  readonly body?: unknown

  constructor(message: string, init: MauKirimErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = 'MauKirimError'
    this.status = init.status
    this.code = init.code
    this.retryable = init.retryable ?? MauKirimError.retryableStatus(init.status)
    this.body = init.body
    Object.setPrototypeOf(this, MauKirimError.prototype)
  }

  /** `true` for 5xx, 408, 425 and 429 — the statuses the API documents as retryable. */
  static retryableStatus(status: number): boolean {
    return RETRYABLE_STATUSES[status] === true
  }
}
