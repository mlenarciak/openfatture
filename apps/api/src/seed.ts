import { calculateTotals, type TenantState, type Document, type DocumentStatus } from '@openfatture/domain';

export function emptyState(id: string, name: string, vatNumber: string): TenantState {
  return { company: { id, name, vatNumber, taxCode: vatNumber, currency: 'EUR', taxRegime: 'RF01', email: 'amministrazione@example.invalid', recipientCode: '0000000', address: { street: 'Da configurare', city: 'Roma', postalCode: '00100', province: 'RM', country: 'IT' } }, clients: [], documents: [], payments: [], bulkJobs: [], sequence: 0, version: 0 };
}
export function demoState(now = new Date()): TenantState {
  const state = emptyState('company_demo', 'Studio Forma S.r.l.', '12345678903');
  state.company.address = { street: 'Via della Moscova 18', city: 'Milano', postalCode: '20121', province: 'MI', country: 'IT' };
  state.company.email = 'amministrazione@studioforma.example';
  const names = ['Acme Design S.r.l.', 'Officina Milano', 'Verde & Co.', 'Nord Studio', 'Luca Bianchi', 'Atelier Roma'];
  state.clients = names.map((name, i) => ({ id: `client_${i + 1}`, name, email: `contabilita${i + 1}@example.com`, vatNumber: `${10000000000 + i}`, recipientCode: '0000000', address: { street: `Via della Spiga ${10 + i}`, city: 'Milano', postalCode: '20121', province: 'MI', country: 'IT' }, createdAt: now.toISOString() }));
  const statuses: DocumentStatus[] = ['delivered', 'paid', 'draft', 'ready', 'paid', 'delivered', 'paid', 'paid', 'delivered', 'paid', 'paid', 'paid'];
  const day = (offset: number) => { const d = new Date(now); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
  state.documents = statuses.map((status, i): Document => {
    const lines = [{ description: ['Consulenza e direzione creativa', 'Progettazione identità visiva', 'Sviluppo sito web', 'Servizi professionali'][i % 4]!, quantity: 1, unitPriceCents: [240000, 380000, 125000, 89000, 460000, 185000][i % 6]!, vatRate: 22 as const }];
    const totals = calculateTotals(lines); const client = state.clients[i % names.length]!;
    const date = day(-i * 13 - 3); const dueDate = day(20 - i * 9);
    return { id: `doc_${i + 1}`, clientId: client.id, clientName: client.name, number: `${String(i + 1).padStart(3, '0')}/${date.slice(0, 4)}`, date, dueDate, kind: 'invoice', lines, notes: '', status, ...totals, paidCents: status === 'paid' ? totals.totalCents : 0, createdAt: `${date}T10:00:00.000Z`, updatedAt: `${date}T10:00:00.000Z`, version: 1 };
  });
  state.payments = state.documents.filter(d => d.status === 'paid').map(d => ({ id: `payment_${d.id}`, documentId: d.id, documentNumber: d.number, clientName: d.clientName, amountCents: d.totalCents, date: d.dueDate < day(0) ? d.dueDate : day(0), method: 'bank_transfer', reference: `Saldo ${d.number}`, createdAt: d.updatedAt }));
  state.sequence = state.documents.length;
  return state;
}
