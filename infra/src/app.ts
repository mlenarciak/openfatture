#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { DataStack } from './data-stack.js';
import { ApplicationStack } from './application-stack.js';
import { deploymentFeatures, publicDemoFeature } from './features.js';
import { deploymentCustomDomain } from './custom-domain.js';
import { deploymentSdiGateway, deploymentSdiOperator } from './sdi-gateway-config.js';
import { SdiTestGatewayStack } from './sdi-gateway-stack.js';

const app = new App();
const stage = app.node.tryGetContext('stage') ?? 'dev';
if (!['dev', 'prod'].includes(stage)) throw new Error('stage must be dev or prod');
const features = deploymentFeatures(app.node.tryGetContext('multiTenant'), app.node.tryGetContext('selfHostedCompanyId'));
const publicDemo = publicDemoFeature(app.node.tryGetContext('publicDemo'));
const customDomain = deploymentCustomDomain(app.node.tryGetContext('domainName'), app.node.tryGetContext('hostedZoneId'), app.node.tryGetContext('certificateArn'));
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'eu-south-1' };
const sdiOperator = deploymentSdiOperator(app.node.tryGetContext('sdiOperatorTenantId'), app.node.tryGetContext('sdiReadinessFile'));
const sdiGateway = deploymentSdiGateway(name => app.node.tryGetContext(name), env.region, env.account);
if (sdiGateway && stage !== 'prod') throw new Error('The shared sdi.openfatture.com TEST endpoint requires stage=prod');
const data = new DataStack(app, `Openfatture-${stage}-Data`, { env, terminationProtection: stage === 'prod', description: 'Openfatture retained company data and identities' });
new ApplicationStack(app, `Openfatture-${stage}-App`, { env, data, stage, ...features, ...sdiOperator, publicDemo, customDomain, description: 'Openfatture web application and protected API' });
if (sdiGateway) new SdiTestGatewayStack(app, `Openfatture-${stage}-SdiTest`, { env, config: sdiGateway, terminationProtection: true, description: 'Openfatture isolated SdI TEST-only mTLS SOAP inbox' });
Tags.of(app).add('Application', 'openfatture');
Tags.of(app).add('Environment', stage);
Tags.of(app).add('ManagedBy', 'cdk');
