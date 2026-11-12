import type { PutObjectCommand } from '@aws-sdk/client-s3';
import { once } from 'node:events';
import { request as httpRequest, type Server } from 'node:http';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGateway, createPeerVerifier } from '../src/gateway.js';
import { createHttpServer } from '../src/http.js';
import { lambdaAdapter } from '../src/lambda.js';
import { S3InboxStore } from '../src/s3-store.js';
import { MAX_WIRE_BYTES } from '../src/types.js';
import { MemoryInbox, peer, peerPin, request } from './fixtures.js';
const config = { providerContext: 'synthetic_provider', trustedPeerSha256: [peerPin] };
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });
async function start(options: { proxyMode?: string; maxConcurrent?: number } = {}) {
  const store = new MemoryInbox(); const server = createHttpServer(createGateway(store, config), { proxyMode: options.proxyMode ?? 'alb', authorizePeer: createPeerVerifier(config), maxConcurrent: options.maxConcurrent });
  servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address() as { port: number };
  return { server, store, port: address.port };
}
function post(port: number, headers: Record<string, string | string[]> = {}, path = '/test/RicezioneFatture') {
  const body = request().body;
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'POST', headers: { ...request().headers, 'content-length': body.length, ...headers } }, res => { const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString() })); }); req.on('error', reject); req.end(body);
  });
}
describe('ALB restricted-ingress HTTP adapter', () => {
  it('accepts the verified ALB leaf only in explicit proxy mode and rejects missing/duplicate/concatenated cert headers', async () => {
    const { port, store } = await start(); const certificateHeader = encodeURIComponent(peer);
    expect((await post(port, { 'x-amzn-mtls-clientcert-leaf': certificateHeader })).status).toBe(200); const count = store.objects.size;
    expect((await post(port)).status).toBe(403);
    expect((await post(port, { 'x-amzn-mtls-clientcert-leaf': [certificateHeader, certificateHeader] })).status).toBeGreaterThanOrEqual(400);
    expect((await post(port, { 'x-amzn-mtls-clientcert-leaf': certificateHeader + ',' + certificateHeader })).status).toBe(403);
    expect(store.objects.size).toBe(count);
    const untrustedProxy = await start({ proxyMode: 'direct' }); expect((await post(untrustedProxy.port, { 'x-amzn-mtls-clientcert-leaf': certificateHeader })).status).toBe(403); expect(untrustedProxy.store.objects.size).toBe(0);
  });
  it('blocks declared oversize and production paths before reading a body or writing storage', async () => {
    const { port, store } = await start();
    expect((await post(port, { 'x-amzn-mtls-clientcert-leaf': encodeURIComponent(peer), 'content-length': String(MAX_WIRE_BYTES + 1) })).status).toBe(413);
    expect((await post(port, {}, '/prod/RicezioneFatture')).status).toBe(503); expect(store.objects.size).toBe(0);
  });
});
describe('optional Lambda adapter', () => {
  it('uses only API Gateway authenticated clientCert context and decodes the binary wire body', async () => {
    const store = new MemoryInbox(); const handler = lambdaAdapter(createGateway(store, config));
    const incoming = request();
    const event = { version: '2.0', rawPath: incoming.path, headers: incoming.headers, body: incoming.body.toString('base64'), isBase64Encoded: true, requestContext: { http: { method: 'POST' }, authentication: { clientCert: { clientCertPem: peer } } } } as APIGatewayProxyEventV2;
    expect((await handler(event)).statusCode).toBe(200);
    const headerSpoof = { ...event, headers: { ...event.headers, 'x-amzn-mtls-clientcert-leaf': encodeURIComponent(peer) }, requestContext: { ...event.requestContext, authentication: undefined } };
    expect((await handler(headerSpoof)).statusCode).toBe(403);
    expect((await handler({ ...event, body: '!!!!' })).statusCode).toBe(500);
  });
});
describe('encrypted immutable S3 adapter', () => {
  it('requires KMS, writes conditionally with a checksum, tolerates only an existing-object precondition, and rejects production keys', async () => {
    const send = vi.fn(async (_command: PutObjectCommand) => ({})); const store = new S3InboxStore('test-inbox', 'test-kms-key', { send } as never);
    await store.putImmutable({ key: 'test/channel/object', data: Buffer.from('test'), contentType: 'application/octet-stream' });
    expect(send.mock.calls[0]![0].input).toMatchObject({ Bucket: 'test-inbox', Key: 'test/channel/object', ServerSideEncryption: 'aws:kms', SSEKMSKeyId: 'test-kms-key', IfNoneMatch: '*' });
    expect(send.mock.calls[0]![0].input.ChecksumSHA256).toBeTruthy();
    send.mockRejectedValueOnce(Object.assign(new Error('exists'), { name: 'PreconditionFailed', $metadata: { httpStatusCode: 412 } }));
    await expect(store.putImmutable({ key: 'test/channel/object', data: Buffer.from('test'), contentType: 'application/octet-stream' })).resolves.toBeUndefined();
    send.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }));
    await expect(store.putImmutable({ key: 'test/channel/object', data: Buffer.from('test'), contentType: 'application/octet-stream' })).rejects.toThrow('denied');
    await expect(store.putImmutable({ key: 'prod/channel/object', data: Buffer.from('test'), contentType: 'application/octet-stream' })).rejects.toThrow('Only test');
    expect(() => new S3InboxStore('test-inbox', '')).toThrow('required');
  });
});
