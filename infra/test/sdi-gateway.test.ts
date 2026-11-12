import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { App, aws_ecs as ecs } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { deploymentSdiGateway, deploymentSdiOperator } from '../src/sdi-gateway-config.js';
import { SdiTestGatewayStack } from '../src/sdi-gateway-stack.js';

// Synthetic identifiers are deliberately confined to offline tests. They must never be deployed.
const env = { account: '111111111111', region: 'eu-south-1' };
const context = {
  sdiGateway: 'true', domainName: 'openfatture.com', hostedZoneId: 'Z1234567890',
  sdiServerCertificateArn: 'arn:aws:acm:eu-south-1:111111111111:certificate/12345678-1234-1234-1234-123456789abc',
  sdiTruststoreBucketName: 'offline-reviewed-ca', sdiTruststoreKey: 'sdi/test/trust/ca.pem', sdiTruststoreVersion: 'offline-version-1',
  sdiTestPeerSha256: 'ab'.repeat(32), sdiProviderContext: 'offline-test-provider',
};
function parse(changes: Record<string, unknown> = {}, region = env.region, account = env.account) {
  const values: Record<string, unknown> = { ...context, ...changes };
  return deploymentSdiGateway(name => values[name], region, account);
}

test('SdI gateway defaults off and requires versioned TEST trust, peer pins and the regional server certificate', () => {
  assert.equal(deploymentSdiGateway(() => undefined, env.region, env.account), undefined);
  assert.equal(deploymentSdiGateway(name => name === 'sdiGateway' ? false : undefined, env.region, env.account), undefined);
  assert.throws(() => parse({ sdiGateway: 'yes' }), /true or false/);
  assert.throws(() => parse({ sdiGateway: false }), /explicit sdiGateway=true/);
  for (const name of ['sdiServerCertificateArn', 'sdiTruststoreBucketName', 'sdiTruststoreKey', 'sdiTruststoreVersion', 'sdiTestPeerSha256', 'sdiProviderContext']) {
    assert.throws(() => parse({ [name]: undefined }), new RegExp(name));
  }
  assert.throws(() => parse({}, 'us-east-1'), /eu-south-1/);
  assert.throws(() => parse({}, env.region, '222222222222'), /deployment account/);
  assert.throws(() => parse({ sdiServerCertificateArn: context.sdiServerCertificateArn.replace('eu-south-1', 'us-east-1') }), /eu-south-1/);
  for (const version of ['null', 'NULL', ' ']) assert.throws(() => parse({ sdiTruststoreVersion: version }), /real S3 version/);
  for (const key of ['/ca.pem', 'a/../ca.pem', 'a//ca.pem', 'a\nca.pem']) assert.throws(() => parse({ sdiTruststoreKey: key }), /safe nonempty/);
  for (const pin of ['', 'sha256:example', 'ab'.repeat(31), `${'ab'.repeat(32)},`]) assert.throws(() => parse({ sdiTestPeerSha256: pin }));
  assert.throws(() => parse({ sdiProviderContext: 'tenant/../../other' }), /sdiProviderContext/);
  assert.throws(() => parse({ domainName: 'example.com' }), /openfatture.com/);
  assert.equal(parse()!.hostname, 'sdi.openfatture.com');
  assert.deepEqual(parse({ sdiTestPeerSha256: Array(32).fill('AB').join(':') })!.testPeerSha256, ['ab'.repeat(32)]);
});

test('SdI metadata requires paired tenant and an absolute schema-approved public JSON file', () => {
  assert.deepEqual(deploymentSdiOperator(undefined, undefined), {});
  assert.throws(() => deploymentSdiOperator('dlt-viaggi', undefined), /supplied together/);
  assert.throws(() => deploymentSdiOperator(undefined, '/tmp/readiness.json'), /supplied together/);
  assert.throws(() => deploymentSdiOperator('bad/company', '/tmp/readiness.json'), /valid company ID/);
  assert.throws(() => deploymentSdiOperator('dlt-viaggi', './readiness.json'), /absolute path/);
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'openfatture-readiness-')), 'public.json');
  const readiness = {
    environment: 'test', certificate: { status: 'received', keyMatch: 'verified', clientCommonName: 'SYNTHETIC CLIENT', serverCommonName: 'sdi.openfatture.com', validFrom: '2026-11-12T00:00:00Z', validUntil: '2029-11-11T00:00:00Z' },
    peerTrust: 'pending', endpoint: { status: 'planned', paths: { receiving: '/test/RicezioneFatture', notifications: '/test/TrasmissioneFatture' } },
    interoperability: 'not_performed', production: { enabled: false },
  };
  writeFileSync(file, JSON.stringify(readiness));
  assert.deepEqual(deploymentSdiOperator('dlt-viaggi', file), { sdiOperatorTenantId: 'dlt-viaggi', sdiOperatorReadiness: readiness });
  for (const invalid of [{ ...readiness, privateKey: 'NEVER ACCEPT PRIVATE MATERIAL' }, { ...readiness, production: { enabled: true } }, { ...readiness, environment: 'production' }]) {
    writeFileSync(file, JSON.stringify(invalid));
    assert.throws(() => deploymentSdiOperator('dlt-viaggi', file), /valid public SdI TEST readiness/);
  }
  writeFileSync(file, 'x'.repeat(16_385));
  assert.throws(() => deploymentSdiOperator('dlt-viaggi', file), /maximum 16 KiB/);
});

test('dedicated receiver verifies mTLS and forwards only test POST paths while preserving full-body container transport', () => {
  const app = new App({ outdir: mkdtempSync(path.join(os.tmpdir(), 'openfatture-sdi-stack-')) });
  const stack = new SdiTestGatewayStack(app, 'OfflineSdiTest', { env, config: parse()!, containerImage: ecs.ContainerImage.fromRegistry(`example.invalid/sdi-gateway@sha256:${'c'.repeat(64)}`), terminationProtection: true });
  const t = Template.fromStack(stack);
  t.resourceCountIs('AWS::ApiGatewayV2::Api', 0);
  t.resourceCountIs('AWS::DynamoDB::Table', 0);
  t.resourceCountIs('AWS::EC2::NatGateway', 0);
  t.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 1);
  t.resourceCountIs('AWS::Route53::RecordSet', 1);
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TrustStore', { CaCertificatesBundleS3Bucket: context.sdiTruststoreBucketName, CaCertificatesBundleS3Key: context.sdiTruststoreKey, CaCertificatesBundleS3ObjectVersion: context.sdiTruststoreVersion });
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
    Port: 443, Protocol: 'HTTPS', Certificates: [{ CertificateArn: context.sdiServerCertificateArn }],
    MutualAuthentication: { Mode: 'verify', TrustStoreArn: Match.anyValue(), IgnoreClientCertificateExpiry: false, AdvertiseTrustStoreCaNames: 'on' },
    DefaultActions: [{ Type: 'fixed-response', FixedResponseConfig: { StatusCode: '403', ContentType: 'text/plain', MessageBody: 'SdI production transport is disabled.' } }],
  });
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
    Conditions: Match.arrayWith([{ Field: 'http-request-method', HttpRequestMethodConfig: { Values: ['POST'] } }, { Field: 'path-pattern', PathPatternConfig: { Values: ['/test/RicezioneFatture', '/test/TrasmissioneFatture'] } }]),
  });
  t.hasResourceProperties('AWS::ECS::TaskDefinition', { Cpu: '256', Memory: '512', NetworkMode: 'awsvpc', ContainerDefinitions: Match.arrayWith([Match.objectLike({ User: '1000:1000', ReadonlyRootFilesystem: true, Privileged: false, VersionConsistency: 'enabled', Environment: Match.arrayWith([{ Name: 'SDI_PROXY_MODE', Value: 'alb' }, { Name: 'SDI_TEST_PEER_SHA256', Value: context.sdiTestPeerSha256 }]), Secrets: Match.absent() })]) });
  t.hasResourceProperties('AWS::ECS::Service', { DesiredCount: 1, EnableExecuteCommand: false, NetworkConfiguration: { AwsvpcConfiguration: { AssignPublicIp: 'ENABLED', SecurityGroups: Match.anyValue(), Subnets: Match.anyValue() } }, DeploymentConfiguration: Match.objectLike({ DeploymentCircuitBreaker: { Enable: true, Rollback: true } }) });
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', { TargetType: 'ip', Port: 8080, HealthCheckPath: '/health' });
  const ingress = Object.values(t.findResources('AWS::EC2::SecurityGroupIngress')).map(r => r.Properties);
  assert.ok(ingress.some(r => r.FromPort === 8080 && r.ToPort === 8080 && r.SourceSecurityGroupId && !r.CidrIp), 'receiver permits only ALB security-group ingress');
  assert.ok(!ingress.some(r => r.FromPort === 8080 && r.CidrIp), 'receiver has no direct CIDR ingress');
  const groups = Object.values(t.findResources('AWS::EC2::SecurityGroup')).map(r => r.Properties);
  for (const group of groups) for (const rule of group.SecurityGroupIngress ?? []) {
    assert.equal(rule.FromPort, 443, 'only ALB HTTPS may have inline public ingress');
    assert.equal(rule.ToPort, 443);
  }
  const policies = Object.values(t.findResources('AWS::IAM::Policy')).map(r => r.Properties.PolicyDocument.Statement).flat();
  const s3Statements = policies.filter(s => JSON.stringify(s.Action).includes('s3:'));
  assert.equal(s3Statements.length, 1);
  assert.deepEqual(s3Statements[0].Action, 's3:PutObject');
  assert.ok(JSON.stringify(s3Statements[0].Resource).includes(`test/${context.sdiProviderContext}/*`));
  assert.equal(s3Statements[0].Condition.StringEquals['s3:x-amz-server-side-encryption'], 'aws:kms');
  const kmsStatements = policies.filter(s => JSON.stringify(s.Action).includes('kms:'));
  assert.equal(kmsStatements.length, 1);
  assert.equal(kmsStatements[0].Condition.StringEquals['kms:ViaService'], 's3.eu-south-1.amazonaws.com');
  assert.ok(JSON.stringify(kmsStatements[0].Condition.StringLike).includes(`test/${context.sdiProviderContext}/*`));
  assert.ok(!JSON.stringify(policies).includes('dynamodb:'), 'test receiver has no ledger access');
  assert.ok(!JSON.stringify(policies).includes('secretsmanager:'), 'TLS private key stays in ACM');
  t.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain', Properties: Match.objectLike({ VersioningConfiguration: { Status: 'Enabled' }, BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: 'aws:kms' }) }] }, PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true } }) });
  t.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', { LoadBalancerAttributes: Match.arrayWith([{ Key: 'deletion_protection.enabled', Value: 'true' }, { Key: 'access_logs.s3.enabled', Value: 'true' }, { Key: 'connection_logs.s3.enabled', Value: 'true' }]) });
  assert.equal(app.synth().stacks.length, 1, 'test gateway has no application/data stack dependencies');
});
