/** Purpose recorded with an OTP challenge. */
export type OtpPurpose = 'login' | 'signup' | 'payment' | 'passwordReset' | 'phoneChange'

export interface SendOtpParams {
  /** Recipient in E.164. Spaces, dots, dashes and parentheses are stripped server-side. */
  phone: string
  purpose: OtpPurpose
  /** Required. Reuse the same value to retry safely; a different body with the same value is 409. */
  idempotencyKey: string
}

export interface SendOtpResult {
  ok: true
  challengeId: string
  batchId: string
  /** ISO-8601. The six-digit code lives five minutes. */
  expiresAt: string
}

export interface VerifyOtpParams {
  challengeId: string
  /** Six digits. */
  code: string
}

export interface VerifyOtpResult {
  ok: true
  /**
   * A wrong, expired, already-used, out-of-attempts or undelivered code answers `false` with HTTP 200 —
   * the question was answered. Only malformed input or an unknown challenge is an error.
   */
  verified: boolean
}

/** A scalar placeholder value, or an array of item objects for a `{{#section}}` block. */
export type NotificationVariables = Record<string, string | Array<Record<string, string>>>

export interface SendNotificationParams {
  phone: string
  templateId: string
  /** Keys must equal the template's top-level placeholder names exactly. */
  variables: NotificationVariables
  /** `media.id` from {@link NotificationsService.uploadMedia}; only for per-send templates. */
  attachmentUploadId?: string
  idempotencyKey: string
}

export interface SendNotificationResult {
  ok: true
  batchId: string
}

export interface UploadedMedia {
  id: string
  contentType: string
  byteSize: number
  fileName: string | null
  kind: 'image' | 'file'
  expiresAt: string
}

export interface UploadMediaResult {
  ok: true
  media: UploadedMedia
}

export type RentalStatus = 'pending_payment' | 'active' | 'past_due' | 'suspended' | 'cancelled' | 'expired'

export interface DeviceConnection {
  state: string | null
  isConnected: boolean | null
  isLoggedIn: boolean | null
  missingSince: string | null
}

export interface Device {
  id: string
  label: string | null
  /** Full `+`E.164 while the rental is usable; a masked form otherwise. */
  number: string
  plan: string | null
  status: RentalStatus
  term: string | null
  currency: string | null
  priceMinor: number | null
  autoRenew: boolean
  currentPeriodEnd: string | null
  pushName: string | null
  hasAvatar: boolean
  connection: DeviceConnection | null
}

export interface DeviceListResult {
  ok: true
  devices: Device[]
}

export interface DeviceDetailResult {
  ok: true
  device: Device
  rental: Record<string, unknown>
  webhook: WebhookSettings | null
}

export interface SetProfileParams {
  /** 1–64 characters. */
  pushName: string
}

export type PresenceType = 'available' | 'unavailable'

export interface SetPresenceResult {
  ok: true
  type: PresenceType
}

export type ChatPresenceAction = 'start' | 'stop'

export interface SetChatPresenceParams {
  phone: string
  action: ChatPresenceAction
}

export interface SetChatPresenceResult {
  ok: true
  action: ChatPresenceAction
}

export interface SendMessageParams {
  phone: string
  /** Up to 4096 characters. */
  message: string
  idempotencyKey: string
}

export interface ProgressCounts {
  queued: number
  sending: number
  accepted: number
  failed: number
  uncertain: number
  cancelled: number
}

export interface ProgressItem {
  id: string
  recipient: string
  kind: string
  sendState: string
  deliveryState: string | null
  attempts: number
  messageId: string | null
  errorCode: string | null
  completedAt: string | null
}

export interface Progress {
  batchId: string
  total: number
  counts: ProgressCounts
  terminal: boolean
  items: ProgressItem[]
}

export interface SendMessageResult {
  ok: true
  batchId: string
  /** `false` when the Idempotency-Key replayed an identical request. */
  created: boolean
  media?: { id: string }
  progress?: Progress
}

export interface SetWebhookParams {
  /** `https` only, public host, no credentials/query/fragment/IP literal/localhost. */
  url: string
  /** Empty means every event. */
  events?: string[]
  active?: boolean
}

export interface WebhookSettings {
  id: string
  deviceId: string
  url: string
  events: string[]
  active: boolean
}

export interface WebhookResult {
  ok: true
  webhook: WebhookSettings
  /** 64 hex characters. Returned only by the call that created the destination and by rotation. */
  secret?: string
}

export interface WebhookInfoResult {
  ok: true
  webhook: WebhookSettings | null
  availableEvents: string[]
  gatewayWired: boolean
}

export interface RemoveWebhookResult {
  ok: true
  removed: true
}

export type DeliveryState = 'queued' | 'failed' | 'delivered' | 'exhausted'

export type DeliveryErrorCode =
  | 'endpoint_unreachable'
  | 'endpoint_rejected'
  | 'webhook_inactive'
  | 'webhook_secret_unreadable'

export interface Delivery {
  id: string
  deviceId: string
  event: string
  state: DeliveryState
  attempts: number
  responseStatus: number | null
  errorCode: DeliveryErrorCode | null
  payload: unknown
  createdAt: string
  completedAt: string | null
}

export interface DeliveryPage {
  ok: true
  deliveries: Delivery[]
  hasMore: boolean
}

export interface DeliveryQuery {
  deviceId?: string
  /** Clamped to 1–100 by the API; omitted means 25. */
  limit?: number
  /** Negative values are treated as 0. */
  offset?: number
}

/** An image or document to upload. */
export interface Upload {
  data: Uint8Array | ArrayBuffer | Blob
  fileName: string
  contentType?: string
}
