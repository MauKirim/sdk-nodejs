# maukirim — Official Node.js SDK

[![npm](https://img.shields.io/npm/v/maukirim.svg)](https://www.npmjs.com/package/maukirim)
[![CI](https://github.com/MauKirim/sdk-nodejs/actions/workflows/ci.yml/badge.svg)](https://github.com/MauKirim/sdk-nodejs/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/maukirim.svg)](https://nodejs.org)

Official Node.js and TypeScript SDK for **[MauKirim](https://maukirim.com)** — the managed WhatsApp gateway.
Send **OTP codes**, send **templated notifications** from a shared number, and rent and operate
**dedicated WhatsApp numbers** over a REST API, without running your own WhatsApp infrastructure.

- Zero runtime dependencies: uses the global `fetch` and `node:crypto`.
- Full TypeScript types for every request and response field.
- ESM and CommonJS builds, Node 18+.
- Built-in retries with idempotency-key preservation, timeouts, and typed errors that carry the API's
  machine-readable `code`.
- Webhook signature verification (HMAC-SHA256, constant-time).

[MauKirim](https://maukirim.com) · [API documentation](https://app.maukirim.com/docs) · [Dashboard](https://app.maukirim.com)

---

## Install

```bash
npm install maukirim
```

```bash
pnpm add maukirim
yarn add maukirim
```

## Quickstart

Create an API key in the dashboard under **Developer → API keys**. Keys are scoped, so grant each service
only what it needs. The value (`mk_live_…`) is shown **once**.

```ts
import { MauKirim } from 'maukirim'

const maukirim = new MauKirim({ apiKey: process.env.MAUKIRIM_API_KEY! })
```

### Send and verify an OTP

MauKirim generates the six-digit code, stores only a hash, and delivers it over WhatsApp. Reuse the *same*
idempotency key to retry safely; a different body with the same key is refused with `409`.

```ts
// 1. Ask for a code for this signup session.
const { challengeId, expiresAt } = await maukirim.otp.send({
  phone: '+6281234567890',
  purpose: 'signup',                     // login | signup | payment | passwordReset | phoneChange
  idempotencyKey: `signup-${sessionId}`, // required, 1-128 chars, unique per business event
})

// 2. Check what the user typed. A wrong code is NOT an error: it is 200 with verified: false.
const { verified } = await maukirim.otp.verify({ challengeId, code: '481902' })
if (!verified) throw new Error('That code is not right')
```

A wrong guess consumes one of the challenge's five attempts; the code lives five minutes and issuing is
limited to five per hour per phone number. Do not resend on a timer — let the user ask.

### Send a notification

Notifications are **template-bound**: an operator approves a template for your account, and each send names
it. `variables` must match the template's placeholders exactly — same names, same count.

```ts
const { batchId } = await maukirim.notifications.send({
  phone: '+6281234567890',
  templateId: 'tpl_9x',
  variables: { name: 'Rizky', order: '8821' },
  idempotencyKey: 'order-8821-shipped',
})
```

A template with a repeat block (`{{#items}}…{{/items}}`) takes an array instead of a string. That is **one
message and one charge**:

```ts
await maukirim.notifications.send({
  phone: '+6281234567890',
  templateId: 'tpl_9x',
  variables: {
    order: '8821',
    items: [
      { name: 'Kopi luwak', quantity: '2' },
      { name: 'Teh botol', quantity: '3' },
    ],
  },
  idempotencyKey: 'order-8821',
})
```

For a template approved for **per-send attachments**, upload the file first and pass its id:

```ts
const { media } = await maukirim.notifications.uploadMedia({
  data: await fs.readFile('invoice-8821.pdf'),
  fileName: 'Invoice-8821.pdf',
  contentType: 'application/pdf',
})

await maukirim.notifications.send({
  phone: '+6281234567890',
  templateId: 'tpl_invoice',
  variables: { order: '8821' },
  attachmentUploadId: media.id,
  idempotencyKey: 'invoice-8821',
})
```

Uploads expire after seven days unless a queued send still references them.

### Rent and operate a number

```ts
const { devices } = await maukirim.devices.list()
const device = devices.find((d) => d.status === 'active')
if (!device) throw new Error('No active rental')
```

A rental that is paid for is not the same as a number that is answering — wait until
`connection.isConnected` and `connection.isLoggedIn` are both `true`.

```ts
// Branding
await maukirim.devices.setProfile(device.id, { pushName: 'Studio Support' })
await maukirim.devices.uploadAvatar(device.id, {
  data: await fs.readFile('logo.png'),
  fileName: 'logo.png',
  contentType: 'image/png',
})

// Presence: WhatsApp's online indicator for the number
await maukirim.devices.setPresence(device.id, 'available')

// Free-form text (this is what to use when the content depends on what the customer wrote)
const { created, batchId } = await maukirim.devices.sendMessage(device.id, {
  phone: '+6281234567890',
  message: 'Your order is on the way.',
  idempotencyKey: 'reply-8821-1',
})
// created === false means the key replayed an identical request; no second message was sent.
```

Send an image or a document with `sendMedia`. An image renders inline with its caption; a document arrives
under **the filename you pass**, so send `Invoice-8821.pdf`, not `upload.pdf`.

```ts
await maukirim.devices.sendMedia(device.id, {
  data: await fs.readFile('Invoice-8821.pdf'),
  fileName: 'Invoice-8821.pdf',
  contentType: 'application/pdf',
  phone: '+6281234567890',
  caption: 'Your invoice',
  idempotencyKey: 'invoice-8821-1',
})

// Show typing in one chat while you compose, then clear it after the send is accepted.
await maukirim.devices.setChatPresence(device.id, { phone: '+6281234567890', action: 'start' })
```

### Receive events: webhooks

Point the number's events at your endpoint once. The signing `secret` is returned **only** by the call that
creates the destination (or by a deliberate rotation) — store it immediately.

```ts
const { webhook, secret } = await maukirim.webhooks.set(device.id, {
  url: 'https://api.your-app.com/hooks/maukirim',
  events: ['message', 'message.ack'], // omit or leave empty for every event
})
```

Then verify every delivery over the **raw** request body, before any JSON parsing:

```ts
import { verifyWebhookSignature } from 'maukirim'
import { readRawBody } from './your-framework'

app.post('/hooks/maukirim', async (req, res) => {
  const raw = await readRawBody(req) // the exact bytes, not a re-serialized object
  if (!verifyWebhookSignature(raw, req.headers['x-maukirim-signature'], process.env.MAUKIRIM_WEBHOOK_SECRET!)) {
    return res.status(401).end()
  }

  const { event, delivery_id, payload } = JSON.parse(raw.toString())
  if (await alreadyProcessed(delivery_id)) return res.status(200).end() // at-least-once: dedupe on delivery_id

  await handleEvent(event, payload)
  res.status(200).end() // any 2xx counts as delivered; a 3xx is a failure
})
```

Deliveries retry up to five times with backoff, reuse the same `x-maukirim-delivery` id, and give up after
10 seconds per attempt. Inspect what was forwarded and what your endpoint answered:

```ts
const { deliveries, hasMore } = await maukirim.webhooks.deliveries({ deviceId: device.id, limit: 25 })
```

```ts
// Rotate the secret when it may have leaked; the old one stops verifying immediately.
const { secret: freshSecret } = await maukirim.webhooks.rotate(device.id)

await maukirim.webhooks.remove(device.id) // stop forwarding and delete the destination + its log
```

## Errors and retries

Every failure raises a `MauKirimError` carrying the HTTP `status` and the API's machine-readable `code`:

```ts
import { MauKirimError } from 'maukirim'

try {
  await maukirim.devices.list()
} catch (error) {
  if (error instanceof MauKirimError) {
    console.error(error.status, error.code) // e.g. 403 'api_key_scope_denied'
    if (error.retryable) scheduleRetry()
  }
}
```

| `code` | Status | Meaning |
| --- | --- | --- |
| `api_key_invalid` / `api_key_revoked` / `api_key_expired` | 401 | The key is wrong, revoked or past its expiry |
| `api_key_scope_denied` | 403 | The key lacks the scope this route requires |
| `forbidden` | 403 | The account is missing or not active |
| `invalid_input` | 400 | A field is missing or malformed, or the variables do not match the template |
| `insufficient_credits` | 402 | Balance below this message's cost |
| `rental_not_found` | 404 | Not rented by this account — also returned for a device that does not exist |
| `batch_idempotency_conflict` | 409 | The same `Idempotency-Key` was reused with a different body |
| `device_not_connected` | 409 | No sending number is ready right now |
| `media_unavailable` | 410 | The media id is unknown, expired (7 days), or owned by another account |
| `rate_limited` | 429 | More than five OTP issues to that number in an hour |
| `worker_offline` | 503 | Dispatch worker has no fresh heartbeat — transient |
| `server_error` | 500 | Unexpected — record it and contact support |

The transport already retries retryable failures (5xx, 429, 408, 425) up to `maxRetries` times, **reusing the
same Idempotency-Key**. Configure it:

```ts
const maukirim = new MauKirim({
  apiKey: process.env.MAUKIRIM_API_KEY!,
  maxRetries: 3,               // default 2
  timeoutMs: 15_000,           // default 30_000; 0 disables
  baseUrl: 'https://app.maukirim.com/api/v1', // default
})
```

Retry policy, from the API's own documentation: `503 worker_offline`, timeouts and `502` are safe to retry
with the same key; `500` is safe once; `429` means back off and try later; `402` means top up first;
`409 batch_idempotency_conflict` means you reused a key with a different body and must not retry as-is.

## API reference

| Method | Route | Scope |
| --- | --- | --- |
| `otp.send({ phone, purpose, idempotencyKey })` | `POST /otp/send` | `otp` |
| `otp.verify({ challengeId, code })` | `POST /otp/verify` | `otp` |
| `notifications.send({ phone, templateId, variables, attachmentUploadId?, idempotencyKey })` | `POST /messages/send` | `notification` |
| `notifications.uploadMedia({ data, fileName, contentType })` | `POST /messages/media` | `notification` |
| `devices.list()` | `GET /devices` | `read` |
| `devices.get(id)` | `GET /devices/{id}` | `read` |
| `devices.setProfile(id, { pushName })` | `PATCH /devices/{id}/profile` | `device` |
| `devices.uploadAvatar(id, { data, fileName, contentType })` | `PATCH /devices/{id}/profile` | `device` |
| `devices.setPresence(id, 'available' \| 'unavailable')` | `POST /devices/{id}/presence` | `device` |
| `devices.setChatPresence(id, { phone, action })` | `POST /devices/{id}/chat-presence` | `device` |
| `devices.sendMessage(id, { phone, message, idempotencyKey })` | `POST /devices/{id}/messages` | `send` |
| `devices.sendMedia(id, { data, fileName, contentType, phone, caption?, idempotencyKey })` | `POST /devices/{id}/messages` | `send` |
| `webhooks.get(id)` | `GET /devices/{id}/webhook` | `webhook` |
| `webhooks.set(id, { url, events?, active? })` | `POST /devices/{id}/webhook` | `webhook` |
| `webhooks.rotate(id)` | `PUT /devices/{id}/webhook` | `webhook` |
| `webhooks.remove(id)` | `DELETE /devices/{id}/webhook` | `webhook` |
| `webhooks.deliveries({ deviceId?, limit?, offset? })` | `GET /webhook-deliveries` | `webhook` |

Every request goes to `https://app.maukirim.com/api/v1` and authenticates with
`Authorization: Bearer mk_live_…`.

## Development

```bash
npm install
npm test          # vitest, against a real ephemeral HTTP server — no network, no mocks of the SDK
npm run typecheck # tsc --noEmit
npm run build     # tsup -> dist/index.js (ESM), dist/index.cjs (CJS), dist/index.d.ts
```

## Publishing

The package is published to the public npm registry as `maukirim`.

1. **One-time setup.** Create/claim the `maukirim` package name on [npmjs.com](https://www.npmjs.com/), and add
   an automation token as the `NPM_TOKEN` repository secret (or log in with `npm login`).
2. **Version.** Follow semver: `npm version patch|minor|major`, which commits the bump and creates the tag.
3. **Verify, then publish.**
   ```bash
   npm run build && npm test
   npm publish --access public
   ```
   `prepublishOnly` re-runs the build and the suite, so a broken artifact cannot be published.
4. **Tag and release.**
   ```bash
   git push --follow-tags origin main
   gh release create "v$(node -p "require('./package.json').version")" --generate-notes
   ```
5. **Continuous publishing (optional).** Add a workflow on `release: [published]` that runs
   `npm ci && npm publish --provenance --access public` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`.

## License

[MIT](./LICENSE) © MauKirim
