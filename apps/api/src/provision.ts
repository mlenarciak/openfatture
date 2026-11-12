import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { clientInputSchema } from '@openfatture/domain';
import { emptyState } from './seed.js';

const { values } = parseArgs({ options: { 'company-file': { type: 'string' }, subject: { type: 'string' }, role: { type: 'string', default: 'admin' } } });
const table = z.string().min(1).parse(process.env.TABLE_NAME);
const subject = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).parse(values.subject);
const role = z.enum(['admin', 'editor', 'viewer']).parse(values.role);
if (!values['company-file']) throw new Error('Usage: TABLE_NAME=... npm run provision -- --company-file ./company.json --subject <Cognito sub>');
const companyFile = resolve(process.env.INIT_CWD ?? process.cwd(), values['company-file']);
const profile = clientInputSchema.extend({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), taxCode: z.string().regex(/^[A-Z0-9]{11,16}$/), taxRegime: z.string().regex(/^RF\d{2}$/), currency: z.literal('EUR') }).parse(JSON.parse(await readFile(companyFile, 'utf8')));
const state = emptyState(profile.id, profile.name, profile.vatNumber);
state.company = profile;
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
await client.send(new TransactWriteCommand({ TransactItems: [
  { Put: { TableName: table, Item: { pk: `TENANT#${profile.id}`, sk: 'STATE', state, version: 0 }, ConditionExpression: 'attribute_not_exists(pk)' } },
  { Put: { TableName: table, Item: { pk: `USER#${subject}`, sk: `MEMBERSHIP#${profile.id}`, role }, ConditionExpression: 'attribute_not_exists(pk)' } },
] }));
process.stdout.write(`Created company ${profile.id} and ${role} membership. No invoices or demo data loaded.\n`);
