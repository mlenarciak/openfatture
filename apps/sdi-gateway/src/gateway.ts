import { createHash, X509Certificate } from 'node:crypto';
import { acknowledgement, decodeSoap } from './soap.js';
import { GatewayError, MAX_WIRE_BYTES, SOAP_NS, type GatewayConfig, type GatewayRequest, type GatewayResponse, type InboxStore, type Service, type TrustedPeer } from './types.js';
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const responseHeaders = { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
export function faultResponse(error: GatewayError): GatewayResponse {
  return { statusCode: error.status === 400 ? 500 : error.status, headers: responseHeaders, body: `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="${SOAP_NS}"><soap:Body><soap:Fault><faultcode>soap:${error.fault}</faultcode><faultstring>${escape(error.reason)}</faultstring></soap:Fault></soap:Body></soap:Envelope>` };
}
export function configFromEnvironment(env: NodeJS.ProcessEnv): GatewayConfig {
  return { providerContext: env.SDI_PROVIDER_CONTEXT ?? '', trustedPeerSha256: (env.SDI_TEST_PEER_SHA256 ?? '').split(',').map(value => value.trim().replaceAll(':', '').toLowerCase()).filter(Boolean) };
}
export function createPeerVerifier(config: GatewayConfig, now: () => Date = () => new Date()) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(config.providerContext)) throw new Error('SDI_PROVIDER_CONTEXT must be a fixed server-side identifier');
  const pins = config.trustedPeerSha256.map(pin => pin.replaceAll(':', '').toLowerCase());
  if (pins.some(pin => !/^[a-f0-9]{64}$/.test(pin))) throw new Error('SDI_TEST_PEER_SHA256 contains an invalid SHA256 fingerprint');
  return (peer?: TrustedPeer): string => {
    if (!pins.length) throw new GatewayError(503, 'Server', 'Test peer trust is not configured');
    if (!peer?.verifiedByIngress || !peer.certificatePem) throw new GatewayError(403, 'Client', 'A verified mutual TLS peer is required');
    if (!/^-----BEGIN CERTIFICATE-----[\r\n]+(?:[A-Za-z0-9+/=]+[\r\n]+)+-----END CERTIFICATE-----[\r\n]*$/.test(peer.certificatePem)) throw new GatewayError(403, 'Client', 'Exactly one PEM peer certificate is required');
    let certificate: X509Certificate;
    try { certificate = new X509Certificate(peer.certificatePem); } catch { throw new GatewayError(403, 'Client', 'Invalid mutual TLS peer'); }
    const fingerprint = sha256(certificate.raw); const time = now().getTime();
    if (!pins.includes(fingerprint) || time < Date.parse(certificate.validFrom) || time > Date.parse(certificate.validTo)) throw new GatewayError(403, 'Client', 'Mutual TLS peer is not authorized');
    return fingerprint;
  };
}
export function createGateway(store: InboxStore, config: GatewayConfig, now: () => Date = () => new Date()) {
  const verifyPeer = createPeerVerifier(config, now);
  return async (request: GatewayRequest): Promise<GatewayResponse> => {
    if (request.method === 'GET' && request.path === '/health') return { statusCode: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify({ status: 'ok', mode: 'test-only' }) };
    try {
      const match = /^\/test\/(RicezioneFatture|TrasmissioneFatture)$/.exec(request.path);
      if (!match) throw new GatewayError(request.path.startsWith('/prod') ? 503 : 404, 'Client', 'Production and unconfigured endpoints are disabled');
      if (request.method !== 'POST') throw new GatewayError(405, 'Client', 'POST is required');
      verifyPeer(request.peer);
      if (request.body.length === 0 || request.body.length > MAX_WIRE_BYTES) throw new GatewayError(413, 'Client', 'SOAP payload exceeds the supported limit');
      const headers: Record<string, string | undefined> = {};
      for (const [name, value] of Object.entries(request.headers)) { const lower = name.toLowerCase(); if (Object.hasOwn(headers, lower)) throw new GatewayError(400, 'Client', 'Duplicate HTTP header'); headers[lower] = value; }
      if (headers['content-encoding'] && headers['content-encoding'].toLowerCase() !== 'identity') throw new GatewayError(415, 'Client', 'Compressed SOAP is unsupported');
      const receipt = decodeSoap(match[1] as Service, request.body, headers);
      const attachments = receipt.attachments.map(attachment => ({ role: attachment.role, name: attachment.name, sha256: sha256(attachment.data), size: attachment.data.length }));
      const identity = { service: receipt.service, operation: receipt.operation, identificativoSdI: BigInt(receipt.identificativoSdI).toString(), attachments };
      const digest = sha256(JSON.stringify(identity));
      const prefix = `test/${config.providerContext}/${receipt.service}/${receipt.operation}/${digest}`;
      // A retry can use different MIME boundaries: preserve each raw wire representation and deduplicate decoded content.
      await store.putImmutable({ key: `${prefix}/raw/${sha256(request.body)}.bin`, data: request.body, contentType: 'application/octet-stream' });
      for (let index = 0; index < receipt.attachments.length; index++) await store.putImmutable({ key: `${prefix}/attachments/${attachments[index]!.role}-${attachments[index]!.sha256}.bin`, data: receipt.attachments[index]!.data, contentType: 'application/octet-stream' });
      // The manifest is the completion marker and is never written until every input object is durable.
      await store.putImmutable({ key: `${prefix}/manifest.json`, data: Buffer.from(JSON.stringify({ schemaVersion: 1, environment: 'test', providerContext: config.providerContext, ...identity, fiscalValidation: 'not-performed', applicationProcessing: 'quarantined' })), contentType: 'application/json' });
      const ack = acknowledgement(receipt);
      return { ...ack, headers: responseHeaders };
    } catch (error) {
      if (error instanceof GatewayError) return faultResponse(error);
      // Do not expose XML, certificates, S3 identifiers, or internal error details to the peer.
      return faultResponse(new GatewayError(500, 'Server', 'Durable receipt could not be completed; retry the request'));
    }
  };
}
