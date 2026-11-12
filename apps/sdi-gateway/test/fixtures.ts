import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { OPERATIONS } from '../src/soap.js';
import { RECEIVE_NS, SOAP_NS, type GatewayRequest, type ImmutableObject, type InboxStore, type Service } from '../src/types.js';
export const peer = readFileSync(fileURLToPath(new URL('./peer-fixture.pem', import.meta.url)), 'utf8');
export const peerPin = createHash('sha256').update(new (await import('node:crypto')).X509Certificate(peer).raw).digest('hex');
export const file = Buffer.from('<SyntheticInvoice>This is test data only</SyntheticInvoice>');
export const metadata = Buffer.from('<SyntheticMetadata>Only an opaque test attachment</SyntheticMetadata>');
export const name = 'IT00000000000_00001.xml';
export const metadataName = 'IT00000000000_00001_MT_001.xml';
export class MemoryInbox implements InboxStore {
  objects = new Map<string, Buffer>(); calls = 0; failOnCall?: number;
  async putImmutable(object: ImmutableObject) {
    this.calls += 1; if (this.calls === this.failOnCall) throw new Error('Storage unavailable');
    const existing = this.objects.get(object.key); if (existing && !existing.equals(object.data)) throw new Error('Immutable collision');
    this.objects.set(object.key, Buffer.from(object.data));
  }
}
export function soap(service: Service = 'RicezioneFatture', operationIndex = 0, options: { file?: Buffer; metadata?: Buffer; fields?: string; rootName?: string; namespace?: string } = {}) {
  const operation = OPERATIONS[service][operationIndex]!;
  const fields = options.fields ?? `<IdentificativoSdI>123456789012</IdentificativoSdI><NomeFile>${name}</NomeFile><File>${(options.file ?? file).toString('base64')}</File>${operation.metadata ? `<NomeFileMetadati>${metadataName}</NomeFileMetadati><Metadati>${(options.metadata ?? metadata).toString('base64')}</Metadati>` : ''}`;
  const rootName = options.rootName ?? operation.element;
  return `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="${SOAP_NS}"><s:Body><r:${rootName} xmlns:r="${options.namespace ?? operation.namespace}">${fields}</r:${rootName}></s:Body></s:Envelope>`;
}
export function request(service: Service = 'RicezioneFatture', operationIndex = 0, xml?: string): GatewayRequest {
  return { method: 'POST', path: `/test/${service}`, headers: { 'content-type': 'text/xml; charset=UTF-8', soapaction: `"${OPERATIONS[service][operationIndex]!.action}"` }, body: Buffer.from(xml ?? soap(service, operationIndex)), peer: { certificatePem: peer, verifiedByIngress: true } };
}
export function mtom(options: { boundary?: string; file?: Buffer; duplicateId?: boolean; missing?: boolean; externalHref?: boolean; extra?: boolean } = {}): GatewayRequest {
  const boundary = options.boundary ?? 'synthetic-boundary-001';
  const fields = `<IdentificativoSdI>123456789012</IdentificativoSdI><NomeFile>${name}</NomeFile><File><xop:Include xmlns:xop="http://www.w3.org/2004/08/xop/include" href="${options.externalHref ? 'https://attacker.invalid/file' : 'cid:file%40test'}"/></File><NomeFileMetadati>${metadataName}</NomeFileMetadati><Metadati><xop:Include xmlns:xop="http://www.w3.org/2004/08/xop/include" href="cid:metadata@test"/></Metadati>`;
  const parts = [
    Buffer.from(`--${boundary}\r\nContent-Type: application/xop+xml; charset=UTF-8; type="text/xml"\r\nContent-ID: <root@test>\r\n\r\n${soap('RicezioneFatture', 0, { fields })}\r\n`),
    ...options.missing ? [] : [Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-ID: <file@test>\r\nContent-Transfer-Encoding: binary\r\n\r\n`), options.file ?? file, Buffer.from('\r\n')])],
    Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-ID: <${options.duplicateId ? 'file' : 'metadata'}@test>\r\nContent-Transfer-Encoding: binary\r\n\r\n`), metadata, Buffer.from('\r\n')]),
    ...options.extra ? [Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\nContent-ID: <extra@test>\r\n\r\nunused\r\n`)] : [],
    Buffer.from(`--${boundary}--\r\n`),
  ];
  return { ...request(), headers: { ...request().headers, 'content-type': `multipart/related; boundary="${boundary}"; type="application/xop+xml"; start="<root@test>"; start-info="text/xml"` }, body: Buffer.concat(parts) };
}
export const wrongNamespace = RECEIVE_NS + '/wrong';
