import type { HttpClient } from '../http.js'
import type {
  DeviceDetailResult,
  DeviceListResult,
  PresenceType,
  SendMessageParams,
  SendMessageResult,
  SetChatPresenceParams,
  SetChatPresenceResult,
  SetPresenceResult,
  SetProfileParams,
  Upload,
} from '../types.js'
import { toBlob } from '../upload.js'

/** Rented numbers: read, brand, set presence, and send. Scopes `read`, `device`, `send`. */
export class DevicesService {
  constructor(private readonly http: HttpClient) {}

  /** Every rental on the account, newest first. `number` is masked unless the rental is usable. */
  list(): Promise<DeviceListResult> {
    return this.http.request<DeviceListResult>({ method: 'GET', path: '/devices' })
  }

  /** One device with its rental terms and webhook settings. Reachable only for active rentals. */
  get(deviceId: string): Promise<DeviceDetailResult> {
    return this.http.request<DeviceDetailResult>({ method: 'GET', path: `/devices/${deviceId}` })
  }

  /** Set the WhatsApp display name customers see. 1–64 characters. */
  setProfile(deviceId: string, params: SetProfileParams): Promise<{ ok: true; pushName: string }> {
    return this.http.request({ method: 'PATCH', path: `/devices/${deviceId}/profile`, body: params })
  }

  /** Replace the profile photo. JPEG or PNG, at most 5 MiB, bytes checked against the declared type. */
  uploadAvatar(deviceId: string, upload: Upload): Promise<{ ok: true; hasAvatar: true }> {
    const form = new FormData()
    form.set('avatar', toBlob(upload), upload.fileName)
    return this.http.request({ method: 'PATCH', path: `/devices/${deviceId}/profile`, form })
  }

  /** Set WhatsApp's online indicator for the number. Nothing is stored server-side. */
  setPresence(deviceId: string, type: PresenceType): Promise<SetPresenceResult> {
    return this.http.request<SetPresenceResult>({
      method: 'POST',
      path: `/devices/${deviceId}/presence`,
      body: { type },
    })
  }

  /** Show or clear the typing indicator in one recipient chat. */
  setChatPresence(deviceId: string, params: SetChatPresenceParams): Promise<SetChatPresenceResult> {
    return this.http.request<SetChatPresenceResult>({
      method: 'POST',
      path: `/devices/${deviceId}/chat-presence`,
      body: params,
    })
  }

  /** Send free-form text (up to 4096 characters) from the rented number. */
  sendMessage(deviceId: string, params: SendMessageParams): Promise<SendMessageResult> {
    return this.http.request<SendMessageResult>({
      method: 'POST',
      path: `/devices/${deviceId}/messages`,
      body: { phone: params.phone, message: params.message },
      idempotencyKey: params.idempotencyKey,
      requireIdempotencyKey: true,
    })
  }

  /**
   * Send an image (≤5 MiB) or document (≤16 MiB) from the rented number. The filename you pass is the
   * filename the recipient reads; the caption is sent only when non-empty.
   */
  sendMedia(
    deviceId: string,
    params: Upload & { phone: string; caption?: string; idempotencyKey: string },
  ): Promise<SendMessageResult> {
    const form = new FormData()
    form.set('file', toBlob(params), params.fileName)
    form.set('phone', params.phone)
    if (params.caption) form.set('caption', params.caption)
    return this.http.request<SendMessageResult>({
      method: 'POST',
      path: `/devices/${deviceId}/messages`,
      form,
      idempotencyKey: params.idempotencyKey,
      requireIdempotencyKey: true,
    })
  }
}
