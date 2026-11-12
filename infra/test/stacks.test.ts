import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { App, aws_lambda as lambda } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DataStack } from '../src/data-stack.js';
import { deploymentFeatures } from '../src/features.js';
import { ApplicationStack } from '../src/application-stack.js';

test('cloud deployment retains company data, restricts API access and serves only private S3 origins', () => {
  const app = new App();
  const env = { account: '111111111111', region: 'eu-south-1' };
  const data = new DataStack(app, 'TestData', { env, terminationProtection: true });
  const webDirectory = mkdtempSync(path.join(os.tmpdir(), 'openfatture-infra-'));
  writeFileSync(path.join(webDirectory, 'index.html'), '<!doctype html><title>Openfatture</title>');
  const application = new ApplicationStack(app, 'TestApp', { env, data, stage: 'prod', multiTenant: false, selfHostedCompanyId: 'acme', webDirectory, apiCode: lambda.Code.fromInline('exports.handler=async()=>({statusCode:200,body:"ok"})') });
  const d = Template.fromStack(data);
  d.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain', Properties: Match.objectLike({ DeletionProtectionEnabled: true, PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } }) });
  d.hasResourceProperties('AWS::Cognito::UserPool', { AdminCreateUserConfig: { AllowAdminCreateUserOnly: true } });
  d.hasResourceProperties('AWS::S3::Bucket', { PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true }, VersioningConfiguration: { Status: 'Enabled' } });
  const a = Template.fromStack(application);
  a.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'ANY /api/{proxy+}', AuthorizationType: 'JWT', AuthorizationScopes: ['openid'] });
  a.hasResourceProperties('AWS::Cognito::UserPoolClient', { GenerateSecret: false, AllowedOAuthFlows: ['code'], ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH'], RefreshTokenRotation: { Feature: 'ENABLED', RetryGracePeriodSeconds: 10 }, EnableTokenRevocation: true });
  const jwtAuthorizers = Object.values(a.findResources('AWS::ApiGatewayV2::Authorizer'));
  assert.ok(JSON.stringify(jwtAuthorizers[0].Properties.JwtConfiguration.Issuer).includes('https://cognito-idp.eu-south-1.amazonaws.com/'));
  a.hasResourceProperties('AWS::CloudFront::OriginAccessControl', { OriginAccessControlConfig: Match.objectLike({ SigningBehavior: 'always', SigningProtocol: 'sigv4' }) });
  a.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: Match.objectLike({ NODE_ENV: 'production', AUTH_MODE: 'cognito', MULTI_TENANT: 'false', SELF_HOSTED_COMPANY_ID: 'acme' }) } });
  const assembly = app.synth();
  const configs = readdirSync(assembly.directory).filter(name => name.startsWith('asset.')).map(name => path.join(assembly.directory, name, 'config.json')).filter(file => existsSync(file));
  assert.ok(configs.some(file => JSON.parse(readFileSync(file, 'utf8')).features?.multiTenant === false), 'deployed runtime configuration carries the same tenant feature flag');
  assert.equal(assembly.stacks.length, 2); // Full synthesis catches cross-stack cycles.
});

test('deployment feature flags require explicit valid single-company configuration', () => {
  assert.deepEqual(deploymentFeatures(undefined, undefined), { multiTenant: true, selfHostedCompanyId: undefined });
  assert.deepEqual(deploymentFeatures('false', 'acme'), { multiTenant: false, selfHostedCompanyId: 'acme' });
  assert.throws(() => deploymentFeatures('0', 'acme'), /true or false/);
  assert.throws(() => deploymentFeatures(false, undefined), /selfHostedCompanyId/);
  assert.throws(() => deploymentFeatures(false, 'invalid#id'), /selfHostedCompanyId/);
});
