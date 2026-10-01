import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyWebhookSignature } from '../src/signature.js'

const SECRET = '9f3c'.padEnd(64, 'a')
const BODY = JSON.stringify({ event: 'message', delivery_id: 'whd_1' })

function sign(body: string | Buffer, secret = SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

describe('verifyWebhookSignature', () => {
  it('accepts a signature produced with the same secret over the raw body', () => {
    expect(verifyWebhookSignature(BODY, sign(BODY), SECRET)).toBe(true)
  })

  it('accepts a Buffer raw body, since that is what a server reads', () => {
    expect(verifyWebhookSignature(Buffer.from(BODY, 'utf8'), sign(BODY), SECRET)).toBe(true)
  })

  it('rejects a body that changed by a single byte', () => {
    const tampered = BODY.replace('whd_1', 'whd_2')
    expect(verifyWebhookSignature(tampered, sign(BODY), SECRET)).toBe(false)
  })

  it('rejects a signature made with a different secret', () => {
    expect(verifyWebhookSignature(BODY, sign(BODY, 'other-secret'), SECRET)).toBe(false)
  })

  it('returns false when the header is missing or empty', () => {
    expect(verifyWebhookSignature(BODY, undefined, SECRET)).toBe(false)
    expect(verifyWebhookSignature(BODY, null, SECRET)).toBe(false)
    expect(verifyWebhookSignature(BODY, '', SECRET)).toBe(false)
  })

  it('returns false when the header is not a sha256= signature', () => {
    expect(verifyWebhookSignature(BODY, 'deadbeef', SECRET)).toBe(false)
    expect(verifyWebhookSignature(BODY, 'sha1=' + sign(BODY).slice(5), SECRET)).toBe(false)
  })

  it('returns false when the hex payload is truncated or non-hex', () => {
    expect(verifyWebhookSignature(BODY, sign(BODY).slice(0, -2), SECRET)).toBe(false)
    expect(verifyWebhookSignature(BODY, 'sha256=zzzz', SECRET)).toBe(false)
  })

  it('returns false when the secret itself is empty', () => {
    expect(verifyWebhookSignature(BODY, sign(BODY, ''), '')).toBe(false)
  })

  it('never throws on hostile input', () => {
    expect(() => verifyWebhookSignature(BODY, 'sha256=', SECRET)).not.toThrow()
    expect(() => verifyWebhookSignature(BODY, 'sha256=abc', SECRET)).not.toThrow()
  })
})
