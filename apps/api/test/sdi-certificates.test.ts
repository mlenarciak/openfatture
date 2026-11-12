import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { X509Certificate, createPrivateKey } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySdiCertificates, type CertificateInputs } from '../../../scripts/sdi-verify-certificates.js';

let directory: string;
const file = (name: string) => path.join(directory, name);
function openssl(args: string[]) { execFileSync('openssl', args, { timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }); }
function root(id: string, commonName: string) {
  openssl(['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-sha256', '-keyout', file(`${id}.key`), '-out', file(`${id}.pem`), '-days', '7', '-subj', `/C=IT/O=Synthetic fixtures/CN=${commonName}`, '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
}
function leaf(id: string, commonName: string, issuer: string, purpose: 'clientAuth' | 'serverAuth', days = 5) {
  openssl(['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-keyout', file(`${id}.key`), '-out', file(`${id}.csr`), '-subj', `/C=IT/O=Synthetic fixtures/CN=${commonName}`]);
  writeFileSync(file(`${id}.ext`), `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=${purpose}\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n`);
  openssl(['x509', '-req', '-in', file(`${id}.csr`), '-CA', file(`${issuer}.pem`), '-CAkey', file(`${issuer}.key`), '-CAcreateserial', '-sha256', '-out', file(`${id}.pem`), '-days', String(days), '-extfile', file(`${id}.ext`)]);
}
function input(): CertificateInputs {
  return { client: file('client.pem'), clientKey: file('client.key'), server: file('server.pem'), serverKey: file('server.key'), productionCa: file('production.pem'), testCa: file('test.pem'), testPeer: file('peer.pem'), taxCode: '12345678901', hostname: 'sdi.synthetic.invalid' };
}
function passed(report: ReturnType<typeof verifySdiCertificates>, id: string) { return report.checks.find(check => check.id === id)?.ok; }

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'openfatture-synthetic-pki-'));
  root('production', 'Synthetic production CA'); root('test', 'CA Agenzia delle Entrate Test'); root('rogue', 'Synthetic rogue CA');
  leaf('client', 'SDI-12345678901', 'production', 'clientAuth');
  // Deliberately no SAN, exercising the explicit SAN-first / absent-SAN CN fallback.
  leaf('server', 'SDI.SYNTHETIC.INVALID', 'production', 'serverAuth');
  leaf('peer', 'Sistema Interscambio Fattura PA', 'test', 'clientAuth');
  leaf('wrong-eku', 'SDI-12345678901', 'production', 'serverAuth');
  leaf('expired', 'SDI-12345678901', 'production', 'clientAuth', -1);
  leaf('rogue-client', 'SDI-12345678901', 'rogue', 'clientAuth');
  leaf('production-peer', 'Sistema Interscambio Fattura PA', 'production', 'clientAuth');
  // Separate, correctly signed server certificate deliberately reusing the client SPKI.
  openssl(['req', '-new', '-key', file('client.key'), '-out', file('shared-key-server.csr'), '-subj', '/C=IT/O=Synthetic fixtures/CN=SDI.SYNTHETIC.INVALID']);
  openssl(['x509', '-req', '-in', file('shared-key-server.csr'), '-CA', file('production.pem'), '-CAkey', file('production.key'), '-CAcreateserial', '-sha256', '-out', file('shared-key-server.pem'), '-days', '5', '-extfile', file('server.ext')]);
}, 20000);
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

describe('offline SdI certificate verification using only generated synthetic fixtures', () => {
  it('validates leaf identities, keys, explicit purposes, CA signatures and separated chains without changing inputs', () => {
    const args = input(); const originals = [args.client, args.clientKey, args.server, args.serverKey, args.productionCa, args.testCa, args.testPeer].map(name => [name, readFileSync(name)] as const);
    const report = verifySdiCertificates(args);
    expect(report.ok, JSON.stringify(report.checks.filter(check => !check.ok))).toBe(true);
    expect(passed(report, 'server.hostname')).toBe(true);
    expect(passed(report, 'client.keyMatch')).toBe(true);
    expect(passed(report, 'testPeer.chain')).toBe(true);
    expect(report.certificates.testPeer?.sha256Fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(report.revocation).toBe('not_checked_offline');
    for (const [name, bytes] of originals) expect(readFileSync(name)).toEqual(bytes);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(directory);
    expect(serialized).not.toContain('BEGIN CERTIFICATE');
    expect(serialized).not.toContain('PRIVATE KEY');
  });

  it('normalizes DER and raw base64 certificates and DER private keys', () => {
    const args = input();
    writeFileSync(file('client.der'), new X509Certificate(readFileSync(args.client)).raw);
    writeFileSync(file('server.base64'), new X509Certificate(readFileSync(args.server)).raw.toString('base64'));
    writeFileSync(file('test-ca.der'), new X509Certificate(readFileSync(args.testCa)).raw);
    writeFileSync(file('server-key.der'), createPrivateKey(readFileSync(args.serverKey)).export({ type: 'pkcs8', format: 'der' }));
    const report = verifySdiCertificates({ ...args, client: file('client.der'), server: file('server.base64'), testCa: file('test-ca.der'), serverKey: file('server-key.der') });
    expect(report.ok, JSON.stringify(report.checks.filter(check => !check.ok))).toBe(true);
  });

  it('rejects client and server certificates that reuse one key pair even though both local key matches pass', () => {
    const report = verifySdiCertificates({ ...input(), server: file('shared-key-server.pem'), serverKey: file('client.key') });
    expect(report.ok).toBe(false);
    expect(passed(report, 'client.keyMatch')).toBe(true); expect(passed(report, 'server.keyMatch')).toBe(true);
    expect(passed(report, 'server.hostname')).toBe(true); expect(passed(report, 'server.chain')).toBe(true);
    expect(passed(report, 'operator.distinctKeys')).toBe(false);
  });

  it('rejects a mismatched private key', () => {
    const report = verifySdiCertificates({ ...input(), serverKey: file('client.key') });
    expect(report.ok).toBe(false); expect(passed(report, 'server.keyMatch')).toBe(false);
  });

  it('rejects the wrong fiscal identity and server hostname', () => {
    const report = verifySdiCertificates({ ...input(), taxCode: '99999999999', hostname: 'wrong.synthetic.invalid' });
    expect(report.ok).toBe(false); expect(passed(report, 'client.commonName')).toBe(false); expect(passed(report, 'server.hostname')).toBe(false);
  });

  it('rejects the wrong explicit EKU even when the certificate and key otherwise match', () => {
    const report = verifySdiCertificates({ ...input(), client: file('wrong-eku.pem'), clientKey: file('wrong-eku.key') });
    expect(report.ok).toBe(false); expect(passed(report, 'client.keyMatch')).toBe(true); expect(passed(report, 'client.extendedKeyUsage')).toBe(false); expect(passed(report, 'client.chain')).toBe(false);
  });

  it('rejects expired operator certificates in both local and OpenSSL checks', () => {
    const report = verifySdiCertificates({ ...input(), client: file('expired.pem'), clientKey: file('expired.key') });
    expect(report.ok).toBe(false); expect(passed(report, 'client.validity')).toBe(false); expect(passed(report, 'client.chain')).toBe(false);
  });

  it('rejects an untrusted issuer despite a matching CN, key and EKU', () => {
    const report = verifySdiCertificates({ ...input(), client: file('rogue-client.pem'), clientKey: file('rogue-client.key') });
    expect(report.ok).toBe(false); expect(passed(report, 'client.commonName')).toBe(true); expect(passed(report, 'client.keyMatch')).toBe(true); expect(passed(report, 'client.chain')).toBe(false);
  });

  it('never accepts the production-issued SdI peer on the TEST trust anchor', () => {
    const report = verifySdiCertificates({ ...input(), testPeer: file('production-peer.pem') });
    expect(report.ok).toBe(false); expect(passed(report, 'testPeer.commonName')).toBe(true); expect(passed(report, 'testPeer.extendedKeyUsage')).toBe(true); expect(passed(report, 'testPeer.chain')).toBe(false);
  });

  it('verifies the expected pin when supplied and fails a different pin', () => {
    const pin = new X509Certificate(readFileSync(input().testPeer)).fingerprint256;
    expect(verifySdiCertificates({ ...input(), testPeerSha256: pin }).ok).toBe(true);
    const rejected = verifySdiCertificates({ ...input(), testPeerSha256: '00'.repeat(32) });
    expect(rejected.ok).toBe(false); expect(passed(rejected, 'testPeer.pin')).toBe(false);
  });

  it('checks CA self-signatures rather than trusting an altered root certificate blindly', () => {
    const raw = Buffer.from(new X509Certificate(readFileSync(input().productionCa)).raw); raw[raw.length - 1] = raw[raw.length - 1]! ^ 1; writeFileSync(file('altered-root.der'), raw);
    const report = verifySdiCertificates({ ...input(), productionCa: file('altered-root.der') });
    expect(report.ok).toBe(false); expect(passed(report, 'productionCa.selfSignature')).toBe(false); expect(passed(report, 'productionCa.openssl')).toBe(false);
  });

  it('returns only JSON public metadata from the CLI and does not print input paths or key contents', () => {
    const args = input();
    const flags = Object.entries(args).flatMap(([key, value]) => [`--${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value]);
    const script = fileURLToPath(new URL('../../../scripts/sdi-verify-certificates.ts', import.meta.url));
    const child = spawnSync(process.execPath, ['--import', 'tsx', script, ...flags], { encoding: 'utf8', timeout: 15000 });
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout).ok).toBe(true);
    expect(child.stdout).not.toContain(directory);
    expect(child.stdout).not.toContain('PRIVATE KEY');
    expect(child.stderr).toBe('');
    const missing = spawnSync(process.execPath, ['--import', 'tsx', script, '--client', args.client], { encoding: 'utf8', timeout: 15000 });
    expect(missing.status).toBe(2); expect(JSON.parse(missing.stdout).error).toBe('INVALID_ARGUMENTS'); expect(missing.stdout).not.toContain(directory);
  });
});
