import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStore } from '../src/store.js';
import { demoState } from '../src/seed.js';
import type { SdiOperatorReadiness } from '@openfatture/domain';

const readiness: SdiOperatorReadiness = {
  environment: 'test',
  certificate: { status: 'received', keyMatch: 'verified', clientCommonName: 'SDI-11111111111', serverCommonName: 'sdi.example.test', validFrom: '2026-01-01T00:00:00Z', validUntil: '2029-01-01T00:00:00Z' },
  peerTrust: 'pending', endpoint: { status: 'planned', baseUrl: 'https://sdi.example.test', paths: { receiving: '/test/RicezioneFatture', notifications: '/test/TrasmissioneFatture' } },
  interoperability: 'not_performed', production: { enabled: false },
};
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
function configured(role: 'admin' | 'editor' | 'viewer' = 'admin', overrides: NodeJS.ProcessEnv = {}) {
  const operator = demoState(); operator.company.id = 'operator';
  const other = demoState(); other.company.id = 'other';
  const store = new MemoryStore({ operator, other }, { user: [{ tenantId: 'operator', role }, { tenantId: 'other', role: 'admin' }] });
  const app = buildApp({ store, authenticate: async () => ({ subject: 'user' }), env: { AUTH_MODE: 'cognito', SDI_OPERATOR_TENANT_ID: 'operator', SDI_OPERATOR_READINESS_JSON: JSON.stringify(readiness), ...overrides } });
  apps.push(app); return app;
}
describe('SdI operator certificate metadata boundary', () => {
  it('shows readiness only to the operator tenant administrator and keeps SMTS unconfigured', async () => {
    const app = configured();
    const own = (await app.inject({ url: '/api/integrations', headers: { 'x-company-id': 'operator' } })).json();
    expect(own.find((item: { id: string }) => item.id === 'sdi-channel').operatorReadiness).toEqual(readiness);
    expect(own.find((item: { id: string }) => item.id === 'sdicoop')).not.toHaveProperty('operatorReadiness');
    expect(own.find((item: { id: string }) => item.id === 'sdicoop').status).toBe('not_configured');
    const foreign = await app.inject({ url: '/api/integrations', headers: { 'x-company-id': 'other' } });
    expect(foreign.statusCode).toBe(200);
    expect(foreign.body).not.toContain('SDI-11111111111');
    expect(foreign.json().find((item: { id: string }) => item.id === 'sdi-channel')).not.toHaveProperty('operatorReadiness');
    expect((await app.inject({ url: '/api/integrations', headers: { 'x-company-id': 'unrelated' } })).statusCode).toBe(403);
  });
  it.each(['editor', 'viewer'] as const)('does not expose channel identity to an operator %s', async role => {
    const response = await configured(role).inject('/api/integrations');
    expect(response.statusCode).toBe(200); expect(response.body).not.toContain('operatorReadiness');
  });
  it('does not expose real operator metadata in demo mode', async () => {
    expect((await configured('admin', { AUTH_MODE: 'demo' }).inject('/api/integrations')).body).not.toContain('operatorReadiness');
  });
  it('rejects incomplete, secret-bearing, unsafe-URL or production-enabled readiness configuration', () => {
    expect(() => configured('admin', { SDI_OPERATOR_TENANT_ID: '' })).toThrow();
    for (const value of [
      { ...readiness, privateKey: 'must never appear in API output' },
      { ...readiness, endpoint: { ...readiness.endpoint, baseUrl: 'javascript:alert(1)' } },
      { ...readiness, production: { enabled: true } },
    ]) expect(() => configured('admin', { SDI_OPERATOR_READINESS_JSON: JSON.stringify(value) })).toThrow();
  });
});
