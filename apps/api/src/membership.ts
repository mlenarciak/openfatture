import { parseArgs } from 'node:util';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

// Run only with an AWS administrator role authorized to manage memberships. No browser API exposes this operation.
const { values } = parseArgs({ options: { action: { type: 'string' }, 'company-id': { type: 'string' }, subject: { type: 'string' }, role: { type: 'string' } } });
const table = z.string().min(1).parse(process.env.TABLE_NAME);
const action = z.enum(['grant', 'revoke']).parse(values.action);
const companyId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).parse(values['company-id']);
const subject = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).parse(values.subject);
const key = { pk: `USER#${subject}`, sk: `MEMBERSHIP#${companyId}` };
const role = action === 'grant' ? z.enum(['admin', 'editor', 'viewer']).parse(values.role) : undefined;
if (action === 'revoke' && values.role) throw new Error('--role is only valid for grant');
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
await client.send(new TransactWriteCommand({ TransactItems: [
  { ConditionCheck: { TableName: table, Key: { pk: `TENANT#${companyId}`, sk: 'STATE' }, ConditionExpression: 'attribute_exists(pk)' } },
  action === 'grant'
    ? { Put: { TableName: table, Item: { ...key, role }, ConditionExpression: 'attribute_not_exists(pk)' } }
    : { Delete: { TableName: table, Key: key, ConditionExpression: 'attribute_exists(pk)' } },
] }));
process.stdout.write(`${action === 'grant' ? `Granted ${role}` : 'Revoked'} membership for subject ${subject} in company ${companyId}. Company data was not modified.\n`);
