import type { HttpClient } from '../http.js'
import type { SendOtpParams, SendOtpResult, VerifyOtpParams, VerifyOtpResult } from '../types.js'

/** `POST /otp/send` and `POST /otp/verify`. Scope `otp`. */
export class OtpService {
  constructor(private readonly http: HttpClient) {}

  /**
   * Issue a six-digit code, valid five minutes, delivered over WhatsApp.
   * Rate limit: 5 issues per hour per (account, phone number).
   */
  send(params: SendOtpParams): Promise<SendOtpResult> {
    return this.http.request<SendOtpResult>({
      method: 'POST',
      path: '/otp/send',
      body: { phone: params.phone, purpose: params.purpose },
      idempotencyKey: params.idempotencyKey,
      requireIdempotencyKey: true,
    })
  }

  /**
   * Check what the user typed. A wrong code is a successful call with `verified: false`, not an error.
   * A wrong guess consumes one of the challenge's five attempts.
   */
  verify(params: VerifyOtpParams): Promise<VerifyOtpResult> {
    return this.http.request<VerifyOtpResult>({
      method: 'POST',
      path: '/otp/verify',
      body: { challengeId: params.challengeId, code: params.code },
    })
  }
}
