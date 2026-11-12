import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryStore } from '../src/store.js';
import { demoState } from '../src/seed.js';
const apps: FastifyInstance[] = [];
const now = () => new Date('2026-11-12T12:00:00.000Z');
function app(store = new MemoryStore({ company_demo: demoState(now()) })) { const result = buildApp({ store, env: { AUTH_MODE: 'demo' }, now }); apps.push(result); return result; }
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const documentInput = { clientId: 'client_1', kind: 'invoice', date: '2026-11-12', dueDate: '2026-12-12', lines: [{ description: 'Consulting', quantity: 1.5, unitPriceCents: 10000, vatRate: 22 }], notes: '' };

describe('document and payment workflow', () => {
  it('creates a draft, marks ready without claiming transmission, exports draft XML, records partial/full payment', async () => {
    const api = app();
    const create = await api.inject({ method: 'POST', url: '/api/documents', payload: documentInput });
    expect(create.statusCode).toBe(201); const document = create.json(); expect(document.totalCents).toBe(18300); expect(document.status).toBe('draft');
    const issue = await api.inject({ method: 'POST', url: `/api/documents/${document.id}/issue` });
    expect(issue.json().status).toBe('ready');
    const xml = await api.inject(`/api/documents/${document.id}/xml`); expect(xml.statusCode).toBe(200); expect(xml.headers['x-openfatture-draft']).toBe('true'); expect(xml.body).toContain('DRAFT ONLY'); expect(xml.body).toContain('<PrezzoTotale>150.00</PrezzoTotale>');
    const payment = { documentId: document.id, amountCents: 10000, date: '2026-11-12', method: 'bank_transfer', reference: 'Test' };
    expect((await api.inject({ method: 'POST', url: '/api/payments', payload: payment })).statusCode).toBe(201);
    const overpay = await api.inject({ method: 'POST', url: '/api/payments', payload: payment }); expect(overpay.statusCode).toBe(409); expect(overpay.json().error.code).toBe('OVERPAYMENT');
    expect((await api.inject({ method: 'POST', url: '/api/payments', payload: { ...payment, amountCents: 8300 } })).statusCode).toBe(201);
    const final = (await api.inject(`/api/documents/${document.id}`)).json(); expect(final.status).toBe('paid'); expect(final.paidCents).toBe(18300);
  });
  it('keeps bulk requests local awaiting configuration', async () => {
    const response = await app().inject({ method: 'POST', url: '/api/bulk-jobs', payload: { type: 'invoice_download', dateFrom: '2026-10-01', dateTo: '2026-11-01' } });
    expect(response.statusCode).toBe(201); expect(response.json().status).toBe('awaiting_configuration'); expect(response.json().records).toBe(0);
  });
  it('rejects invalid requests and references with structured errors', async () => {
    const api = app();
    const invalid = await api.inject({ method: 'POST', url: '/api/documents', payload: { ...documentInput, date: 'invalid' } }); expect(invalid.statusCode).toBe(400); expect(invalid.json().error.requestId).toBeTruthy();
    expect((await api.inject({ method: 'POST', url: '/api/documents', payload: { ...documentInput, clientId: 'other-tenant-client' } })).statusCode).toBe(400);
  });
});
describe('tenant isolation and authorization', () => {
  it('forbids arbitrary company selection', async () => { expect((await app().inject({ url: '/api/clients', headers: { 'x-company-id': 'another_company' } })).statusCode).toBe(403); });
  it('allows viewer reads but denies mutation', async () => {
    const store = new MemoryStore({ company_demo: demoState(now()) }, { demo: [{ tenantId: 'company_demo', role: 'viewer' }] }); const api = app(store);
    expect((await api.inject('/api/documents')).statusCode).toBe(200); expect((await api.inject({ method: 'POST', url: '/api/documents', payload: documentInput })).statusCode).toBe(403);
  });
  it('does not expose tenants belonging to another subject', async () => {
    const store = new MemoryStore({ company_demo: demoState(now()) }); const api = buildApp({ store, env: { AUTH_MODE: 'demo' }, authenticate: async () => ({ subject: 'unknown' }) }); apps.push(api);
    expect((await api.inject('/api/companies')).json()).toEqual([]); expect((await api.inject('/api/documents')).statusCode).toBe(403);
  });
  it('rejects production demo mode and incomplete production configuration', () => {
    expect(() => buildApp({ env: { NODE_ENV: 'production', AUTH_MODE: 'demo' } })).toThrow('forbidden');
    expect(() => buildApp({ env: { NODE_ENV: 'production' } })).toThrow('Configure');
  });
  it('does not lose updates to concurrent state writes', async () => {
    const store = new MemoryStore(); const a = (await store.get('company_demo'))!; const b = (await store.get('company_demo'))!;
    await store.put('company_demo', { ...a, sequence: 30 }, a.version);
    await expect(store.put('company_demo', { ...b, sequence: 31 }, b.version)).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect((await store.get('company_demo'))!.sequence).toBe(30);
  });
});

describe('self-host deployment boundary', () => {
  it('requires an explicit pinned company and validates the feature flag', () => {
    expect(() => buildApp({ env: { AUTH_MODE: 'demo', MULTI_TENANT: 'false' } })).toThrow();
    expect(() => buildApp({ env: { AUTH_MODE: 'demo', MULTI_TENANT: 'maybe' } })).toThrow();
  });
  it('restricts company listing and rejects other memberships in a pinned deployment', async () => {
    const state = demoState(now()); const other = structuredClone(state); other.company.id = 'other';
    const store = new MemoryStore({ company_demo: state, other }, { demo: [{ tenantId: 'company_demo', role: 'admin' }, { tenantId: 'other', role: 'admin' }] });
    const api = buildApp({ store, env: { AUTH_MODE: 'demo', MULTI_TENANT: 'false', SELF_HOSTED_COMPANY_ID: 'company_demo' } }); apps.push(api);
    expect((await api.inject('/api/companies')).json().map((c: { id: string }) => c.id)).toEqual(['company_demo']);
    expect((await api.inject('/api/documents')).statusCode).toBe(200);
    expect((await api.inject({ url: '/api/documents', headers: { 'x-company-id': 'other' } })).statusCode).toBe(403);
  });
  it('still requires membership in the pinned company', async () => {
    const api = buildApp({ store: new MemoryStore({}, {}), authenticate: async () => ({ subject: 'unrelated' }), env: { AUTH_MODE: 'demo', MULTI_TENANT: 'false', SELF_HOSTED_COMPANY_ID: 'company_demo' } }); apps.push(api);
    expect((await api.inject('/api/companies')).json()).toEqual([]);
    expect((await api.inject('/api/documents')).statusCode).toBe(403);
  });
});

describe('multiple authorized companies', () => {
  it('lists both memberships and keeps created records isolated in their selected company', async () => {
    const first = demoState(now()); const second = demoState(now()); second.company = { ...second.company, id: 'company_second', name: 'Second company' }; second.documents = [];
    const store = new MemoryStore({ company_demo: first, company_second: second }, { demo: [{ tenantId: 'company_demo', role: 'admin' }, { tenantId: 'company_second', role: 'editor' }] });
    const api = buildApp({ store, env: { AUTH_MODE: 'demo', MULTI_TENANT: 'true' }, now }); apps.push(api);
    expect((await api.inject('/api/companies')).json().map((company: { id: string }) => company.id)).toEqual(['company_demo', 'company_second']);
    const create = await api.inject({ method: 'POST', url: '/api/documents', headers: { 'x-company-id': 'company_second' }, payload: documentInput });
    expect(create.statusCode).toBe(201); const document = create.json();
    expect((await api.inject({ url: '/api/documents', headers: { 'x-company-id': 'company_second' } })).json().map((d: { id: string }) => d.id)).toEqual([document.id]);
    expect((await api.inject({ url: `/api/documents/${document.id}`, headers: { 'x-company-id': 'company_demo' } })).statusCode).toBe(404);
    const primaryDocument = (await api.inject('/api/documents')).json()[0];
    expect((await api.inject({ method: 'POST', url: `/api/documents/${primaryDocument.id}/issue`, headers: { 'x-company-id': 'company_second' } })).statusCode).toBe(404);
    const foreignPayment = await api.inject({ method: 'POST', url: '/api/payments', headers: { 'x-company-id': 'company_demo' }, payload: { documentId: document.id, amountCents: 1, date: '2026-11-12', method: 'bank_transfer' } });
    expect(foreignPayment.statusCode).toBe(400);
  });
  it('reveals FIC configured status only to the company that owns the server token', async () => {
    const state = demoState(now()); const other = structuredClone(state); other.company.id = 'other';
    const store = new MemoryStore({ company_demo: state, other }, { demo: [{ tenantId: 'company_demo', role: 'admin' }, { tenantId: 'other', role: 'admin' }] });
    const api = buildApp({ store, env: { AUTH_MODE: 'demo', FIC_ACCESS_TOKEN: 'test-token-never-used', FIC_TENANT_ID: 'other' } }); apps.push(api);
    expect((await api.inject('/api/integrations')).json().find((i: { id: string }) => i.id === 'fatture-in-cloud').status).toBe('not_configured');
    expect((await api.inject({ url: '/api/integrations', headers: { 'x-company-id': 'other' } })).json().find((i: { id: string }) => i.id === 'fatture-in-cloud').status).toBe('configured');
    expect((await api.inject('/api/integrations/fatture-in-cloud/companies')).statusCode).toBe(503);
  });
});

describe('reliable mutation boundaries', () => {
  it('replays a payment with an idempotency key without recording it twice', async () => {
    const api = app(); const created = (await api.inject({ method: 'POST', url: '/api/documents', payload: documentInput })).json();
    await api.inject({ method: 'POST', url: `/api/documents/${created.id}/issue` });
    const payment = { documentId: created.id, amountCents: created.totalCents, date: '2026-11-12', method: 'bank_transfer' };
    const headers = { 'idempotency-key': 'payment_retry_123' };
    const first = await api.inject({ method: 'POST', url: '/api/payments', headers, payload: payment });
    const retry = await api.inject({ method: 'POST', url: '/api/payments', headers, payload: payment });
    expect(first.statusCode).toBe(201); expect(retry.statusCode).toBe(200); expect(retry.json().id).toBe(first.json().id);
    const payments = (await api.inject('/api/payments')).json().filter((p: { documentId: string }) => p.documentId === created.id);
    expect(payments).toHaveLength(1);
    const reused = await api.inject({ method: 'POST', url: '/api/payments', headers, payload: { ...payment, amountCents: 1 } });
    expect(reused.statusCode).toBe(409); expect(reused.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
  it('returns a client error when a syntactically valid invoice exceeds the supported total', async () => {
    const response = await app().inject({ method: 'POST', url: '/api/documents', payload: { ...documentInput, lines: [{ description: 'Too large', quantity: 10000, unitPriceCents: 1000000000, vatRate: 22 }] } });
    expect(response.statusCode).toBe(422); expect(response.json().error.code).toBe('DOCUMENT_LIMIT_EXCEEDED');
  });
});
