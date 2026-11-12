#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { DataStack } from './data-stack.js';
import { ApplicationStack } from './application-stack.js';
import { deploymentFeatures } from './features.js';

const app = new App();
const stage = app.node.tryGetContext('stage') ?? 'dev';
if (!['dev', 'prod'].includes(stage)) throw new Error('stage must be dev or prod');
const features = deploymentFeatures(app.node.tryGetContext('multiTenant'), app.node.tryGetContext('selfHostedCompanyId'));
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'eu-south-1' };
const data = new DataStack(app, `Openfatture-${stage}-Data`, { env, terminationProtection: stage === 'prod', description: 'Openfatture retained company data and identities' });
new ApplicationStack(app, `Openfatture-${stage}-App`, { env, data, stage, ...features, description: 'Openfatture web application and protected API' });
Tags.of(app).add('Application', 'openfatture');
Tags.of(app).add('Environment', stage);
Tags.of(app).add('ManagedBy', 'cdk');
