import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { App, aws_lambda as lambda } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DataStack } from '../src/data-stack.js';
import { deploymentFeatures, publicDemoFeature } from '../src/features.js';
import { ApplicationStack } from '../src/application-stack.js';
import { deploymentCustomDomain } from '../src/custom-domain.js';
import { spaRouterCode } from '../src/spa-router.js';
import { runInNewContext } from 'node:vm';

test('cloud deployment retains company data, restricts API access and serves only private S3 origins', () => {
  const app = new App({ outdir: mkdtempSync(path.join(os.tmpdir(), 'openfatture-synth-test-')) });
  const env = { account: '111111111111', region: 'eu-south-1' };
  const data = new DataStack(app, 'TestData', { env, terminationProtection: true });
  const webDirectory = mkdtempSync(path.join(os.tmpdir(), 'openfatture-infra-'));
  writeFileSync(path.join(webDirectory, 'index.html'), '<!doctype html><title>Openfatture</title>');
  const application = new ApplicationStack(app, 'TestApp', { env, data, stage: 'prod', multiTenant: false, selfHostedCompanyId: 'acme', publicDemo: true, webDirectory, apiCode: lambda.Code.fromInline('exports.handler=async()=>({statusCode:200,body:"ok"})') });
  const d = Template.fromStack(data);
  d.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain', Properties: Match.objectLike({ DeletionProtectionEnabled: true, PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } }) });
  d.hasResourceProperties('AWS::Cognito::UserPool', { AdminCreateUserConfig: { AllowAdminCreateUserOnly: true } });
  d.hasResourceProperties('AWS::S3::Bucket', { PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true }, VersioningConfiguration: { Status: 'Enabled' } });
  const a = Template.fromStack(application);
  a.resourceCountIs('AWS::Route53::RecordSet', 0);
  a.hasResourceProperties('AWS::CloudFront::Distribution', { DistributionConfig: { Aliases: Match.absent() } });
  a.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'ANY /api/{proxy+}', AuthorizationType: 'JWT', AuthorizationScopes: ['openid'] });
  a.hasResourceProperties('AWS::Cognito::UserPoolClient', { GenerateSecret: false, AllowedOAuthFlows: ['code'], ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH'], RefreshTokenRotation: { Feature: 'ENABLED', RetryGracePeriodSeconds: 10 }, EnableTokenRevocation: true });
  const jwtAuthorizers = Object.values(a.findResources('AWS::ApiGatewayV2::Authorizer'));
  assert.ok(JSON.stringify(jwtAuthorizers[0].Properties.JwtConfiguration.Issuer).includes('https://cognito-idp.eu-south-1.amazonaws.com/'));
  a.hasResourceProperties('AWS::CloudFront::OriginAccessControl', { OriginAccessControlConfig: Match.objectLike({ SigningBehavior: 'always', SigningProtocol: 'sigv4' }) });
  a.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: Match.objectLike({ NODE_ENV: 'production', AUTH_MODE: 'cognito', MULTI_TENANT: 'false', SELF_HOSTED_COMPANY_ID: 'acme' }) } });
  const assembly = app.synth();
  const configs = readdirSync(assembly.directory).filter(name => name.startsWith('asset.')).map(name => path.join(assembly.directory, name, 'config.json')).filter(file => existsSync(file));
  assert.ok(configs.some(file => JSON.parse(readFileSync(file, 'utf8')).features?.multiTenant === false), 'deployed runtime configuration carries the same tenant feature flag');
  assert.ok(configs.some(file => { const config = JSON.parse(readFileSync(file, 'utf8')); return config.features?.publicDemo === true && config.auth.mode === 'cognito'; }), 'public demo leaves production authentication intact');
  assert.equal(assembly.stacks.length, 2); // Full synthesis catches cross-stack cycles.
});

test('deployment feature flags require explicit valid single-company configuration', () => {
  assert.equal(publicDemoFeature(undefined), false);
  assert.equal(publicDemoFeature('true'), true);
  assert.equal(publicDemoFeature(false), false);
  assert.throws(() => publicDemoFeature('yes'), /true or false/);
  assert.deepEqual(deploymentFeatures(undefined, undefined), { multiTenant: true, selfHostedCompanyId: undefined });
  assert.deepEqual(deploymentFeatures('false', 'acme'), { multiTenant: false, selfHostedCompanyId: 'acme' });
  assert.throws(() => deploymentFeatures('0', 'acme'), /true or false/);
  assert.throws(() => deploymentFeatures(false, undefined), /selfHostedCompanyId/);
  assert.throws(() => deploymentFeatures(false, 'invalid#id'), /selfHostedCompanyId/);
});

const certificateArn = 'arn:aws:acm:us-east-1:111111111111:certificate/12345678-1234-1234-1234-123456789abc';

test('custom DNS requires all context values and an ACM certificate in us-east-1', () => {
  assert.equal(deploymentCustomDomain(undefined, undefined, undefined), undefined);
  assert.deepEqual(deploymentCustomDomain('Openfatture.it', 'Z1234567890', certificateArn), { domainName: 'openfatture.it', hostedZoneId: 'Z1234567890', certificateArn });
  for (const inputs of [['openfatture.it', undefined, undefined], [undefined, 'Z1234567890', certificateArn], ['openfatture.it', 'Z1234567890', undefined]]) {
    assert.throws(() => deploymentCustomDomain(...inputs as [unknown, unknown, unknown]), /supplied together/);
  }
  for (const domainName of ['https://openfatture.it', '*.openfatture.it', 'openfatture.it/path', 'openfatture.it.', '-invalid.it', 'localhost', '']) {
    assert.throws(() => deploymentCustomDomain(domainName, 'Z1234567890', certificateArn), /fully qualified DNS/);
  }
  assert.throws(() => deploymentCustomDomain('openfatture.it', 'invalid-zone', certificateArn), /hosted zone ID/);
  assert.throws(() => deploymentCustomDomain('openfatture.it', 'Z1234567890', certificateArn.replace('us-east-1', 'eu-south-1')), /us-east-1/);
});

test('custom domain attaches TLS and A plus AAAA aliases and keeps auth and API origins aligned', () => {
  const app = new App({ outdir: mkdtempSync(path.join(os.tmpdir(), 'openfatture-domain-test-')) });
  const env = { account: '111111111111', region: 'eu-south-1' };
  const data = new DataStack(app, 'DomainData', { env });
  const webDirectory = mkdtempSync(path.join(os.tmpdir(), 'openfatture-web-test-'));
  writeFileSync(path.join(webDirectory, 'index.html'), '<!doctype html><title>Openfatture</title>');
  const customDomain = deploymentCustomDomain('openfatture.it', 'Z1234567890', certificateArn)!;
  const application = new ApplicationStack(app, 'DomainApp', { env, data, stage: 'prod', customDomain, webDirectory, apiCode: lambda.Code.fromInline('exports.handler=async()=>({statusCode:200,body:"ok"})') });
  const template = Template.fromStack(application);
  template.hasResourceProperties('AWS::CloudFront::Distribution', { DistributionConfig: Match.objectLike({ Aliases: ['openfatture.it'], IPV6Enabled: true, ViewerCertificate: Match.objectLike({ AcmCertificateArn: certificateArn, SslSupportMethod: 'sni-only' }) }) });
  for (const type of ['A', 'AAAA']) template.hasResourceProperties('AWS::Route53::RecordSet', { HostedZoneId: 'Z1234567890', Name: 'openfatture.it.', Type: type, AliasTarget: Match.objectLike({ HostedZoneId: Match.anyValue(), DNSName: { 'Fn::GetAtt': [Match.stringLikeRegexp('^WebDistribution'), 'DomainName'] } }) });
  template.resourceCountIs('AWS::Route53::HostedZone', 0);
  template.resourceCountIs('AWS::CertificateManager::Certificate', 0);
  template.hasResourceProperties('AWS::Cognito::UserPoolClient', { CallbackURLs: Match.arrayWith(['https://openfatture.it/auth/callback']), LogoutURLs: Match.arrayWith(['https://openfatture.it/']) });
  template.hasResourceProperties('AWS::ApiGatewayV2::Api', { CorsConfiguration: { AllowOrigins: Match.arrayWith(['https://openfatture.it']) } });
  template.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: Match.objectLike({ CORS_ORIGINS: Match.anyValue() }) } });
  const poolClient = Object.values(template.findResources('AWS::Cognito::UserPoolClient'))[0]!;
  assert.equal(poolClient.Properties.CallbackURLs.length, 2, 'CloudFront callback remains allowed');
  assert.ok(JSON.stringify(poolClient.Properties.CallbackURLs).includes('DomainName'), 'CloudFront hostname remains an allowed auth callback');
  const assembly = app.synth();
  const configs = readdirSync(assembly.directory).filter(name => name.startsWith('asset.')).map(name => path.join(assembly.directory, name, 'config.json')).filter(file => existsSync(file));
  assert.ok(configs.some(file => { const config = JSON.parse(readFileSync(file, 'utf8')); return config.auth.redirectUri === 'https://openfatture.it/auth/callback' && config.auth.logoutUri === 'https://openfatture.it/'; }));
});

test('CloudFront canonical redirect preserves path and repeated encoded query parameters before PKCE starts', () => {
  const request = { uri: '/documents', headers: { host: { value: 'd123.cloudfront.net' } }, querystring: { q: { value: 'fattura%20uno' }, tag: { value: 'a', multiValue: [{ value: 'a' }, { value: 'b%2Bc' }] } } };
  const result = runInNewContext(`${spaRouterCode('openfatture.it')}; handler(event);`, { event: { request } });
  assert.equal(result.statusCode, 302);
  assert.equal(result.headers.location.value, 'https://openfatture.it/documents?q=fattura%20uno&tag=a&tag=b%2Bc');
  assert.equal(result.headers['cache-control'].value, 'no-store');
  assert.equal(request.uri, '/documents', 'redirect happens before the SPA rewrite');
  const canonical = { uri: '/auth/callback', headers: { host: { value: 'openfatture.it' } }, querystring: { code: { value: 'abc' } } };
  const forwarded = runInNewContext(`${spaRouterCode('openfatture.it')}; handler(event);`, { event: { request: canonical } });
  assert.equal(forwarded.uri, '/index.html');
  assert.equal(forwarded.querystring.code.value, 'abc');
  const asset = { uri: '/assets/app.js', headers: { host: { value: 'openfatture.it' } }, querystring: {} };
  assert.equal(runInNewContext(`${spaRouterCode('openfatture.it')}; handler(event);`, { event: { request: asset } }).uri, '/assets/app.js');
});
