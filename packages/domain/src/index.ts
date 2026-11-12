import { z } from 'zod';

export const documentStatuses = ['draft', 'ready', 'sent', 'delivered', 'rejected', 'paid'] as const;
export type DocumentStatus = typeof documentStatuses[number];
export type DocumentKind = 'invoice' | 'credit_note' | 'quote';
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, 'Invalid date');
const money = z.number().int().min(0).max(1_000_000_000);
const addressSchema = z.object({ street: z.string().min(1).max(200), city: z.string().min(1).max(100), postalCode: z.string().regex(/^\d{5}$/), province: z.string().regex(/^[A-Z]{2}$/), country: z.literal('IT').default('IT') });
export type Address = z.infer<typeof addressSchema>;
export const clientInputSchema = z.object({ name: z.string().trim().min(2).max(160), email: z.email().max(200), vatNumber: z.string().regex(/^\d{11}$/), taxCode: z.string().regex(/^[A-Z0-9]{11,16}$/).optional(), recipientCode: z.string().regex(/^[A-Z0-9]{7}$/).default('0000000'), address: addressSchema });
export type ClientInput = z.infer<typeof clientInputSchema>;
export type Client = ClientInput & { id: string; createdAt: string };
export type Company = { id: string; name: string; vatNumber: string; taxCode: string; address: Address; taxRegime: string; currency: 'EUR'; recipientCode: string; email: string };
export const lineInputSchema = z.object({ description: z.string().trim().min(1).max(300), quantity: z.number().positive().max(10000).refine(v => Math.abs(v * 1000 - Math.round(v * 1000)) < 0.00001, 'Maximum 3 quantity decimals'), unitPriceCents: money, vatRate: z.union([z.literal(4), z.literal(5), z.literal(10), z.literal(22)]) });
export type InvoiceLine = z.infer<typeof lineInputSchema>;
export const documentInputSchema = z.object({ clientId: z.string().min(1), kind: z.enum(['invoice', 'credit_note', 'quote']).default('invoice'), date: dateSchema, dueDate: dateSchema, lines: z.array(lineInputSchema).min(1).max(100), notes: z.string().max(2000).default('') }).refine(d => d.dueDate >= d.date, { message: 'Due date must be on or after document date', path: ['dueDate'] });
export type DocumentInput = z.infer<typeof documentInputSchema>;
export type Totals = { netCents: number; vatCents: number; totalCents: number };
export type Document = DocumentInput & Totals & { id: string; number: string; clientName: string; status: DocumentStatus; paidCents: number; createdAt: string; updatedAt: string; version: number };
export const paymentInputSchema = z.object({ documentId: z.string().min(1), amountCents: money.refine(v => v > 0), date: dateSchema, method: z.enum(['bank_transfer', 'card', 'cash']).default('bank_transfer'), reference: z.string().max(160).default('') });
export type PaymentInput = z.infer<typeof paymentInputSchema>;
export type Payment = PaymentInput & { id: string; clientName: string; documentNumber: string; createdAt: string };
export const bulkJobInputSchema = z.object({ type: z.enum(['invoice_download', 'receipt_download', 'stamp_duty_lists']), dateFrom: dateSchema, dateTo: dateSchema }).refine(v => v.dateTo >= v.dateFrom, { message: 'End date must be after start date', path: ['dateTo'] }).refine(v => Date.parse(v.dateTo) - Date.parse(v.dateFrom) <= 90 * 86400000, { message: 'Use date windows of at most 90 days', path: ['dateTo'] });
export type BulkJobInput = z.infer<typeof bulkJobInputSchema>;
export type BulkJob = BulkJobInput & { id: string; status: 'awaiting_configuration'; createdAt: string; message: string; records: number };
export type Integration = { id: 'sdicoop' | 'fatture-in-cloud' | 'conservation'; name: string; status: 'not_configured' | 'configured' | 'unavailable'; description: string; capabilities: string[] };
export type Dashboard = { metrics: { revenueCents: number; outstandingCents: number; overdueCents: number; draftCount: number; documentCount: number; clientCount: number }; monthly: { month: string; invoicedCents: number; collectedCents: number }[]; recentDocuments: Document[]; upcomingPayments: Document[]; activity: { id: string; label: string; date: string; type: 'document' | 'payment' | 'bulk' }[] };
export type TenantState = { company: Company; clients: Client[]; documents: Document[]; payments: Payment[]; bulkJobs: BulkJob[]; sequence: number; version: number };
export type ApiError = { error: { code: string; message: string; requestId: string; details?: unknown } };

// Quantities have at most 3 decimals. Integer arithmetic rounds each line and VAT group half-up.
export function lineNetCents(line: InvoiceLine): number {
  const numerator = BigInt(Math.round(line.quantity * 1000)) * BigInt(line.unitPriceCents);
  return Number((numerator + 500n) / 1000n);
}
export function calculateTotals(lines: InvoiceLine[]): Totals {
  let netCents = 0;
  const groups = new Map<number, number>();
  for (const line of lines) { const net = lineNetCents(line); netCents += net; groups.set(line.vatRate, (groups.get(line.vatRate) ?? 0) + net); }
  let vatCents = 0;
  for (const [rate, net] of groups) vatCents += Number((BigInt(net) * BigInt(rate) + 50n) / 100n);
  if (!Number.isSafeInteger(netCents + vatCents) || netCents + vatCents > 1_000_000_000) throw new Error('Document exceeds maximum total');
  return { netCents, vatCents, totalCents: netCents + vatCents };
}
export const statusLabels: Record<DocumentStatus, string> = { draft: 'Bozza', ready: 'Pronta', sent: 'Inviata', delivered: 'Consegnata', rejected: 'Scartata', paid: 'Pagata' };
export function formatMoney(cents: number) { return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(cents / 100); }
