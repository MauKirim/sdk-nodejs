import { afterEach, describe, expect, it } from 'vitest'
import { MauKirim } from '../src/client.js'
import { json, startServer, type TestServer } from './helpers.js'

let server: TestServer | undefined

afterEach(async () => {
  await server?.close()
  server = undefined
})

async function withClient(
  handler: Parameters<typeof startServer>[0],
  run: (client: MauKirim) => Promise<void>,
): Promise<void> {
  server = await startServer(handler)
  await run(new MauKirim({ apiKey: 'mk_live_test', baseUrl: server.baseUrl, maxRetries: 0 }))
}

describe('MauKirim', () => {
  it('exposes the four service namespaces', async () => {
    server = await startServer((_req, res) => json(res, 200, { ok: true }))
    const client = new MauKirim({ apiKey: 'k', baseUrl: server.baseUrl })
    expect(client.otp).toBeDefined()
    expect(client.notifications).toBeDefined()
    expect(client.devices).toBeDefined()
    expect(client.webhooks).toBeDefined()
  })

  it('requires an API key', () => {
    expect(() => new MauKirim({ apiKey: '' })).toThrowError(/API key/)
  })
})

describe('otp', () => {
  const challenge = { ok: true, challengeId: 'otp_1', batchId: 'gwb_1', expiresAt: '2026-09-28T13:20:00.000Z' }

  it('issues an OTP with the required Idempotency-Key', async () => {
    await withClient(
      (_req, res) => json(res, 200, challenge),
      async (client) => {
        const result = await client.otp.send({
          phone: '+6281234567890',
          purpose: 'signup',
          idempotencyKey: 'signup-8821',
        })
        expect(result.challengeId).toBe('otp_1')

        const req = server?.requests[0]
        expect(req?.method).toBe('POST')
        expect(req?.url).toBe('/api/v1/otp/send')
        expect(req?.headers['idempotency-key']).toBe('signup-8821')
        expect(JSON.parse(String(req?.body))).toEqual({ phone: '+6281234567890', purpose: 'signup' })
      },
    )
  })

  it('refuses to issue an OTP without an Idempotency-Key, without calling the API', async () => {
    await withClient(
      (_req, res) => json(res, 200, challenge),
      async (client) => {
        await expect(
          client.otp.send({ phone: '+6281', purpose: 'login', idempotencyKey: '' }),
        ).rejects.toThrowError(/Idempotency-Key/)
        expect(server?.requests).toHaveLength(0)
      },
    )
  })

  it('verifies a code and returns the verdict, without an Idempotency-Key', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, verified: false }),
      async (client) => {
        const result = await client.otp.verify({ challengeId: 'otp_1', code: '481902' })
        expect(result.verified).toBe(false)

        const req = server?.requests[0]
        expect(req?.method).toBe('POST')
        expect(req?.url).toBe('/api/v1/otp/verify')
        expect(req?.headers['idempotency-key']).toBeUndefined()
        expect(JSON.parse(String(req?.body))).toEqual({ challengeId: 'otp_1', code: '481902' })
      },
    )
  })
})

describe('notifications', () => {
  it('sends a templated notification with scalar variables', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, batchId: 'gwb_9' }),
      async (client) => {
        const result = await client.notifications.send({
          phone: '+6281234567890',
          templateId: 'tpl_9x',
          variables: { order: '8821', name: 'Rizky' },
          idempotencyKey: 'order-8821-shipped',
        })
        expect(result.batchId).toBe('gwb_9')

        const req = server?.requests[0]
        expect(req?.url).toBe('/api/v1/messages/send')
        expect(req?.headers['idempotency-key']).toBe('order-8821-shipped')
        expect(JSON.parse(String(req?.body))).toEqual({
          phone: '+6281234567890',
          templateId: 'tpl_9x',
          variables: { order: '8821', name: 'Rizky' },
        })
      },
    )
  })

  it('sends a list-section notification and includes attachmentUploadId only when given', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, batchId: 'gwb_9' }),
      async (client) => {
        await client.notifications.send({
          phone: '+6281',
          templateId: 'tpl_1',
          variables: { order: '8821', items: [{ name: 'Kopi', quantity: '2' }] },
          attachmentUploadId: 'gwm_1',
          idempotencyKey: 'order-8821',
        })
        expect(JSON.parse(String(server?.requests[0]?.body))).toEqual({
          phone: '+6281',
          templateId: 'tpl_1',
          variables: { order: '8821', items: [{ name: 'Kopi', quantity: '2' }] },
          attachmentUploadId: 'gwm_1',
        })

        await client.notifications.send({
          phone: '+6281',
          templateId: 'tpl_1',
          variables: { order: '8822' },
          idempotencyKey: 'order-8822',
        })
        expect(JSON.parse(String(server?.requests[1]?.body))).not.toHaveProperty('attachmentUploadId')
      },
    )
  })

  it('uploads a per-send attachment as multipart and returns the media id', async () => {
    await withClient(
      (_req, res) =>
        json(res, 200, {
          ok: true,
          media: {
            id: 'gwm_1',
            contentType: 'application/pdf',
            byteSize: 3,
            fileName: 'invoice.pdf',
            kind: 'file',
            expiresAt: '2026-10-06T00:00:00.000Z',
          },
        }),
      async (client) => {
        const result = await client.notifications.uploadMedia({
          data: new Uint8Array([1, 2, 3]),
          fileName: 'invoice.pdf',
          contentType: 'application/pdf',
        })
        expect(result.media.id).toBe('gwm_1')

        const req = server?.requests[0]
        expect(req?.method).toBe('POST')
        expect(req?.url).toBe('/api/v1/messages/media')
        expect(String(req?.headers['content-type'])).toMatch(/^multipart\/form-data; boundary=/)
        expect(String(req?.body)).toContain('filename="invoice.pdf"')
      },
    )
  })
})

describe('devices', () => {
  it('lists rented numbers', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, devices: [{ id: 'gwd_1', number: '+6281234567890' }] }),
      async (client) => {
        const result = await client.devices.list()
        expect(result.devices).toHaveLength(1)
        expect(server?.requests[0]?.method).toBe('GET')
        expect(server?.requests[0]?.url).toBe('/api/v1/devices')
      },
    )
  })

  it('reads one device with its rental and webhook settings', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, device: { id: 'gwd_1' }, rental: {}, webhook: null }),
      async (client) => {
        const result = await client.devices.get('gwd_1')
        expect(result.webhook).toBeNull()
        expect(server?.requests[0]?.url).toBe('/api/v1/devices/gwd_1')
      },
    )
  })

  it('sets the display name', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, pushName: 'Studio Support' }),
      async (client) => {
        await client.devices.setProfile('gwd_1', { pushName: 'Studio Support' })
        const req = server?.requests[0]
        expect(req?.method).toBe('PATCH')
        expect(req?.url).toBe('/api/v1/devices/gwd_1/profile')
        expect(JSON.parse(String(req?.body))).toEqual({ pushName: 'Studio Support' })
      },
    )
  })

  it('replaces the profile photo as multipart', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, hasAvatar: true }),
      async (client) => {
        await client.devices.uploadAvatar('gwd_1', {
          data: new Uint8Array([137, 80, 78, 71]),
          fileName: 'logo.png',
          contentType: 'image/png',
        })
        const req = server?.requests[0]
        expect(req?.method).toBe('PATCH')
        expect(req?.url).toBe('/api/v1/devices/gwd_1/profile')
        expect(String(req?.body)).toContain('name="avatar"')
        expect(String(req?.body)).toContain('filename="logo.png"')
      },
    )
  })

  it('sets presence', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, type: 'available' }),
      async (client) => {
        await client.devices.setPresence('gwd_1', 'available')
        const req = server?.requests[0]
        expect(req?.url).toBe('/api/v1/devices/gwd_1/presence')
        expect(JSON.parse(String(req?.body))).toEqual({ type: 'available' })
      },
    )
  })

  it('starts and stops typing in a chat', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, action: 'start' }),
      async (client) => {
        await client.devices.setChatPresence('gwd_1', { phone: '+6281234567890', action: 'start' })
        const req = server?.requests[0]
        expect(req?.url).toBe('/api/v1/devices/gwd_1/chat-presence')
        expect(JSON.parse(String(req?.body))).toEqual({ phone: '+6281234567890', action: 'start' })
        expect(req?.headers['idempotency-key']).toBeUndefined()
      },
    )
  })

  it('sends free-form text from the rented number with an Idempotency-Key', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, batchId: 'gwb_1', created: true }),
      async (client) => {
        const result = await client.devices.sendMessage('gwd_1', {
          phone: '+6281234567890',
          message: 'Your order is on the way.',
          idempotencyKey: 'reply-8821-1',
        })
        expect(result.created).toBe(true)

        const req = server?.requests[0]
        expect(req?.url).toBe('/api/v1/devices/gwd_1/messages')
        expect(req?.headers['idempotency-key']).toBe('reply-8821-1')
        expect(JSON.parse(String(req?.body))).toEqual({
          phone: '+6281234567890',
          message: 'Your order is on the way.',
        })
      },
    )
  })

  it('sends media from the rented number as multipart, caption only when non-empty', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, batchId: 'gwb_1', created: true, media: { id: 'gwm_2' } }),
      async (client) => {
        const result = await client.devices.sendMedia('gwd_1', {
          data: new Uint8Array([1, 2, 3]),
          fileName: 'Invoice-8821.pdf',
          contentType: 'application/pdf',
          phone: '+6281234567890',
          caption: 'Your invoice',
          idempotencyKey: 'invoice-8821-1',
        })
        expect(result.media?.id).toBe('gwm_2')

        const req = server?.requests[0]
        expect(req?.headers['idempotency-key']).toBe('invoice-8821-1')
        const body = String(req?.body)
        expect(body).toContain('name="file"')
        expect(body).toContain('filename="Invoice-8821.pdf"')
        expect(body).toContain('Your invoice')

        await client.devices.sendMedia('gwd_1', {
          data: new Uint8Array([1]),
          fileName: 'a.png',
          contentType: 'image/png',
          phone: '+6281234567890',
          idempotencyKey: 'img-1',
        })
        expect(String(server?.requests[1]?.body)).not.toContain('name="caption"')
      },
    )
  })

  it('marks a replayed device send as not created', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, batchId: 'gwb_1', created: false }),
      async (client) => {
        const result = await client.devices.sendMessage('gwd_1', {
          phone: '+6281',
          message: 'hi',
          idempotencyKey: 'reply-1',
        })
        expect(result.created).toBe(false)
      },
    )
  })
})

describe('webhooks', () => {
  const settings = {
    id: 'rwh_1',
    deviceId: 'gwd_1',
    url: 'https://api.example.test/hooks/maukirim',
    events: ['message'],
    active: true,
  }

  it('reads the destination with available events', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, webhook: settings, availableEvents: ['message'], gatewayWired: true }),
      async (client) => {
        const result = await client.webhooks.get('gwd_1')
        expect(result.gatewayWired).toBe(true)
        expect(result.webhook).not.toHaveProperty('secret')
        expect(server?.requests[0]?.url).toBe('/api/v1/devices/gwd_1/webhook')
      },
    )
  })

  it('creates a destination and surfaces the once-only secret', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, webhook: settings, secret: 'ab'.repeat(32) }),
      async (client) => {
        const result = await client.webhooks.set('gwd_1', {
          url: 'https://api.example.test/hooks/maukirim',
          events: ['message', 'message.ack'],
        })
        expect(result.secret).toHaveLength(64)
        const req = server?.requests[0]
        expect(req?.method).toBe('POST')
        expect(JSON.parse(String(req?.body))).toEqual({
          url: 'https://api.example.test/hooks/maukirim',
          events: ['message', 'message.ack'],
        })
      },
    )
  })

  it('sends active:false when pausing, and omits undefined fields', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, webhook: { ...settings, active: false } }),
      async (client) => {
        await client.webhooks.set('gwd_1', { url: 'https://api.example.test/hooks', active: false })
        expect(JSON.parse(String(server?.requests[0]?.body))).toEqual({
          url: 'https://api.example.test/hooks',
          active: false,
        })
      },
    )
  })

  it('rotates the signing secret', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, webhook: settings, secret: 'cd'.repeat(32) }),
      async (client) => {
        const result = await client.webhooks.rotate('gwd_1')
        expect(result.secret).toHaveLength(64)
        expect(server?.requests[0]?.method).toBe('PUT')
        expect(server?.requests[0]?.url).toBe('/api/v1/devices/gwd_1/webhook')
      },
    )
  })

  it('removes the destination', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, removed: true }),
      async (client) => {
        const result = await client.webhooks.remove('gwd_1')
        expect(result.removed).toBe(true)
        expect(server?.requests[0]?.method).toBe('DELETE')
      },
    )
  })

  it('reads the delivery log with deviceId, limit and offset', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, deliveries: [{ id: 'whd_1', state: 'delivered' }], hasMore: true }),
      async (client) => {
        const result = await client.webhooks.deliveries({ deviceId: 'gwd_1', limit: 25, offset: 50 })
        expect(result.hasMore).toBe(true)
        expect(server?.requests[0]?.url).toBe('/api/v1/webhook-deliveries?deviceId=gwd_1&limit=25&offset=50')
      },
    )
  })

  it('reads the delivery log with no query at all', async () => {
    await withClient(
      (_req, res) => json(res, 200, { ok: true, deliveries: [], hasMore: false }),
      async (client) => {
        await client.webhooks.deliveries()
        expect(server?.requests[0]?.url).toBe('/api/v1/webhook-deliveries')
      },
    )
  })
})

describe('error propagation through services', () => {
  it('surfaces the API failure code from a service call', async () => {
    await withClient(
      (_req, res) => json(res, 403, { ok: false, code: 'api_key_scope_denied' }),
      async (client) => {
        const err = (await client.devices.list().catch((e: unknown) => e)) as { code?: string; status?: number }
        expect(err.code).toBe('api_key_scope_denied')
        expect(err.status).toBe(403)
      },
    )
  })
})
