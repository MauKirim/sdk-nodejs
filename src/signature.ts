import { createHmac, timingSafeEqual } from 'node:crypto'

/** The only signing algorithm MauKirim webhooks use. */
const SIGNATURE_PREFIX = 'sha256='
const HEX_64 = /^[0-9a-f]{64}$/i

/**
 * Verify the `x-maukirim-signature` header of a webhook delivery.
 *
 * The signature is the hex HMAC-SHA256 of the **raw** request body, keyed by the destination's
 * signing secret. Compute it over the bytes you received, before any JSON parsing or
 * re-serialization: re-encoding changes the bytes and the signature stops matching.
 *
 * @param rawBody          The exact bytes of the request body.
 * @param signatureHeader  The value of `x-maukirim-signature` (`sha256=<hex>`), or undefined.
 * @param secret           The webhook signing secret returned when the destination was created.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer | Uint8Array,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!secret || typeof signatureHeader !== 'string' || !signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return false
  }
  const provided = signatureHeader.slice(SIGNATURE_PREFIX.length)
  if (!HEX_64.test(provided)) {
    return false
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided.toLowerCase(), 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}
