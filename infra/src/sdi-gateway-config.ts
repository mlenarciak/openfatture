import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { sdiOperatorReadinessSchema, type SdiOperatorReadiness } from '../../packages/domain/src/index.js';

export interface SdiGatewayConfig {
  serverCertificateArn: string;
  truststoreBucketName: string;
  truststoreKey: string;
  truststoreVersion: string;
  testPeerSha256: string[];
  providerContext: string;
  hostedZoneId: string;
  hostname: 'sdi.openfatture.com';
}

type ContextReader = (name: string) => unknown;
const gatewayContextNames = ['sdiServerCertificateArn', 'sdiTruststoreBucketName', 'sdiTruststoreKey', 'sdiTruststoreVersion', 'sdiTestPeerSha256', 'sdiProviderContext'] as const;

/** Enabling infrastructure requires a complete, explicitly reviewed TEST trust configuration. */
export function deploymentSdiGateway(context: ContextReader, region: string, account?: string): SdiGatewayConfig | undefined {
  const enabled = context('sdiGateway');
  if (enabled !== undefined && enabled !== true && enabled !== false && enabled !== 'true' && enabled !== 'false') throw new Error('sdiGateway must be true or false');
  if (enabled !== true && enabled !== 'true') {
    if (gatewayContextNames.some(name => context(name) !== undefined)) throw new Error('SdI gateway context requires explicit sdiGateway=true');
    return undefined;
  }
  if (region !== 'eu-south-1') throw new Error('The dedicated SdI TEST gateway must be deployed in eu-south-1');
  const values = Object.fromEntries(gatewayContextNames.map(name => [name, context(name)]));
  for (const name of gatewayContextNames) if (typeof values[name] !== 'string' || !values[name]) throw new Error(`sdiGateway=true requires ${name}`);
  const get = (name: typeof gatewayContextNames[number]) => values[name] as string;
  const serverCertificateArn = get('sdiServerCertificateArn');
  const cert = /^arn:aws:acm:eu-south-1:([0-9]{12}):certificate\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(serverCertificateArn);
  if (!cert || (account && account !== cert[1])) throw new Error('sdiServerCertificateArn must reference the deployment account ACM certificate in eu-south-1');
  const truststoreBucketName = get('sdiTruststoreBucketName');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(truststoreBucketName) || truststoreBucketName.includes('..') || /^\d+\.\d+\.\d+\.\d+$/.test(truststoreBucketName)) throw new Error('sdiTruststoreBucketName must be an existing private S3 bucket name');
  const truststoreKey = get('sdiTruststoreKey');
  if (truststoreKey.length > 1024 || truststoreKey.startsWith('/') || truststoreKey.split('/').some(part => !part || part === '.' || part === '..') || /[\s\x00-\x1f\x7f]/.test(truststoreKey)) throw new Error('sdiTruststoreKey must be a safe nonempty S3 object key');
  const truststoreVersion = get('sdiTruststoreVersion');
  if (truststoreVersion.length > 1024 || truststoreVersion.toLowerCase() === 'null' || /\s/.test(truststoreVersion)) throw new Error('sdiTruststoreVersion must pin a real S3 version ID');
  const testPeerSha256 = [...new Set(get('sdiTestPeerSha256').split(',').map(value => value.trim().replaceAll(':', '').toLowerCase()))];
  if (testPeerSha256.length > 10 || testPeerSha256.some(pin => !/^[a-f0-9]{64}$/.test(pin))) throw new Error('sdiTestPeerSha256 requires exact SHA256 fingerprints of verified SdI TEST caller certificates');
  const providerContext = get('sdiProviderContext');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(providerContext)) throw new Error('sdiProviderContext must contain 1-80 letters, digits, underscores or hyphens');
  const hostedZoneId = context('hostedZoneId');
  if (context('domainName') !== 'openfatture.com' || typeof hostedZoneId !== 'string' || !/^Z[A-Z0-9]{1,32}$/.test(hostedZoneId)) throw new Error('SdI TEST gateway requires the existing openfatture.com domainName and hostedZoneId');
  return { serverCertificateArn, truststoreBucketName, truststoreKey, truststoreVersion, testPeerSha256, providerContext, hostedZoneId, hostname: 'sdi.openfatture.com' };
}

export interface SdiOperatorContext { sdiOperatorTenantId?: string; sdiOperatorReadiness?: SdiOperatorReadiness }

/** Only schema-approved public metadata enters Lambda environment variables. No certificate/key files. */
export function deploymentSdiOperator(tenantContext: unknown, readinessFileContext: unknown): SdiOperatorContext {
  if (tenantContext === undefined && readinessFileContext === undefined) return {};
  if (tenantContext === undefined || readinessFileContext === undefined) throw new Error('sdiOperatorTenantId and sdiReadinessFile must be supplied together');
  if (typeof tenantContext !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(tenantContext)) throw new Error('sdiOperatorTenantId must be a valid company ID');
  if (typeof readinessFileContext !== 'string' || !isAbsolute(readinessFileContext)) throw new Error('sdiReadinessFile must be an absolute path to public operator metadata JSON');
  try {
    if (!statSync(readinessFileContext).isFile() || statSync(readinessFileContext).size > 16_384) throw new Error('Invalid metadata file');
    const readiness = sdiOperatorReadinessSchema.parse(JSON.parse(readFileSync(readinessFileContext, 'utf8')));
    return { sdiOperatorTenantId: tenantContext, sdiOperatorReadiness: readiness };
  } catch {
    // Do not echo file contents, private paths or unknown fields in diagnostics.
    throw new Error('sdiReadinessFile must contain valid public SdI TEST readiness metadata (maximum 16 KiB)');
  }
}
