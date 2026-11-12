import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { TenantState } from '@openfatture/domain';
import { HttpError, VersionConflict } from './errors.js';
import { demoState } from './seed.js';

export type Membership = { tenantId: string; role: 'admin' | 'editor' | 'viewer' };
export interface Store {
  get(tenantId: string): Promise<TenantState | undefined>;
  put(tenantId: string, state: TenantState, expectedVersion: number): Promise<void>;
  memberships(subject: string): Promise<Membership[]>;
}
export class LocalStore implements Store {
  private queue = Promise.resolve();
  constructor(private file: string, private seed = true) {}
  private async all(): Promise<Record<string, TenantState>> {
    try { return JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return this.seed ? { company_demo: demoState() } : {}; }
  }
  async get(tenantId: string) { return (await this.all())[tenantId]; }
  async put(tenantId: string, state: TenantState, expectedVersion: number) {
    // Serialize mutations in the local process; atomic rename prevents torn writes. Use one API process locally.
    const mutation = this.queue.then(async () => {
      const all = await this.all();
      if ((all[tenantId]?.version ?? 0) !== expectedVersion) throw new VersionConflict();
      all[tenantId] = { ...state, version: expectedVersion + 1 };
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(all), { mode: 0o600 });
      await rename(temporary, this.file);
    });
    this.queue = mutation.catch(() => {});
    await mutation;
  }
  async memberships(subject: string): Promise<Membership[]> { return subject === 'demo' ? [{ tenantId: 'company_demo', role: 'admin' }] : []; }
}
export class MemoryStore implements Store {
  constructor(public states: Record<string, TenantState> = { company_demo: demoState() }, public members: Record<string, Membership[]> = { demo: [{ tenantId: 'company_demo', role: 'admin' }] }) {}
  async get(tenantId: string) { return this.states[tenantId] ? structuredClone(this.states[tenantId]) : undefined; }
  async put(tenantId: string, state: TenantState, expectedVersion: number) {
    if ((this.states[tenantId]?.version ?? 0) !== expectedVersion) throw new VersionConflict();
    this.states[tenantId] = structuredClone({ ...state, version: expectedVersion + 1 });
  }
  async memberships(subject: string) { return this.members[subject] ?? []; }
}
export class DynamoStore implements Store {
  private client = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  constructor(private table: string) {}
  async get(tenantId: string) {
    const result = await this.client.send(new GetCommand({ TableName: this.table, Key: { pk: `TENANT#${tenantId}`, sk: 'STATE' }, ConsistentRead: true }));
    return result.Item?.state as TenantState | undefined;
  }
  async put(tenantId: string, state: TenantState, expectedVersion: number) {
    const next = { ...state, version: expectedVersion + 1 };
    if (Buffer.byteLength(JSON.stringify(next)) > 350_000) throw new HttpError(413, 'TENANT_CAPACITY_REACHED', 'Company data reached the MVP storage limit. Export and migrate to per-record storage.');
    try {
      await this.client.send(new PutCommand({ TableName: this.table, Item: { pk: `TENANT#${tenantId}`, sk: 'STATE', version: next.version, state: next }, ConditionExpression: expectedVersion === 0 ? 'attribute_not_exists(pk) OR version = :expected' : 'version = :expected', ExpressionAttributeValues: { ':expected': expectedVersion } }));
    } catch (error) { if ((error as Error).name === 'ConditionalCheckFailedException') throw new VersionConflict(); throw error; }
  }
  async memberships(subject: string): Promise<Membership[]> {
    const members: Membership[] = []; let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new QueryCommand({ TableName: this.table, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)', ExpressionAttributeValues: { ':pk': `USER#${subject}`, ':prefix': 'MEMBERSHIP#' }, ConsistentRead: true, ExclusiveStartKey: cursor }));
      for (const item of result.Items ?? []) if (['admin', 'editor', 'viewer'].includes(item.role)) members.push({ tenantId: item.sk.slice('MEMBERSHIP#'.length), role: item.role });
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    return members;
  }
}
