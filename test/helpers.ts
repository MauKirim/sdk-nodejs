import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface RecordedRequest {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

export interface TestServer {
  baseUrl: string
  requests: RecordedRequest[]
  close: () => Promise<void>
}

/**
 * Start a real HTTP server on an ephemeral port. Tests exercise the SDK over a socket rather than
 * mocking `fetch`, so header, body and retry behaviour are observed end to end.
 */
export async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse, n: number) => void,
): Promise<TestServer> {
  const requests: RecordedRequest[] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks),
      })
      handler(req, res, requests.length)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}/api/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  }
}

export function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}
