import type { HttpClient } from '../http.js'
import type {
  SendNotificationParams,
  SendNotificationResult,
  Upload,
  UploadMediaResult,
} from '../types.js'
import { toBlob } from '../upload.js'

/** `POST /messages/send` and `POST /messages/media`. Scope `notification`. */
export class NotificationsService {
  constructor(private readonly http: HttpClient) {}

  /**
   * Send an approved account template from a MauKirim-managed number. `variables` must match the
   * template's placeholders exactly or the API refuses the request with `400 invalid_input`.
   */
  send(params: SendNotificationParams): Promise<SendNotificationResult> {
    const body: Record<string, unknown> = {
      phone: params.phone,
      templateId: params.templateId,
      variables: params.variables,
    }
    if (params.attachmentUploadId !== undefined) body.attachmentUploadId = params.attachmentUploadId

    return this.http.request<SendNotificationResult>({
      method: 'POST',
      path: '/messages/send',
      body,
      idempotencyKey: params.idempotencyKey,
      requireIdempotencyKey: true,
    })
  }

  /**
   * Store a private attachment for a per-send template. The upload expires after seven days unless a
   * queued send still references it.
   */
  uploadMedia(upload: Upload): Promise<UploadMediaResult> {
    const form = new FormData()
    form.set('file', toBlob(upload), upload.fileName)
    return this.http.request<UploadMediaResult>({ method: 'POST', path: '/messages/media', form })
  }
}
