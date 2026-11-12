// Generates only fictional local test payloads through the real exporter. No API calls or credentials.
import { calculateTotals, type Document, type InvoiceLine } from '@openfatture/domain';
import { demoState } from '../apps/api/src/seed.js';
import { draftInvoiceXml } from '../apps/api/src/xml.js';

const scenario = process.argv[2] ?? 'invoice';
if (!['invoice', 'credit-note', 'mixed-vat', 'long-name', 'quote'].includes(scenario)) throw new Error('Unknown synthetic scenario');
const state = demoState(new Date('2026-11-12T12:00:00Z'));
const client = state.clients[0]!;
const lines: InvoiceLine[] = scenario === 'mixed-vat'
  ? [{ description: 'Synthetic fractional line', quantity: 1.125, unitPriceCents: 1333, vatRate: 22 }, { description: 'Synthetic second rate', quantity: 2, unitPriceCents: 999, vatRate: 10 }]
  : [{ description: 'Synthetic offline invoice', quantity: 1, unitPriceCents: 10000, vatRate: 22 }];
const document: Document = {
  id: 'synthetic_0001', number: 'TEST-1/2026', clientId: client.id, clientName: client.name,
  kind: scenario === 'credit-note' ? 'credit_note' : scenario === 'quote' ? 'quote' : 'invoice',
  date: '2026-11-12', dueDate: '2026-12-12', lines, notes: 'Fictional offline fixture. Never submit.',
  ...calculateTotals(lines), status: 'draft', paidCents: 0, createdAt: '2026-11-12T12:00:00Z', updatedAt: '2026-11-12T12:00:00Z', version: 1,
};
if (scenario === 'long-name') state.company.name = 'X'.repeat(81);
process.stdout.write(draftInvoiceXml(state.company, client, document));
