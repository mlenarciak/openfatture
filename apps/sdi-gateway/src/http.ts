import { createServer, type IncomingMessage } from 'node:http';
import { faultResponse } from './gateway.js';
import { GatewayError, MAX_WIRE_BYTES, type GatewayRequest, type GatewayResponse, type TrustedPeer } from './types.js';
export function albPeer(request: IncomingMessage, proxyMode?: string): TrustedPeer | undefined {
  // This adapter is only safe behind an ALB VERIFY listener and a task security group reachable exclusively from that ALB.
  // The core never reads forwarded headers. Lambda uses its own API Gateway clientCert context instead.
  if (proxyMode !== 'alb') return undefined;
  const value = request.headers['x-amzn-mtls-clientcert-leaf'];
  if (typeof value !== 'string' || value.length > 32 * 1024) return undefined;
  try { return { certificatePem: decodeURIComponent(value), verifiedByIngress: true }; } catch { return undefined; }
}
export function createHttpServer(gateway: (request: GatewayRequest) => Promise<GatewayResponse>, options: { proxyMode?: string; authorizePeer: (peer?: TrustedPeer) => unknown; maxConcurrent?: number }) {
  const maximum = options.maxConcurrent ?? 4;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 16) throw new Error('SDI_MAX_CONCURRENT must be an integer between 1 and 16');
  let active = 0;
  const server = createServer({ maxHeaderSize: 48 * 1024, requestTimeout: 60_000, headersTimeout: 15_000, keepAliveTimeout: 5_000 }, async (request, response) => {
    const send = (result: GatewayResponse) => { if (!response.destroyed && !response.headersSent) { response.writeHead(result.statusCode, { ...result.headers, ...(result.statusCode >= 400 ? { connection: 'close' } : {}), 'content-length': Buffer.byteLength(result.body) }); response.end(result.body); } };
    const path = (request.url ?? '').split('?')[0]!;
    if (request.method === 'GET' && path === '/health') { send(await gateway({ method: 'GET', path, headers: {}, body: Buffer.alloc(0) })); request.resume(); return; }
    if (!/^\/test\/(RicezioneFatture|TrasmissioneFatture)$/.test(path)) { send(faultResponse(new GatewayError(path.startsWith('/prod') ? 503 : 404, 'Client', 'Production and unconfigured endpoints are disabled'))); request.resume(); return; }
    if (active >= maximum) { send(faultResponse(new GatewayError(503, 'Server', 'Test receiver is busy; retry later'))); request.resume(); return; }
    active += 1;
    try {
      if (request.method !== 'POST') throw new GatewayError(405, 'Client', 'POST is required');
      const peer = albPeer(request, options.proxyMode); options.authorizePeer(peer);
      const headers: Record<string, string | undefined> = {};
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index]!.toLowerCase();
        if (Object.hasOwn(headers, name)) throw new GatewayError(400, 'Client', 'Duplicate HTTP header'); headers[name] = request.rawHeaders[index + 1];
      }
      const declared = headers['content-length']; if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_WIRE_BYTES)) throw new GatewayError(413, 'Client', 'SOAP payload exceeds the supported limit');
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); bytes += buffer.length;
        if (bytes > MAX_WIRE_BYTES) throw new GatewayError(413, 'Client', 'SOAP payload exceeds the supported limit'); chunks.push(buffer);
      }
      send(await gateway({ method: request.method ?? '', path, headers, body: Buffer.concat(chunks, bytes), peer }));
    } catch (error) {
      send(faultResponse(error instanceof GatewayError ? error : new GatewayError(500, 'Server', 'Receipt could not be completed; retry later')));
      request.resume();
    } finally { active -= 1; }
  });
  return server;
}
