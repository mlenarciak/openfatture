import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createGateway } from '../src/gateway.js';
import { OPERATIONS } from '../src/soap.js';
import { MAX_FILE_BYTES, MAX_METADATA_BYTES, MAX_WIRE_BYTES, RECEIVE_NS, type Service } from '../src/types.js';
import { file, MemoryInbox, metadata, mtom, peer, peerPin, request, soap, wrongNamespace } from './fixtures.js';
const config = { providerContext: 'synthetic_test_channel', trustedPeerSha256: [peerPin] };
function gateway(store = new MemoryInbox()) { return { store, handle: createGateway(store, config) }; }

describe('official contract and durable receipt', () => {
  it('pins the downloaded official WSDL/XSD bytes', () => {
    const directory = fileURLToPath(new URL('../references/', import.meta.url));
    const sources = JSON.parse(readFileSync(`${directory}sources.json`, 'utf8')) as { file: string; url: string; sha256: string }[];
    expect(sources).toHaveLength(4);
    for (const source of sources) { expect(source.url).toMatch(/^https:\/\/www\.fatturapa\.gov\.it\//); expect(createHash('sha256').update(readFileSync(directory + source.file)).digest('hex')).toBe(source.sha256); }
  });
  it('persists raw invoice plus metadata and completion marker before returning ER01', async () => {
    const { store, handle } = gateway(); const incoming = request(); const response = await handle(incoming);
    expect(response.statusCode).toBe(200); expect(response.body).toContain(`<r:rispostaRiceviFatture xmlns:r="${RECEIVE_NS}"><Esito>ER01</Esito>`);
    expect([...store.objects.values()].some(bytes => bytes.equals(incoming.body))).toBe(true);
    expect([...store.objects.values()].some(bytes => bytes.equals(file))).toBe(true); expect([...store.objects.values()].some(bytes => bytes.equals(metadata))).toBe(true);
    expect(store.objects.size).toBe(4); const [lastKey, lastBody] = [...store.objects.entries()].at(-1)!; expect(lastKey).toMatch(/\/manifest\.json$/); expect(JSON.parse(lastBody.toString())).toMatchObject({ environment: 'test', providerContext: config.providerContext, fiscalValidation: 'not-performed', applicationProcessing: 'quarantined' });
  });
  for (const service of Object.keys(OPERATIONS) as Service[]) OPERATIONS[service].forEach((operation, index) => {
    if (operation.name === 'RiceviFatture') return;
    it(`durably acknowledges one-way ${service}/${operation.name} without inventing a SOAP response`, async () => {
      const { handle, store } = gateway(); const response = await handle(request(service, index)); expect(response.statusCode).toBe(202); expect(response.body).toBe(''); expect(store.objects.size).toBe(3);
    });
  });
  it('deduplicates identical callbacks immutably and preserves alternative MIME wire encodings', async () => {
    const { handle, store } = gateway();
    expect((await handle(mtom())).statusCode).toBe(200); const first = store.objects.size;
    expect((await handle(mtom())).statusCode).toBe(200); expect(store.objects.size).toBe(first);
    expect((await handle(mtom({ boundary: 'another-boundary' }))).statusCode).toBe(200); expect(store.objects.size).toBe(first + 1);
    const manifests = [...store.objects.keys()].filter(key => key.endsWith('/manifest.json')); expect(manifests).toHaveLength(1);
  });
  it('never returns a successful ack when storage fails, and safely completes a retry after partial storage', async () => {
    const { handle, store } = gateway(); store.failOnCall = 3;
    const failed = await handle(request()); expect(failed.statusCode).toBe(500); expect(failed.body).toContain('soap:Server'); expect(failed.body).not.toContain('ER01'); expect([...store.objects.keys()].some(key => key.endsWith('manifest.json'))).toBe(false);
    expect((await handle(request())).statusCode).toBe(200); expect(store.objects.size).toBe(4);
  });
});

describe('MTOM, sizes and XML safety', () => {
  it('accepts binary MTOM including non-UTF8 attachment bytes without changing them', async () => {
    const binary = Buffer.from([0, 255, 254, 13, 10, 65, 128]); const { handle, store } = gateway();
    expect((await handle(mtom({ file: binary }))).statusCode).toBe(200); expect([...store.objects.values()].some(value => value.equals(binary))).toBe(true);
  });
  it('accepts the full 5 MiB file limit through inline SOAP and MTOM', async () => {
    const large = Buffer.alloc(MAX_FILE_BYTES, 65); const { handle } = gateway();
    expect((await handle(request('RicezioneFatture', 0, soap('RicezioneFatture', 0, { file: large })))).statusCode).toBe(200);
    expect((await handle(mtom({ file: large }))).statusCode).toBe(200);
  });
  it('rejects wire, file and metadata payloads above their bounds without storing them', async () => {
    const { handle, store } = gateway();
    for (const incoming of [ { ...request(), body: Buffer.alloc(MAX_WIRE_BYTES + 1) }, request('RicezioneFatture', 0, soap('RicezioneFatture', 0, { file: Buffer.alloc(MAX_FILE_BYTES + 1) })), request('RicezioneFatture', 0, soap('RicezioneFatture', 0, { metadata: Buffer.alloc(MAX_METADATA_BYTES + 1) })) ]) { const response = await handle(incoming); expect(response.statusCode).toBeGreaterThanOrEqual(400); expect(response.body).not.toContain('ER01'); }
    expect(store.objects.size).toBe(0);
  });
  it.each([
    ['DOCTYPE external entity', () => soap().replace('<s:Envelope', '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><s:Envelope')],
    ['entity expansion', () => soap().replace('<s:Envelope', '<!DOCTYPE x [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;">]><s:Envelope')],
    ['undeclared namespace', () => soap().replace('xmlns:r="' + RECEIVE_NS + '"', '')],
    ['wrong root namespace', () => soap('RicezioneFatture', 0, { namespace: wrongNamespace })],
    ['wrong wrapper', () => soap('RicezioneFatture', 0, { rootName: 'RiceviFatture' })],
    ['qualified local field', () => soap().replace('<NomeFile>', '<r:NomeFile>').replace('</NomeFile>', '</r:NomeFile>')],
    ['extra operation', () => soap().replace('</s:Body>', '<r:extra xmlns:r="' + RECEIVE_NS + '"/></s:Body>')],
    ['duplicate field', () => soap().replace('<NomeFile>', '<IdentificativoSdI>1</IdentificativoSdI><NomeFile>')],
    ['malformed XML', () => soap().replace('</s:Body>', '</mismatch>')],
    ['invalid base64', () => soap().replace(file.toString('base64'), '!!!!')],
    ['noncanonical base64', () => soap().replace(file.toString('base64'), 'Zh==')],
    ['path filename', () => soap().replace('IT00000000000_00001.xml', '../private.xml')],
  ])('rejects %s', async (_, make) => {
    const { handle, store } = gateway(); const response = await handle(request('RicezioneFatture', 0, make())); expect(response.statusCode).toBe(500); expect(response.body).toContain('soap:Client'); expect(response.body).not.toContain('ER01'); expect(store.objects.size).toBe(0);
  });
  it.each([{ duplicateId: true }, { missing: true }, { externalHref: true }, { extra: true }])('rejects ambiguous or unsafe MIME %j', async options => { const { handle, store } = gateway(); expect((await handle(mtom(options))).statusCode).toBe(500); expect(store.objects.size).toBe(0); });
  it('rejects high-bit MIME base64 bytes rather than masking them into valid attachment characters', async () => {
    const encoded = file.toString('base64'); const incoming = mtom({ file: Buffer.from(encoded) });
    const raw = Buffer.from(incoming.body.toString('latin1').replace('Content-Transfer-Encoding: binary', 'Content-Transfer-Encoding: base64'), 'latin1');
    const offset = raw.indexOf(encoded); expect(offset).toBeGreaterThan(0); raw[offset] = raw[offset]! | 0x80;
    const { handle, store } = gateway(); const response = await handle({ ...incoming, body: raw });
    expect(response.statusCode).toBe(500); expect(response.body).not.toContain('ER01'); expect(store.objects.size).toBe(0);
  });
  it('rejects high-bit fake MIME closing delimiters rather than interpreting them as ASCII dashes', async () => {
    const incoming = mtom(); const raw = Buffer.from(incoming.body);
    expect(raw.subarray(-4).toString('latin1')).toBe('--\r\n'); raw[raw.length - 4] = 0xad; raw[raw.length - 3] = 0xad;
    const { handle, store } = gateway(); const response = await handle({ ...incoming, body: raw });
    expect(response.statusCode).toBe(500); expect(response.body).not.toContain('ER01'); expect(store.objects.size).toBe(0);
  });
  it.each(['NomeFile', 'NomeFileMetadati'])('rejects whitespace in XSD string field %s without silently trimming it', async field => {
    const xml = soap().replace(`<${field}>`, `<${field}> `).replace(`</${field}>`, ` </${field}>`);
    const { handle, store } = gateway(); const response = await handle(request('RicezioneFatture', 0, xml));
    expect(response.statusCode).toBe(500); expect(store.objects.size).toBe(0);
  });
  it('rejects wrong SOAPAction and SOAP1.2', async () => { const { handle } = gateway(); expect((await handle({ ...request(), headers: { ...request().headers, soapaction: 'wrong' } })).statusCode).toBe(500); expect((await handle({ ...request(), headers: { ...request().headers, 'content-type': 'application/soap+xml' } })).statusCode).toBe(500); });
});

describe('peer identity and test-only boundary', () => {
  it('fails closed without configured trust, verified ingress context, a pinned peer, or an unexpired certificate', async () => {
    const store = new MemoryInbox();
    expect((await createGateway(store, { ...config, trustedPeerSha256: [] })(request())).statusCode).toBe(503);
    expect((await createGateway(store, { ...config, trustedPeerSha256: ['a'.repeat(64)] })(request())).statusCode).toBe(403);
    const { handle } = gateway(store);
    expect((await handle({ ...request(), peer: undefined, headers: { ...request().headers, 'x-amzn-mtls-clientcert-leaf': encodeURIComponent(peer) } })).statusCode).toBe(403);
    expect((await handle({ ...request(), peer: { certificatePem: peer, verifiedByIngress: false } })).statusCode).toBe(403);
    const certificate = new X509Certificate(peer);
    expect((await createGateway(store, config, () => new Date(Date.parse(certificate.validTo) + 1000))(request())).statusCode).toBe(403);
    expect((await createGateway(store, config, () => new Date(Date.parse(certificate.validFrom) - 1000))(request())).statusCode).toBe(403);
    expect(store.objects.size).toBe(0);
  });
  it('blocks production paths and never derives storage context from caller company headers', async () => {
    const { handle, store } = gateway(); expect((await handle({ ...request(), path: '/prod/RicezioneFatture' })).statusCode).toBe(503); expect(store.objects.size).toBe(0);
    expect((await handle({ ...request(), headers: { ...request().headers, 'x-company-id': 'attacker-tenant', 'x-provider-context': 'attacker-provider' } })).statusCode).toBe(200);
    expect([...store.objects.keys()].every(key => key.startsWith(`test/${config.providerContext}/`))).toBe(true);
  });
  it('provides only minimal public process health', async () => {
    const { handle } = gateway(); const response = await handle({ method: 'GET', path: '/health', headers: {}, body: Buffer.alloc(0) }); expect(JSON.parse(response.body)).toEqual({ status: 'ok', mode: 'test-only' });
  });
});
