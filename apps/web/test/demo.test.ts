import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client, Company, Document, Payment } from '@openfatture/domain';
import { DEMO_STORAGE_KEY, demoRequest, demoXml, resetDemoWorkspace } from '../src/demo';
class SessionStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
}
const noNetwork = vi.fn(() => { throw new Error('The browser demo must not use the network'); });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-12T12:00:00.000Z')); vi.stubGlobal('sessionStorage', new SessionStorage()); vi.stubGlobal('fetch', noNetwork); noNetwork.mockClear(); });
afterEach(() => { expect(noNetwork).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function createInvoice(options: { notes?: string; description?: string; kind?: string } = {}, companyId?: string) {
  const clients = await demoRequest<Client[]>('/api/clients', {}, companyId);
  return demoRequest<Document>('/api/documents', { method: 'POST', body: JSON.stringify({ clientId: clients[0]!.id, kind: options.kind ?? 'invoice', date: '2026-11-12', dueDate: '2026-12-12', lines: [{ description: options.description ?? 'Fractional example', quantity: 1.005, unitPriceCents: 100, vatRate: 22 }], notes: options.notes ?? '' }) }, companyId);
}
describe('browser-only workspace', () => {
  it('provides invented fixtures, isolates tabs, persists the active tab, and resets only that tab', async () => {
    const tabOne = globalThis.sessionStorage;
    const original = await demoRequest<Document[]>('/api/documents');
    const document = await createInvoice();
    expect((await demoRequest<Document[]>('/api/documents')).some(value => value.id === document.id)).toBe(true);
    const companies = await demoRequest<Company[]>('/api/companies'); expect(companies).toHaveLength(2); expect(companies.every(company => company.vatNumber === '00000000000')).toBe(true);
    vi.stubGlobal('sessionStorage', new SessionStorage());
    expect((await demoRequest<Document[]>('/api/documents')).some(value => value.id === document.id)).toBe(false);
    expect(await demoRequest<Document[]>('/api/documents')).toHaveLength(original.length);
    vi.stubGlobal('sessionStorage', tabOne);
    expect((await demoRequest<Document[]>('/api/documents')).some(value => value.id === document.id)).toBe(true);
    resetDemoWorkspace();
    expect(await demoRequest<Document[]>('/api/documents')).toHaveLength(original.length);
    expect((await demoRequest<Document[]>('/api/documents')).some(value => value.id === document.id)).toBe(false);
  });
  it('recovers corrupt, obsolete, and structurally invalid storage into safe fixtures', async () => {
    for (const raw of ['{malformed', JSON.stringify({ schemaVersion: 999, tenants: [] }), JSON.stringify({ schemaVersion: 1, tenants: [{ company: { name: { unsafe: true } } }] })]) {
      sessionStorage.setItem(DEMO_STORAGE_KEY, raw);
      const companies = await demoRequest<Company[]>('/api/companies'); expect(companies).toHaveLength(2);
      expect(JSON.parse(sessionStorage.getItem(DEMO_STORAGE_KEY)!).schemaVersion).toBe(1);
    }
    const snapshot = JSON.parse(sessionStorage.getItem(DEMO_STORAGE_KEY)!);
    const originalTotal = snapshot.tenants[0].documents[0].totalCents;
    snapshot.tenants[0].documents[0].totalCents += 1;
    sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(snapshot));
    expect((await demoRequest<Document[]>('/api/documents'))[0]!.totalCents).toBe(originalTotal);
  });
  it('rejects unknown company selection and keeps two demo companies isolated', async () => {
    const companies = await demoRequest<Company[]>('/api/companies'); const second = companies[1]!.id;
    const document = await createInvoice({}, second);
    expect(await demoRequest<Document>(`/api/documents/${document.id}`, {}, second)).toMatchObject({ id: document.id });
    await expect(demoRequest(`/api/documents/${document.id}`)).rejects.toMatchObject({ status: 404 });
    await expect(demoRequest('/api/documents', {}, 'real_company')).rejects.toMatchObject({ status: 403 });
  });
  it('returns independent objects so callers cannot mutate persisted state through references', async () => {
    const documents = await demoRequest<Document[]>('/api/documents'); const id = documents[0]!.id;
    documents[0]!.status = 'rejected'; documents[0]!.lines[0]!.unitPriceCents = 999;
    const fresh = await demoRequest<Document>(`/api/documents/${id}`); expect(fresh.status).not.toBe('rejected'); expect(fresh.lines[0]!.unitPriceCents).not.toBe(999);
  });
});
describe('local invoicing behavior', () => {
  it('uses integer-cent rounding, only marks ready, and keeps XML visibly draft with escaped content', async () => {
    const document = await createInvoice({ description: '<script>alert("x")</script> & sample', notes: '"sample" <tag> & data\u0001' });
    expect(document).toMatchObject({ status: 'draft', netCents: 101, vatCents: 22, totalCents: 123 });
    const ready = await demoRequest<Document>(`/api/documents/${document.id}/issue`, { method: 'POST' }); expect(ready.status).toBe('ready');
    await expect(demoRequest(`/api/documents/${document.id}/issue`, { method: 'POST' })).rejects.toMatchObject({ status: 409 });
    const xml = demoXml(document.id); expect(xml).toContain('DRAFT ONLY'); expect(xml).toContain('DEMO SINTETICA'); expect(xml).toContain('&lt;script&gt;'); expect(xml).toContain('&amp; sample'); expect(xml).not.toContain('<script>'); expect(xml).not.toContain('\u0001');
    expect(xml).toContain('<PrezzoTotale>1.01</PrezzoTotale>');
  });
  it('validates mutations before changing the stored workspace', async () => {
    const before = await demoRequest<Document[]>('/api/documents');
    await expect(demoRequest('/api/documents', { method: 'POST', body: JSON.stringify({ clientId: 'invalid', date: '2026-02-30', dueDate: '2026-01-01', lines: [] }) })).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    await expect(demoRequest('/api/documents', { method: 'POST', body: '{broken' })).rejects.toMatchObject({ status: 400 });
    expect(await demoRequest<Document[]>('/api/documents')).toHaveLength(before.length);
    const quote = await createInvoice({ kind: 'quote' }); expect(() => demoXml(quote.id)).toThrow();
  });
  it('records payments idempotently and rejects changed retries or overpayments', async () => {
    const document = await createInvoice(); await demoRequest(`/api/documents/${document.id}/issue`, { method: 'POST' });
    const payload = { documentId: document.id, amountCents: 123, date: '2026-11-12', method: 'bank_transfer' };
    const options = { method: 'POST', headers: { 'Idempotency-Key': 'k'.repeat(128) }, body: JSON.stringify(payload) };
    const first = await demoRequest<Payment>('/api/payments', options); const retry = await demoRequest<Payment>('/api/payments', options); expect(retry.id).toBe(first.id);
    expect((await demoRequest<Payment[]>('/api/payments')).filter(payment => payment.documentId === document.id)).toHaveLength(1);
    expect((await demoRequest<Document>(`/api/documents/${document.id}`)).status).toBe('paid');
    await expect(demoRequest('/api/payments', { ...options, body: JSON.stringify({ ...payload, amountCents: 1 }) })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    await expect(demoRequest('/api/payments', { method: 'POST', body: JSON.stringify(payload) })).rejects.toMatchObject({ code: 'OVERPAYMENT' });
  });
  it('leaves all fiscal integrations disabled and all mass requests unsent', async () => {
    const job = await demoRequest<{ status: string; records: number; message: string }>('/api/bulk-jobs', { method: 'POST', body: JSON.stringify({ type: 'invoice_download', dateFrom: '2026-10-01', dateTo: '2026-11-01' }) });
    expect(job).toMatchObject({ status: 'awaiting_configuration', records: 0 }); expect(job.message).toContain('Nessun invio');
    const integrations = await demoRequest<{ status: string }[]>('/api/integrations'); expect(integrations.every(integration => integration.status !== 'configured')).toBe(true);
    await expect(demoRequest('/api/integrations/fatture-in-cloud/companies')).rejects.toMatchObject({ status: 503 });
  });
});
