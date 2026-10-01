import type { Upload } from './types.js'

/**
 * Wrap upload bytes in a `Blob` so `fetch` streams them with the caller's content type.
 * A `Blob` is passed through untouched.
 */
export function toBlob(upload: Upload): Blob {
  if (upload.data instanceof Blob) return upload.data
  // Cast justified: both Uint8Array and ArrayBuffer are valid BlobParts at runtime, but TS 5.7 types
  // Uint8Array over the ArrayBufferLike union, which BlobPart rejects. A cast here avoids copying bytes.
  return new Blob([upload.data as BlobPart], upload.contentType ? { type: upload.contentType } : undefined)
}
