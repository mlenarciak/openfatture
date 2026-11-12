import { z } from 'zod';
import {
  bulkJobInputSchema, calculateTotals, clientInputSchema, documentInputSchema, documentStatuses,
  paymentInputSchema, type Dashboard, type Integration, type TenantState,
} from '@openfatture/domain';
import { createDemoTenants, demoCompanyIds } from './demo-fixtures';
import { createDemoXml } from './demo-xml';

export const DEMO_STORAGE_KEY = 'openfatture.browser-demo.v1';
const storageVersion = 1;
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/);
const cents = z.number().int().min(0).max(1_000_000_000);
const timestamp = z.iso.datetime();
const clientSchema = clientInputSchema.safeExtend({ id: identifier, createdAt: timestamp });
const companySchema = clientInputSchema.safeExtend({ id: z.enum(demoCompanyIds), taxCode: z.string().regex(/^[A-Z0-9]{11,16}$/), currency: z.literal('EUR'), taxRegime: z.string().regex(/^RF\d{2}$/) });
const documentSchema = documentInputSchema.safeExtend({ id: identifier, number: z.string().min(1).max(100), clientName: z.string().min(1).max(160), status: z.enum(documentStatuses), netCents: cents, vatCents: cents, totalCents: cents, paidCents: cents, createdAt: timestamp, updatedAt: timestamp, version: z.number().int().positive() }).refine(document => {
  try { const totals = calculateTotals(document.lines); return document.netCents === totals.netCents && document.vatCents === totals.vatCents && document.totalCents === totals.totalCents && document.paidCents <= document.totalCents; }
  catch { return false; }
});
const paymentSchema = paymentInputSchema.safeExtend({ id: identifier, clientName: z.string().min(1).max(160), documentNumber: z.string().min(1).max(100), createdAt: timestamp });
const bulkSchema = bulkJobInputSchema.safeExtend({ id: identifier, status: z.literal('awaiting_configuration'), createdAt: timestamp, message: z.string().max(1000), records: z.literal(0) });
const tenantSchema = z.object({ company: companySchema, clients: z.array(clientSchema).max(500), documents: z.array(documentSchema).max(500), payments: z.array(paymentSchema).max(1000), bulkJobs: z.array(bulkSchema).max(200), sequence: z.number().int().min(0).max(1000000), version: z.number().int().min(0) }).refine(tenant => {
  const clients = new Set(tenant.clients.map(client => client.id));
  const documents = new Map(tenant.documents.map(document => [document.id, document]));
  return clients.size === tenant.clients.length && documents.size === tenant.documents.length && tenant.documents.every(document => clients.has(document.clientId)) && tenant.payments.every(payment => documents.has(payment.documentId));
});
const snapshotSchema = z.object({ schemaVersion: z.literal(storageVersion), tenants: z.array(tenantSchema).length(demoCompanyIds.length) }).refine(snapshot => new Set(snapshot.tenants.map(tenant => tenant.company.id)).size === demoCompanyIds.length);
type Snapshot = { schemaVersion: 1; tenants: TenantState[] };

export class DemoError extends Error {
  readonly requestId = `demo-${crypto.randomUUID()}`;
  constructor(public status: number, public code: string, message: string) { super(message); this.name = 'DemoError'; }
}
function storage(): Storage {
  try { return globalThis.sessionStorage; }
  catch { throw new DemoError(503, 'DEMO_STORAGE_UNAVAILABLE', 'Consenti la memoria di sessione del browser per provare la demo.'); }
}
function write(snapshot: Snapshot): void {
  const checked = snapshotSchema.safeParse(snapshot);
  if (!checked.success) throw new DemoError(413, 'DEMO_CAPACITY_REACHED', 'La demo ha raggiunto il limite locale. Ripristina i dati di esempio per continuare.');
  try { storage().setItem(DEMO_STORAGE_KEY, JSON.stringify(checked.data)); }
  catch (error) { if (error instanceof DemoError) throw error; throw new DemoError(507, 'DEMO_STORAGE_FULL', 'Memoria della demo non disponibile. Ripristina i dati di esempio o consenti la memoria di sessione.'); }
}
function read(): Snapshot {
  let raw: string | null;
  try { raw = storage().getItem(DEMO_STORAGE_KEY); }
  catch (error) { if (error instanceof DemoError) throw error; throw new DemoError(503, 'DEMO_STORAGE_UNAVAILABLE', 'La memoria di sessione non è disponibile.'); }
  if (raw && raw.length <= 2_000_000) {
    try { const result = snapshotSchema.safeParse(JSON.parse(raw)); if (result.success) return result.data; }
    catch { /* Invalid or obsolete browser state is replaced with synthetic fixtures below. */ }
  }
  const fresh: Snapshot = { schemaVersion: storageVersion, tenants: createDemoTenants() };
  write(fresh);
  return fresh;
}
function selected(snapshot: Snapshot, companyId?: string): TenantState {
  const tenant = snapshot.tenants.find(tenant => tenant.company.id === (companyId ?? demoCompanyIds[0]));
  if (!tenant) throw new DemoError(403, 'COMPANY_FORBIDDEN', 'Questa azienda non appartiene alla demo.');
  return tenant;
}
function body(options: RequestInit): unknown {
  if (typeof options.body !== 'string' || options.body.length > 256 * 1024) throw new DemoError(400, 'VALIDATION_ERROR', 'Controlla i dati inseriti.');
  try { return JSON.parse(options.body); }
  catch { throw new DemoError(400, 'VALIDATION_ERROR', 'I dati inseriti non sono validi.'); }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DemoError(400, 'VALIDATION_ERROR', 'Controlla i dati inseriti: campi obbligatori, date e importi devono essere validi.');
  return result.data;
}
function findDocument(tenant: TenantState, id: string) {
  const document = tenant.documents.find(document => document.id === id);
  if (!document) throw new DemoError(404, 'DOCUMENT_NOT_FOUND', 'Documento non trovato nella demo selezionata.');
  return document;
}
function save(snapshot: Snapshot, tenant: TenantState) { tenant.version += 1; write(snapshot); }
const disabledIntegrations: Integration[] = [
  { id: 'sdi-channel', name: 'Canale SdI · Ambiente di test', status: 'not_configured', description: 'Solo simulazione. Certificati operatore ed endpoint riservati non sono disponibili nella demo; nessun invio o ricezione fiscale.', capabilities: ['Ricezione e notifiche (simulazione)', 'Produzione disabilitata'] },
  { id: 'sdicoop', name: 'Agenzia delle Entrate · SMTS', status: 'not_configured', description: 'Demo senza collegamento all’Agenzia. Le richieste restano in questa scheda.', capabilities: ['Download fatture (simulazione locale)', 'Corrispettivi (simulazione locale)', 'Elenchi bollo A/B (simulazione locale)'] },
  { id: 'fatture-in-cloud', name: 'Fatture in Cloud', status: 'not_configured', description: 'Integrazione disattivata nella demo. Nessuna credenziale richiesta.', capabilities: [] },
  { id: 'conservation', name: 'Conservazione digitale', status: 'unavailable', description: 'Conservazione a norma non disponibile nella demo.', capabilities: [] },
];

/** Browser-only synthetic workspace. This adapter never sends requests or reads authentication credentials. */
export async function demoRequest<T>(path: string, options: RequestInit = {}, companyId?: string): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new DemoError(404, 'NOT_FOUND', 'Percorso demo non disponibile.');
  const url = new URL(path, 'https://demo.openfatture.invalid');
  const method = (options.method ?? 'GET').toUpperCase();
  const snapshot = read();
  if (url.pathname === '/health' && method === 'GET') return { status: 'ok', mode: 'demo', deploymentMode: 'multi_tenant' } as T;
  if (url.pathname === '/api/companies' && method === 'GET') return structuredClone(snapshot.tenants.map(tenant => tenant.company)) as T;
  const tenant = selected(snapshot, companyId);
  let result: unknown;
  switch (`${method} ${url.pathname}`) {
    case 'GET /api/dashboard': result = dashboard(tenant); break;
    case 'GET /api/clients': result = tenant.clients; break;
    case 'POST /api/clients': {
      const input = parse(clientInputSchema, body(options));
      if (tenant.clients.some(client => client.vatNumber === input.vatNumber)) throw new DemoError(409, 'CLIENT_EXISTS', 'Esiste già un cliente con questa partita IVA.');
      result = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
      tenant.clients.unshift(result as TenantState['clients'][number]); save(snapshot, tenant); break;
    }
    case 'GET /api/documents': {
      const search = url.searchParams.get('search')?.toLocaleLowerCase(); const status = url.searchParams.get('status'); const kind = url.searchParams.get('kind');
      result = tenant.documents.filter(document => (!status || document.status === status) && (!kind || document.kind === kind) && (!search || `${document.number} ${document.clientName}`.toLocaleLowerCase().includes(search))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); break;
    }
    case 'POST /api/documents': {
      const input = parse(documentInputSchema, body(options)); const client = tenant.clients.find(client => client.id === input.clientId);
      if (!client) throw new DemoError(400, 'INVALID_CLIENT', 'Scegli un cliente di questa azienda demo.');
      let totals; try { totals = calculateTotals(input.lines); } catch { throw new DemoError(422, 'DOCUMENT_LIMIT_EXCEEDED', 'L’importo supera il limite supportato.'); }
      const timestamp = new Date().toISOString(); tenant.sequence += 1;
      const document = { ...input, ...totals, id: crypto.randomUUID(), number: `${String(tenant.sequence).padStart(3, '0')}/${input.date.slice(0, 4)}`, clientName: client.name, status: 'draft' as const, paidCents: 0, createdAt: timestamp, updatedAt: timestamp, version: 1 };
      tenant.documents.unshift(document); result = document; save(snapshot, tenant); break;
    }
    case 'GET /api/payments': result = tenant.payments.sort((a, b) => b.date.localeCompare(a.date)); break;
    case 'POST /api/payments': {
      const input = parse(paymentInputSchema, body(options));
      const rawKey = new Headers(options.headers).get('Idempotency-Key');
      const key = rawKey === null ? undefined : parse(z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/), rawKey);
      const paymentId = key ? `idem_${key}` : crypto.randomUUID();
      // Keys live only in this company's tab-local state. They are never shared with an API.
      const existing = tenant.payments.find(payment => payment.id === paymentId);
      if (existing) {
        if (existing.documentId !== input.documentId || existing.amountCents !== input.amountCents || existing.date !== input.date || existing.method !== input.method || existing.reference !== input.reference) throw new DemoError(409, 'IDEMPOTENCY_KEY_REUSED', 'Questa chiave è già stata usata per un altro pagamento.');
        result = existing; break;
      }
      const document = tenant.documents.find(document => document.id === input.documentId);
      if (!document) throw new DemoError(400, 'INVALID_DOCUMENT', 'Documento non disponibile in questa azienda demo.');
      if (document.kind !== 'invoice' || ['draft', 'rejected'].includes(document.status)) throw new DemoError(409, 'DOCUMENT_NOT_PAYABLE', 'Segna la fattura come pronta prima di registrare un incasso.');
      if (input.amountCents > document.totalCents - document.paidCents) throw new DemoError(409, 'OVERPAYMENT', 'L’incasso supera l’importo ancora da saldare.');
      if (input.date > new Date().toISOString().slice(0, 10)) throw new DemoError(400, 'FUTURE_PAYMENT', 'La data dell’incasso non può essere futura.');
      const payment = { ...input, id: paymentId, documentNumber: document.number, clientName: document.clientName, createdAt: new Date().toISOString() };
      document.paidCents += input.amountCents; if (document.paidCents === document.totalCents) document.status = 'paid'; document.version += 1; document.updatedAt = payment.createdAt;
      tenant.payments.unshift(payment); result = payment; save(snapshot, tenant); break;
    }
    case 'GET /api/bulk-jobs': result = tenant.bulkJobs; break;
    case 'POST /api/bulk-jobs': {
      const input = parse(bulkJobInputSchema, body(options));
      const job = { ...input, id: crypto.randomUUID(), status: 'awaiting_configuration' as const, createdAt: new Date().toISOString(), records: 0, message: 'DEMO: richiesta salvata solo in questa scheda. Nessun invio all’Agenzia, nessun archivio scaricato.' };
      tenant.bulkJobs.unshift(job); result = job; save(snapshot, tenant); break;
    }
    case 'GET /api/integrations': result = disabledIntegrations; break;
    case 'GET /api/integrations/fatture-in-cloud/companies': throw new DemoError(503, 'INTEGRATION_NOT_CONFIGURED', 'Fatture in Cloud è disattivato nella demo pubblica.');
    default: {
      const match = url.pathname.match(/^\/api\/documents\/([^/]+)(?:\/(issue|xml))?$/);
      if (!match) throw new DemoError(404, 'NOT_FOUND', 'Operazione non disponibile nella demo.');
      const document = findDocument(tenant, match[1]!);
      if (method === 'GET' && !match[2]) { result = document; break; }
      if (method === 'GET' && match[2] === 'xml') { result = xmlFor(tenant, document.id); break; }
      if (method === 'POST' && match[2] === 'issue') {
        if (document.status !== 'draft') throw new DemoError(409, 'INVALID_DOCUMENT_STATE', 'Solo una bozza può essere segnata come pronta.');
        document.status = 'ready'; document.version += 1; document.updatedAt = new Date().toISOString(); result = document; save(snapshot, tenant); break;
      }
      throw new DemoError(404, 'NOT_FOUND', 'Operazione non disponibile nella demo.');
    }
  }
  return structuredClone(result) as T;
}
function xmlFor(tenant: TenantState, id: string): string {
  const document = findDocument(tenant, id);
  if (document.kind === 'quote') throw new DemoError(422, 'NOT_A_FISCAL_DOCUMENT', 'I preventivi non vengono esportati come fattura XML.');
  const client = tenant.clients.find(client => client.id === document.clientId)!;
  return createDemoXml(tenant.company, client, document);
}
export function demoXml(id: string, companyId?: string): string { return xmlFor(selected(read(), companyId), id); }
export function resetDemoWorkspace(): void { write({ schemaVersion: storageVersion, tenants: createDemoTenants() }); }
function dashboard(tenant: TenantState): Dashboard {
  const today = new Date().toISOString().slice(0, 10); const now = new Date();
  const issued = tenant.documents.filter(document => document.kind !== 'quote' && !['draft', 'rejected'].includes(document.status));
  const outstanding = issued.filter(document => document.kind === 'invoice' && document.totalCents > document.paidCents);
  const signedNet = (document: TenantState['documents'][number]) => document.kind === 'credit_note' ? -document.netCents : document.netCents;
  const months = Array.from({ length: 6 }, (_, index) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1)).toISOString().slice(0, 7));
  return {
    metrics: { revenueCents: issued.filter(document => document.date.startsWith(today.slice(0, 4))).reduce((sum, document) => sum + signedNet(document), 0), outstandingCents: outstanding.reduce((sum, document) => sum + document.totalCents - document.paidCents, 0), overdueCents: outstanding.filter(document => document.dueDate < today).reduce((sum, document) => sum + document.totalCents - document.paidCents, 0), draftCount: tenant.documents.filter(document => document.status === 'draft').length, documentCount: tenant.documents.length, clientCount: tenant.clients.length },
    monthly: months.map(month => ({ month, invoicedCents: issued.filter(document => document.date.startsWith(month)).reduce((sum, document) => sum + signedNet(document), 0), collectedCents: tenant.payments.filter(payment => payment.date.startsWith(month)).reduce((sum, payment) => sum + payment.amountCents, 0) })),
    recentDocuments: [...tenant.documents].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5), upcomingPayments: [...outstanding].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5),
    activity: [
      ...tenant.documents.map(document => ({ id: document.id, label: `${document.status === 'draft' ? 'Bozza creata' : 'Documento demo'} · ${document.number} · ${document.clientName}`, date: document.updatedAt, type: 'document' as const })),
      ...tenant.payments.map(payment => ({ id: payment.id, label: `Incasso demo registrato · ${payment.documentNumber}`, date: payment.createdAt, type: 'payment' as const })),
      ...tenant.bulkJobs.map(job => ({ id: job.id, label: 'Richiesta demo salvata localmente', date: job.createdAt, type: 'bulk' as const })),
    ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7),
  };
}
