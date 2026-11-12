import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import { bulkJobInputSchema, calculateTotals, clientInputSchema, documentInputSchema, paymentInputSchema, type Dashboard, type Integration, type TenantState } from '@openfatture/domain';
import { authenticator, type Authenticate } from './auth.js';
import { HttpError } from './errors.js';
import { DynamoStore, LocalStore, type Membership, type Store } from './store.js';
import { draftInvoiceXml } from './xml.js';

declare module 'fastify' { interface FastifyRequest { subject: string; membership: Membership | null; } }
export type AppOptions = { env?: NodeJS.ProcessEnv; store?: Store; authenticate?: Authenticate; logger?: boolean; now?: () => Date };
const validCompanyId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export function buildApp(options: AppOptions = {}) {
  const env = options.env ?? process.env;
  const multiTenant = z.enum(['true', 'false']).default('true').parse(env.MULTI_TENANT) === 'true';
  const pinnedCompanyId = multiTenant ? undefined : validCompanyId.parse(env.SELF_HOSTED_COMPANY_ID);
  const authenticate = options.authenticate ?? authenticator(env);
  if (!options.store && (env.NODE_ENV === 'production' || env.AWS_LAMBDA_FUNCTION_NAME) && !env.TABLE_NAME) throw new Error('TABLE_NAME is required in production');
  const store = options.store ?? (env.TABLE_NAME ? new DynamoStore(env.TABLE_NAME) : new LocalStore(env.DATA_FILE ?? '.data/openfatture.json'));
  const now = options.now ?? (() => new Date());
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 256 * 1024, genReqId: () => randomUUID(), requestIdHeader: false });
  app.decorateRequest('subject', '');
  app.decorateRequest('membership', null);
  app.register(cors, { origin: (env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map(s => s.trim()), allowedHeaders: ['Content-Type', 'Authorization', 'X-Company-Id', 'Idempotency-Key'], exposedHeaders: ['X-Request-Id', 'Content-Disposition', 'X-OpenFatture-Draft'], methods: ['GET', 'POST', 'OPTIONS'] });
  app.register(helmet, { contentSecurityPolicy: false });
  app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id).header('Cache-Control', 'no-store');
    if (request.method === 'OPTIONS' || request.url.split('?')[0] === '/health') return;
    request.subject = (await authenticate(request)).subject;
    const memberships = await store.memberships(request.subject);
    if (request.url.split('?')[0] === '/api/companies') return;
    const selected = request.headers['x-company-id'];
    if (pinnedCompanyId && selected && selected !== pinnedCompanyId) throw new HttpError(403, 'COMPANY_FORBIDDEN', 'This deployment is restricted to its configured company');
    const candidate = selected ?? pinnedCompanyId ?? memberships[0]?.tenantId;
    if (!candidate) throw new HttpError(403, 'NO_MEMBERSHIP', 'No company membership is configured for this account');
    const companyId = validCompanyId.parse(candidate);
    const member = memberships.find(membership => membership.tenantId === companyId);
    if (!member) throw new HttpError(403, 'COMPANY_FORBIDDEN', 'You do not have access to this company');
    if (request.method !== 'GET' && member.role === 'viewer') throw new HttpError(403, 'READ_ONLY', 'This membership permits read access only');
    request.membership = member;
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Check the supplied data', requestId: request.id, details: error.issues } });
    const known = error instanceof HttpError;
    const statusCode = known ? error.statusCode : (typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500);
    if (statusCode >= 500) request.log.error({ err: error, requestId: request.id }, 'Request failed');
    return reply.code(statusCode).send({ error: { code: known ? error.code : statusCode === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR', message: known ? error.message : statusCode === 500 ? 'The request could not be completed' : (error as Error).message, requestId: request.id } });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found', requestId: request.id } }));
  async function stateFor(request: FastifyRequest) {
    const id = request.membership!.tenantId;
    const state = await store.get(id);
    if (!state) throw new HttpError(404, 'COMPANY_NOT_CONFIGURED', 'Company setup is incomplete');
    return state;
  }
  async function save(request: FastifyRequest, state: TenantState) { await store.put(request.membership!.tenantId, state, state.version); }
  function documentFor(state: TenantState, request: FastifyRequest) {
    const { id } = z.object({ id: z.string().min(1).max(100) }).parse(request.params);
    const document = state.documents.find(document => document.id === id);
    if (!document) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found');
    return document;
  }
  app.get('/health', async () => ({ status: 'ok', service: 'openfatture-api', version: '0.1.0', mode: env.AUTH_MODE ?? (env.NODE_ENV === 'production' ? 'cognito' : 'demo'), deploymentMode: multiTenant ? 'multi_tenant' : 'self_hosted' }));
  app.get('/api/companies', async request => {
    const members = (await store.memberships(request.subject)).filter(member => !pinnedCompanyId || member.tenantId === pinnedCompanyId);
    const states = await Promise.all(members.map(member => store.get(member.tenantId)));
    return states.flatMap(state => state ? [state.company] : []);
  });
  app.get('/api/clients', async request => (await stateFor(request)).clients);
  app.post('/api/clients', async (request, reply) => {
    const input = clientInputSchema.parse(request.body); const state = await stateFor(request);
    if (state.clients.some(client => client.vatNumber === input.vatNumber)) throw new HttpError(409, 'CLIENT_EXISTS', 'A client with this VAT number already exists');
    const client = { ...input, id: randomUUID(), createdAt: now().toISOString() };
    state.clients.unshift(client); await save(request, state); return reply.code(201).send(client);
  });
  app.get('/api/documents', async request => {
    const state = await stateFor(request);
    const query = z.object({ search: z.string().max(160).optional(), status: z.string().optional(), kind: z.string().optional() }).parse(request.query);
    return state.documents.filter(document => (!query.status || document.status === query.status) && (!query.kind || document.kind === query.kind) && (!query.search || `${document.number} ${document.clientName}`.toLocaleLowerCase().includes(query.search.toLocaleLowerCase()))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
  app.post('/api/documents', async (request, reply) => {
    const input = documentInputSchema.parse(request.body); const state = await stateFor(request);
    const client = state.clients.find(client => client.id === input.clientId);
    if (!client) throw new HttpError(400, 'INVALID_CLIENT', 'Select a client belonging to this company');
    let totals;
    try { totals = calculateTotals(input.lines); } catch { throw new HttpError(422, 'DOCUMENT_LIMIT_EXCEEDED', 'Document total exceeds the maximum supported amount'); }
    const timestamp = now().toISOString();
    state.sequence += 1;
    const document = { ...input, ...totals, id: randomUUID(), number: `${String(state.sequence).padStart(3, '0')}/${input.date.slice(0, 4)}`, clientName: client.name, status: 'draft' as const, paidCents: 0, createdAt: timestamp, updatedAt: timestamp, version: 1 };
    state.documents.unshift(document); await save(request, state); return reply.code(201).send(document);
  });
  app.get('/api/documents/:id', async request => documentFor(await stateFor(request), request));
  app.post('/api/documents/:id/issue', async request => {
    const state = await stateFor(request); const document = documentFor(state, request);
    if (document.status !== 'draft') throw new HttpError(409, 'INVALID_DOCUMENT_STATE', 'Only draft documents can be marked ready');
    document.status = 'ready'; document.version += 1; document.updatedAt = now().toISOString();
    await save(request, state); return document;
  });
  app.get('/api/documents/:id/xml', async (request, reply) => {
    const state = await stateFor(request); const document = documentFor(state, request);
    const client = state.clients.find(client => client.id === document.clientId)!;
    return reply.header('Content-Disposition', `attachment; filename="DRAFT-${document.id}.xml"`).header('X-OpenFatture-Draft', 'true').type('application/xml; charset=utf-8').send(draftInvoiceXml(state.company, client, document));
  });
  app.get('/api/payments', async request => (await stateFor(request)).payments.sort((a, b) => b.date.localeCompare(a.date)));
  app.post('/api/payments', async (request, reply) => {
    const input = paymentInputSchema.parse(request.body); const state = await stateFor(request);
    const rawKey = request.headers['idempotency-key'];
    const key = rawKey === undefined ? undefined : z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/).parse(rawKey);
    const paymentId = key ? createHash('sha256').update(`${request.membership!.tenantId}:${key}`).digest('hex') : randomUUID();
    const existing = state.payments.find(payment => payment.id === paymentId);
    if (existing) {
      if (existing.documentId !== input.documentId || existing.amountCents !== input.amountCents || existing.date !== input.date || existing.method !== input.method || existing.reference !== input.reference) throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for a different payment');
      return reply.code(200).send(existing);
    }
    const document = state.documents.find(document => document.id === input.documentId);
    if (!document) throw new HttpError(400, 'INVALID_DOCUMENT', 'Select a document belonging to this company');
    if (document.kind !== 'invoice' || ['draft', 'rejected'].includes(document.status)) throw new HttpError(409, 'DOCUMENT_NOT_PAYABLE', 'Payments require a ready or delivered invoice');
    if (input.amountCents > document.totalCents - document.paidCents) throw new HttpError(409, 'OVERPAYMENT', 'Payment exceeds the outstanding amount');
    if (input.date > now().toISOString().slice(0, 10)) throw new HttpError(400, 'FUTURE_PAYMENT', 'Recorded payments cannot have a future date');
    const payment = { ...input, id: paymentId, documentNumber: document.number, clientName: document.clientName, createdAt: now().toISOString() };
    document.paidCents += input.amountCents; if (document.paidCents === document.totalCents) document.status = 'paid';
    document.updatedAt = payment.createdAt; document.version += 1;
    state.payments.unshift(payment); await save(request, state); return reply.code(201).send(payment);
  });
  app.get('/api/bulk-jobs', async request => (await stateFor(request)).bulkJobs);
  app.post('/api/bulk-jobs', async (request, reply) => {
    const input = bulkJobInputSchema.parse(request.body); const state = await stateFor(request);
    const job = { ...input, id: randomUUID(), status: 'awaiting_configuration' as const, createdAt: now().toISOString(), records: 0, message: 'Richiesta locale. Necessari canale SdICoop accreditato, certificati, deleghe e XML firmato. Nessuna richiesta inviata all’Agenzia.' };
    state.bulkJobs.unshift(job); await save(request, state); return reply.code(201).send(job);
  });
  app.get('/api/integrations', async (request): Promise<Integration[]> => [
    { id: 'sdicoop', name: 'Agenzia delle Entrate · SMTS', status: 'not_configured', description: 'Servizi massivi: richieste locali, nessun collegamento al canale accreditato.', capabilities: ['Download fatture', 'Corrispettivi', 'Elenchi bollo A/B'] },
    { id: 'fatture-in-cloud', name: 'Fatture in Cloud', status: env.FIC_ACCESS_TOKEN && env.FIC_TENANT_ID === request.membership?.tenantId ? 'configured' : 'not_configured', description: 'Adapter server di sola lettura per elenco aziende. Nessuna sincronizzazione automatica.', capabilities: ['Elenco aziende (sola lettura)'] },
    { id: 'conservation', name: 'Conservazione digitale', status: 'unavailable', description: 'Conservazione a norma non attiva. Il backup dei file non sostituisce la conservazione.', capabilities: [] },
  ]);
  app.get('/api/integrations/fatture-in-cloud/companies', async request => {
    if (request.membership?.role !== 'admin') throw new HttpError(403, 'ADMIN_REQUIRED', 'Administrator membership required');
    // A server-wide token must never be shared across unrelated tenants. Pin it to one configured tenant.
    if (!env.FIC_ACCESS_TOKEN || env.FIC_TENANT_ID !== request.membership.tenantId) throw new HttpError(503, 'INTEGRATION_NOT_CONFIGURED', 'Configure a server-side FIC token scoped to this tenant');
    const response = await fetch('https://api-v2.fattureincloud.it/user/companies', { headers: { Authorization: `Bearer ${env.FIC_ACCESS_TOKEN}`, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new HttpError(502, 'PROVIDER_ERROR', 'Fatture in Cloud could not complete the request');
    return response.json();
  });
  app.get('/api/dashboard', async request => dashboard(await stateFor(request), now()));
  return app;
}
function dashboard(state: TenantState, now: Date): Dashboard {
  const today = now.toISOString().slice(0, 10);
  const issued = state.documents.filter(d => d.kind !== 'quote' && !['draft', 'rejected'].includes(d.status));
  const invoices = issued.filter(d => d.kind === 'invoice');
  const signedNet = (d: TenantState['documents'][number]) => d.kind === 'credit_note' ? -d.netCents : d.netCents;
  const outstanding = invoices.filter(d => d.totalCents > d.paidCents);
  const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1)).toISOString().slice(0, 7));
  const activity = [
    ...state.documents.map(d => ({ id: d.id, label: `${d.status === 'draft' ? 'Bozza creata' : 'Documento'} · ${d.number} · ${d.clientName}`, date: d.updatedAt, type: 'document' as const })),
    ...state.payments.map(p => ({ id: p.id, label: `Pagamento registrato · ${p.documentNumber}`, date: p.createdAt, type: 'payment' as const })),
    ...state.bulkJobs.map(j => ({ id: j.id, label: 'Richiesta massiva salvata', date: j.createdAt, type: 'bulk' as const })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  return {
    metrics: { revenueCents: issued.filter(d => d.date.startsWith(today.slice(0, 4))).reduce((sum, d) => sum + signedNet(d), 0), outstandingCents: outstanding.reduce((sum, d) => sum + d.totalCents - d.paidCents, 0), overdueCents: outstanding.filter(d => d.dueDate < today).reduce((sum, d) => sum + d.totalCents - d.paidCents, 0), draftCount: state.documents.filter(d => d.status === 'draft').length, documentCount: state.documents.length, clientCount: state.clients.length },
    monthly: months.map(month => ({ month, invoicedCents: issued.filter(d => d.date.startsWith(month)).reduce((sum, d) => sum + signedNet(d), 0), collectedCents: state.payments.filter(p => p.date.startsWith(month)).reduce((sum, p) => sum + p.amountCents, 0) })),
    recentDocuments: [...state.documents].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5), upcomingPayments: [...outstanding].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5), activity,
  };
}
