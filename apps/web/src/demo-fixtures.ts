import { calculateTotals, type Document, type DocumentStatus, type TenantState } from '@openfatture/domain';

export const demoCompanyIds = ['company_demo', 'company_demo_second'] as const;

// These records are invented here. No production data, tokens, or server imports enter this module.
export function createDemoTenants(now = new Date()): TenantState[] {
  return demoCompanyIds.map((id, companyIndex) => {
    const day = (offset: number) => { const date = new Date(now); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };
    const company = {
      id, name: companyIndex ? 'Aurora Studio · Demo' : 'Studio Forma · Demo', vatNumber: '00000000000', taxCode: '00000000000',
      currency: 'EUR' as const, taxRegime: 'RF01', email: 'amministrazione@example.invalid', recipientCode: '0000000',
      address: { street: 'Via Esempio 10', city: 'Milano', postalCode: '20100', province: 'MI', country: 'IT' as const },
    };
    const names = ['Acme Design · Demo', 'Officina Esempio', 'Verde Studio · Demo', 'Nord Creativo · Demo', 'Atelier Esempio', 'Progetto Aurora · Demo'];
    const clients = names.map((name, i) => ({ id: `${id}_client_${i + 1}`, name, email: `cliente${i + 1}@example.invalid`, vatNumber: `0000000000${i + 1}`, recipientCode: '0000000', address: { ...company.address, street: `Via Esempio ${20 + i}` }, createdAt: now.toISOString() }));
    const statuses: DocumentStatus[] = ['delivered', 'paid', 'draft', 'ready', 'paid', 'delivered', 'paid', 'paid', 'delivered', 'paid', 'paid', 'paid'];
    const documents = statuses.map((status, i): Document => {
      const client = clients[i % clients.length]!;
      const date = day(-i * 13 - 3); const dueDate = day(20 - i * 9);
      const lines = [{ description: ['Consulenza creativa di esempio', 'Progetto grafico dimostrativo', 'Sviluppo sito di esempio', 'Servizi professionali demo'][i % 4]!, quantity: 1, unitPriceCents: [240000, 380000, 125000, 89000, 460000, 185000][i % 6]! + companyIndex * 10000, vatRate: 22 as const }];
      const totals = calculateTotals(lines);
      return { id: `${id}_document_${i + 1}`, number: `${String(i + 1).padStart(3, '0')}/${date.slice(0, 4)}`, clientId: client.id, clientName: client.name, kind: 'invoice', date, dueDate, lines, notes: 'Documento sintetico per provare la demo.', ...totals, paidCents: status === 'paid' ? totals.totalCents : 0, status, createdAt: `${date}T10:00:00.000Z`, updatedAt: `${date}T10:00:00.000Z`, version: 1 };
    });
    const payments = documents.filter(document => document.status === 'paid').map(document => ({ id: `demo_payment_${document.id}`, documentId: document.id, documentNumber: document.number, clientName: document.clientName, amountCents: document.totalCents, date: document.dueDate < day(0) ? document.dueDate : day(0), method: 'bank_transfer' as const, reference: `Saldo demo ${document.number}`, createdAt: document.updatedAt }));
    return { company, clients, documents, payments, bulkJobs: [], sequence: documents.length, version: 0 };
  });
}
