import { HttpClient, type HttpClientOptions } from './http.js'
import { DevicesService } from './services/devices.js'
import { NotificationsService } from './services/notifications.js'
import { OtpService } from './services/otp.js'
import { WebhooksService } from './services/webhooks.js'
import { verifyWebhookSignature } from './signature.js'

export type MauKirimOptions = HttpClientOptions

/**
 * The official MauKirim client — https://maukirim.com
 *
 * ```ts
 * const maukirim = new MauKirim({ apiKey: process.env.MAUKIRIM_API_KEY! })
 * const { challengeId } = await maukirim.otp.send({
 *   phone: '+6281234567890', purpose: 'signup', idempotencyKey: `signup-${sessionId}`,
 * })
 * ```
 *
 * One client holds one API key. Keys are scoped (`otp`, `notification`, `read`, `send`, `device`,
 * `webhook`), so construct a client per service with only the scopes that service needs.
 */
export class MauKirim {
  readonly otp: OtpService
  readonly notifications: NotificationsService
  readonly devices: DevicesService
  readonly webhooks: WebhooksService
  /** Origin + version prefix the client talks to. */
  readonly baseUrl: string

  constructor(options: MauKirimOptions) {
    const http = new HttpClient(options)
    this.baseUrl = http.baseUrl
    this.otp = new OtpService(http)
    this.notifications = new NotificationsService(http)
    this.devices = new DevicesService(http)
    this.webhooks = new WebhooksService(http)
  }

  /**
   * Verify an inbound webhook's `x-maukirim-signature` over the raw request body.
   * The same rules as {@link verifyWebhookSignature}, available without importing it separately.
   */
  static verifyWebhookSignature = verifyWebhookSignature
}
