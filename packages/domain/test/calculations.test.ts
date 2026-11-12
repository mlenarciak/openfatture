import { describe, expect, it } from 'vitest';
import { bulkJobInputSchema, calculateTotals, documentInputSchema, lineInputSchema } from '../src/index.js';

describe('invoice money calculation', () => {
  it('rounds fractional quantity with integer half-up arithmetic', () => {
    expect(calculateTotals([{ description: 'Fraction', quantity: 1.005, unitPriceCents: 100, vatRate: 22 }])).toEqual({ netCents: 101, vatCents: 22, totalCents: 123 });
  });
  it('calculates VAT on each rate group instead of summing separately rounded tax per line', () => {
    expect(calculateTotals([{ description: 'A', quantity: 1, unitPriceCents: 2, vatRate: 22 }, { description: 'B', quantity: 1, unitPriceCents: 2, vatRate: 22 }, { description: 'C', quantity: 1, unitPriceCents: 100, vatRate: 10 }])).toEqual({ netCents: 104, vatCents: 11, totalCents: 115 });
  });
  it('rejects unsafe totals and excess quantity precision', () => {
    expect(() => calculateTotals([{ description: 'X', quantity: 10000, unitPriceCents: 1_000_000_000, vatRate: 22 }])).toThrow('maximum');
    expect(lineInputSchema.safeParse({ description: 'X', quantity: 1.0001, unitPriceCents: 100, vatRate: 22 }).success).toBe(false);
  });
});
describe('input integrity', () => {
  it('rejects impossible dates and due dates before invoice dates', () => {
    const document = { clientId: 'x', date: '2026-02-30', dueDate: '2026-03-01', lines: [{ description: 'A', quantity: 1, unitPriceCents: 100, vatRate: 22 }] };
    expect(documentInputSchema.safeParse(document).success).toBe(false);
    expect(documentInputSchema.safeParse({ ...document, date: '2026-03-02' }).success).toBe(false);
  });
  it('accepts configured SMTS draft kinds and rejects reversed/oversized windows', () => {
    expect(bulkJobInputSchema.safeParse({ type: 'stamp_duty_lists', dateFrom: '2026-01-01', dateTo: '2026-02-01' }).success).toBe(true);
    expect(bulkJobInputSchema.safeParse({ type: 'invoice_download', dateFrom: '2026-03-01', dateTo: '2026-01-01' }).success).toBe(false);
    expect(bulkJobInputSchema.safeParse({ type: 'invoice_download', dateFrom: '2026-01-01', dateTo: '2026-12-31' }).success).toBe(false);
  });
});
