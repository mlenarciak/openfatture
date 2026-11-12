#!/usr/bin/env node
/** Offline-only verification. Source certificates/keys are never changed; private keys never leave memory. */
import { X509Certificate, createPrivateKey, createPublicKey, timingSafeEqual, type KeyObject } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CertificateInputs {
  client: string; clientKey: string; server: string; serverKey: string;
  productionCa: string; testCa: string; testPeer: string; taxCode: string; hostname: string;
  testPeerCn?: string; testPeerSha256?: string;
}
interface Check { id: string; ok: boolean; message: string }
interface PublicCertificate {
  commonName: string | null; issuer: string; serialNumber: string; sha256Fingerprint: string;
  validFrom: string; validUntil: string; ca: boolean; extendedKeyUsage: string[];
}
export interface CertificateReport {
  ok: boolean; environment: 'test'; checkedAt: string; checks: Check[];
  certificates: Partial<Record<'client' | 'server' | 'productionCa' | 'testCa' | 'testPeer', PublicCertificate>>;
  opensslVersion?: string; revocation: 'not_checked_offline'; limitations: string[];
}
const clientAuth = '1.3.6.1.5.5.7.3.2';
const serverAuth = '1.3.6.1.5.5.7.3.1';
const defaultTestPeerCn = 'Sistema Interscambio Fattura PA';
const expectedTestCaCn = 'CA Agenzia delle Entrate Test';
const certificateIds = ['client', 'server', 'productionCa', 'testCa', 'testPeer'] as const;

function commonName(cert: X509Certificate): string | undefined {
  const names = [...cert.subject.matchAll(/^CN=(.+)$/gm)];
  return names.length === 1 ? names[0]![1] : undefined;
}
function sha256(cert: X509Certificate) { return cert.fingerprint256.replaceAll(':', '').toLowerCase(); }
function base64(value: Buffer): Buffer | undefined {
  const text = value.toString('utf8').replace(/^\uFEFF/, '').replace(/\s+/g, '');
  if (!text || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return undefined;
  const decoded = Buffer.from(text, 'base64');
  return decoded.toString('base64') === text ? decoded : undefined;
}
function boundedRead(filename: string, limit: number) {
  const info = statSync(filename);
  if (!info.isFile() || info.size === 0 || info.size > limit) throw new Error('Unsupported input');
  return readFileSync(filename);
}
function certificate(filename: string) {
  const bytes = boundedRead(filename, 1_048_576);
  const pemCount = bytes.toString('utf8').match(/-----BEGIN CERTIFICATE-----/g)?.length ?? 0;
  if (pemCount > 1) throw new Error('Supply one certificate per input');
  try { return new X509Certificate(bytes); }
  catch { const decoded = base64(bytes); if (!decoded) throw new Error('Invalid certificate encoding'); return new X509Certificate(decoded); }
}
function privateKey(filename: string): KeyObject {
  const bytes = boundedRead(filename, 4_194_304);
  try { return createPrivateKey(bytes); } catch { /* Try unencrypted DER encodings next. */ }
  const decoded = base64(bytes);
  for (const candidate of decoded ? [bytes, decoded] : [bytes]) {
    for (const type of ['pkcs8', 'pkcs1', 'sec1'] as const) {
      try { return createPrivateKey({ key: candidate, format: 'der', type }); } catch { /* No key content is logged. */ }
    }
  }
  throw new Error('Unsupported or encrypted private key');
}
function keyMatches(cert: X509Certificate, key: KeyObject) {
  const actual = createPublicKey(key).export({ type: 'spki', format: 'der' });
  const expected = cert.publicKey.export({ type: 'spki', format: 'der' });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function publicMetadata(cert: X509Certificate): PublicCertificate {
  return { commonName: commonName(cert) ?? null, issuer: cert.issuer, serialNumber: cert.serialNumber,
    sha256Fingerprint: sha256(cert), validFrom: new Date(cert.validFrom).toISOString(), validUntil: new Date(cert.validTo).toISOString(),
    ca: cert.ca, extendedKeyUsage: cert.keyUsage ?? [] };
}
function cleanPin(value: string) { return value.replaceAll(':', '').toLowerCase(); }

export function verifySdiCertificates(input: CertificateInputs, now = new Date()): CertificateReport {
  const report: CertificateReport = { ok: false, environment: 'test', checkedAt: now.toISOString(), checks: [], certificates: {}, revocation: 'not_checked_offline', limitations: [
    'Offline cryptographic checks do not establish endpoint publication, interoperability, accreditation or production activation.',
    'Revocation, CRL freshness and remote reachability are not checked; apply the approved operational policy before connected tests.',
    'Only the explicitly supplied operator certificates and incoming TEST peer are inspected. Other kit certificates are not loaded.',
    'Supplied roots are operator-selected trust inputs; these checks do not prove portal provenance or establish public browser/web CA trust.',
  ] };
  const check = (id: string, ok: boolean, message: string) => { report.checks.push({ id, ok, message }); return ok; };
  if (!check('arguments', /^[A-Z0-9]{11,16}$/.test(input.taxCode) && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(input.hostname) && (!input.testPeerSha256 || /^[a-f0-9]{64}$/.test(cleanPin(input.testPeerSha256))), 'Tax code, DNS hostname and optional SHA-256 pin must be valid')) return report;
  const certs: Partial<Record<typeof certificateIds[number], X509Certificate>> = {};
  for (const id of certificateIds) {
    try { const cert = certificate(input[id]); certs[id] = cert; report.certificates[id] = publicMetadata(cert); check(`${id}.parsed`, true, 'Single certificate parsed from PEM, DER or raw base64'); }
    catch { check(`${id}.parsed`, false, 'Certificate could not be read or parsed; no input contents or paths are included'); }
  }
  if (certificateIds.some(id => !certs[id])) return report;
  const complete = certs as Record<typeof certificateIds[number], X509Certificate>;
  for (const id of certificateIds) {
    const cert = complete[id];
    const from = Date.parse(cert.validFrom); const until = Date.parse(cert.validTo);
    check(`${id}.validity`, Number.isFinite(from) && Number.isFinite(until) && from <= now.getTime() && now.getTime() < until, 'Certificate must be currently valid');
  }
  for (const id of ['productionCa', 'testCa'] as const) {
    const cert = complete[id];
    check(`${id}.ca`, cert.ca, 'Trust anchor must have CA basic constraints');
    check(`${id}.selfSignature`, cert.checkIssued(cert) && cert.verify(cert.publicKey), 'Trust anchor self-signature and self-issued identity must verify');
  }
  check('roots.distinct', sha256(complete.productionCa) !== sha256(complete.testCa), 'Production and TEST trust anchors must be distinct');
  check('testCa.identity', commonName(complete.testCa) === expectedTestCaCn, 'TEST anchor common name must match the expected Agenzia test CA');
  for (const id of ['client', 'server', 'testPeer'] as const) check(`${id}.notCa`, !complete[id].ca, 'TLS peer identity must be a leaf, not a CA');
  const clientPublicKey = complete.client.publicKey.export({ type: 'spki', format: 'der' });
  const serverPublicKey = complete.server.publicKey.export({ type: 'spki', format: 'der' });
  check('operator.distinctKeys', clientPublicKey.length !== serverPublicKey.length || !timingSafeEqual(clientPublicKey, serverPublicKey), 'Operator client and server must use distinct public/private key pairs');
  check('client.commonName', commonName(complete.client) === `SDI-${input.taxCode}`, 'Client common name must exactly match SDI- plus the supplied tax code');
  check('server.hostname', !!complete.server.checkHost(input.hostname, { subject: 'default', wildcards: false, partialWildcards: false, multiLabelWildcards: false, singleLabelSubdomains: false }), 'Server hostname must match SAN, with explicit CN fallback only when DNS SAN is absent');
  check('testPeer.commonName', commonName(complete.testPeer) === (input.testPeerCn ?? defaultTestPeerCn), 'Incoming TEST peer common name must match the explicitly expected SdI identity');
  for (const [id, oid] of [['client', clientAuth], ['server', serverAuth], ['testPeer', clientAuth]] as const) check(`${id}.extendedKeyUsage`, (complete[id].keyUsage ?? []).includes(oid), `Explicit ${oid === clientAuth ? 'TLS client' : 'TLS server'} extended key usage is required`);
  for (const [id, keyFile] of [['client', input.clientKey], ['server', input.serverKey]] as const) {
    try { check(`${id}.keyMatch`, keyMatches(complete[id], privateKey(keyFile)), 'Private key public component must match the certificate'); }
    catch { check(`${id}.keyMatch`, false, 'Private key could not be parsed; encrypted keys are unsupported and no key contents are included'); }
  }
  if (input.testPeerSha256) check('testPeer.pin', sha256(complete.testPeer) === cleanPin(input.testPeerSha256), 'Incoming TEST peer fingerprint must equal the supplied SHA-256 pin');
  else check('testPeer.pinRecorded', true, 'Computed TEST peer SHA-256 fingerprint is recorded in public metadata; no expected pin was supplied for comparison');
  let directory: string | undefined;
  try {
    const version = execFileSync('openssl', ['version'], { encoding: 'utf8', timeout: 5000, maxBuffer: 65_536, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (!/^OpenSSL\s+(?:[3-9]|[1-9][0-9])\./.test(version)) throw new Error('OpenSSL 3 or newer required');
    report.opensslVersion = version;
    directory = mkdtempSync(path.join(tmpdir(), 'openfatture-public-cert-check-')); chmodSync(directory, 0o700);
    const paths = Object.fromEntries(certificateIds.map(id => { const file = path.join(directory!, `${id}.pem`); writeFileSync(file, complete[id].toString(), { mode: 0o600 }); return [id, file]; })) as Record<typeof certificateIds[number], string>;
    const verify = (id: string, leaf: typeof certificateIds[number], ca: 'productionCa' | 'testCa', purpose: 'sslclient' | 'sslserver' | 'any') => {
      try {
        execFileSync('openssl', ['verify', '-no-CApath', '-no-CAstore', '-CAfile', paths[ca], '-check_ss_sig', '-attime', String(Math.floor(now.getTime() / 1000)), '-purpose', purpose, paths[leaf]], { timeout: 5000, maxBuffer: 65_536, stdio: ['ignore', 'pipe', 'pipe'] });
        check(id, true, 'OpenSSL chain, validity and purpose verification passed against only the selected trust anchor');
      } catch { check(id, false, 'OpenSSL chain, validity or purpose verification failed; raw output and paths are suppressed'); }
    };
    verify('productionCa.openssl', 'productionCa', 'productionCa', 'any');
    verify('testCa.openssl', 'testCa', 'testCa', 'any');
    verify('client.chain', 'client', 'productionCa', 'sslclient');
    verify('server.chain', 'server', 'productionCa', 'sslserver');
    verify('testPeer.chain', 'testPeer', 'testCa', 'sslclient');
  } catch { check('openssl.available', false, 'OpenSSL 3 or newer and temporary public-certificate storage are required for offline chain verification'); }
  finally { if (directory) rmSync(directory, { recursive: true, force: true }); }
  report.ok = report.checks.every(result => result.ok);
  return report;
}

const requiredFlags = ['--client', '--client-key', '--server', '--server-key', '--production-ca', '--test-ca', '--test-peer', '--tax-code', '--hostname'] as const;
const optionalFlags = ['--test-peer-cn', '--test-peer-sha256'] as const;
export function runCertificateCli(args: string[]) {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(JSON.stringify({ usage: 'node --import tsx scripts/sdi-verify-certificates.ts [options]', requiredFlags, optionalFlags, expectedTestPeerCn: defaultTestPeerCn, expectedTestCaCn, sourceFilesUnchanged: true, temporaryFiles: 'Normalized PUBLIC certificates only; removed after verification', network: false }) + '\n'); return 0;
  }
  const values: Record<string, string> = {};
  let valid = args.length % 2 === 0;
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]!; const value = args[i + 1];
    if (![...requiredFlags, ...optionalFlags].includes(flag as typeof requiredFlags[number]) || !value || value.startsWith('--') || values[flag]) { valid = false; break; }
    values[flag] = value;
  }
  if (!valid || requiredFlags.some(flag => !values[flag])) {
    process.stdout.write(JSON.stringify({ ok: false, error: 'INVALID_ARGUMENTS', message: 'Supply all required named options once; use --help for the public argument list' }) + '\n'); return 2;
  }
  try {
    const report = verifySdiCertificates({ client: values['--client'], clientKey: values['--client-key'], server: values['--server'], serverKey: values['--server-key'], productionCa: values['--production-ca'], testCa: values['--test-ca'], testPeer: values['--test-peer'], taxCode: values['--tax-code'], hostname: values['--hostname'], testPeerCn: values['--test-peer-cn'], testPeerSha256: values['--test-peer-sha256'] });
    process.stdout.write(JSON.stringify(report) + '\n'); return report.ok ? 0 : 1;
  } catch {
    process.stdout.write(JSON.stringify({ ok: false, error: 'VERIFICATION_FAILED', message: 'Verification could not complete; input contents, private keys and paths are suppressed' }) + '\n'); return 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCertificateCli(process.argv.slice(2));
