import type { HttpClient } from '../http.js'
import type {
  DeliveryPage,
  DeliveryQuery,
  RemoveWebhookResult,
  SetWebhookParams,
  WebhookInfoResult,
  WebhookResult,
} from '../types.js'

/**
 * The destination MauKirim forwards a rented number's events to, and the log of what it forwarded.
 * Scope `webhook`.
 */
export class WebhooksService {
  constructor(private readonly http: HttpClient) {}

  /** Read the destination, the subscribable event names, and whether the gateway is wired. */
  get(deviceId: string): Promise<WebhookInfoResult> {
    return this.http.request<WebhookInfoResult>({ method: 'GET', path: `/devices/${deviceId}/webhook` })
  }

  /**
   * Create or edit the destination. The returned `secret` is present only when the destination was
   * newly created; an edit keeps the existing secret and omits it.
   */
  set(deviceId: string, params: SetWebhookParams): Promise<WebhookResult> {
    const body: Record<string, unknown> = { url: params.url }
    if (params.events !== undefined) body.events = params.events
    if (params.active !== undefined) body.active = params.active
    return this.http.request<WebhookResult>({ method: 'POST', path: `/devices/${deviceId}/webhook`, body })
  }

  /** Issue a new signing secret. The previous one stops verifying immediately. */
  rotate(deviceId: string): Promise<WebhookResult> {
    return this.http.request<WebhookResult>({ method: 'PUT', path: `/devices/${deviceId}/webhook` })
  }

  /** Stop forwarding and delete the destination, together with its delivery log. */
  remove(deviceId: string): Promise<RemoveWebhookResult> {
    return this.http.request<RemoveWebhookResult>({ method: 'DELETE', path: `/devices/${deviceId}/webhook` })
  }

  /** What MauKirim forwarded and what the endpoint answered, newest first. */
  deliveries(query: DeliveryQuery = {}): Promise<DeliveryPage> {
    return this.http.request<DeliveryPage>({
      method: 'GET',
      path: '/webhook-deliveries',
      query: { deviceId: query.deviceId, limit: query.limit, offset: query.offset },
    })
  }
}
