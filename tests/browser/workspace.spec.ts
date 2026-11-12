import { test, expect } from '@playwright/test';

test('customer to draft invoice, local preparation, payment and SMTS draft', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const companyName = `E2E Studio ${Date.now()}`;
  const vat = String(Date.now()).slice(-11);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Le idee crescono. I numeri, sotto controllo.' })).toBeVisible();
  await expect(page.getByText('DEMO · DATI DI ESEMPIO')).toBeVisible();
  await page.screenshot({ path: 'test-results/overview-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Clienti', exact: true }).click();
  await page.getByRole('button', { name: 'Nuovo cliente' }).click();
  const clientDialog = page.getByRole('dialog');
  await clientDialog.getByLabel('Ragione sociale').fill(companyName);
  await clientDialog.getByLabel('Email', { exact: true }).fill('test@example.invalid');
  await clientDialog.getByLabel('Partita IVA').fill(vat);
  await clientDialog.getByLabel('Indirizzo', { exact: true }).fill('Via Test 1');
  await clientDialog.getByLabel('Città').fill('Milano');
  await clientDialog.getByLabel('CAP').fill('20121');
  await clientDialog.getByLabel('Provincia').fill('MI');
  await clientDialog.getByRole('button', { name: 'Aggiungi cliente' }).click();
  await expect(clientDialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: companyName })).toBeVisible();

  await page.getByRole('link', { name: 'Documenti', exact: true }).click();
  await page.getByRole('button', { name: 'Nuovo documento' }).click();
  const invoiceDialog = page.getByRole('dialog');
  await invoiceDialog.getByRole('combobox', { name: 'Cliente', exact: true }).selectOption({ label: companyName });
  await invoiceDialog.getByLabel('Descrizione riga 1').fill('Consulenza di prova');
  await invoiceDialog.getByLabel('Quantità riga 1').fill('2');
  await invoiceDialog.getByLabel('Prezzo riga 1').fill('100');
  const created = page.waitForResponse(response => response.url().endsWith('/api/documents') && response.request().method() === 'POST');
  await invoiceDialog.getByRole('button', { name: 'Salva bozza' }).click();
  const invoice = await (await created).json();
  expect(invoice.totalCents).toBe(24400);
  expect(invoice.status).toBe('draft');
  await page.getByLabel('Cerca documenti').fill(companyName);
  await page.getByRole('button', { name: `Apri documento ${invoice.number}` }).click();
  const detail = page.getByRole('dialog');
  const downloading = page.waitForEvent('download');
  await detail.getByRole('button', { name: 'Scarica XML di bozza' }).click();
  expect((await downloading).suggestedFilename()).toContain('.xml');
  await detail.getByRole('button', { name: 'Segna come pronta' }).click();
  await expect(detail.getByText('Pronta', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Chiudi finestra' }).click();

  await page.getByRole('link', { name: 'Incassi e scadenze', exact: true }).click();
  await page.getByRole('row').filter({ hasText: companyName }).getByRole('button', { name: 'Registra incasso' }).click();
  const payment = page.getByRole('dialog');
  await payment.getByLabel('Importo ricevuto (€)').fill('244');
  await payment.getByRole('button', { name: 'Registra incasso' }).click();
  await expect(payment).not.toBeVisible();
  await expect(page.getByRole('cell', { name: companyName, exact: true })).toBeVisible();

  await page.getByRole('link', { name: /Canali e integrazioni/ }).click();
  await page.getByRole('button', { name: 'Prepara richiesta massiva' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Salva richiesta interna' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('cell', { name: 'Da configurare', exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Nessuna richiesta inviata all’Agenzia/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile navigation, keyboard dialog dismissal, and visible outage errors', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.screenshot({ path: 'test-results/overview-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Apri navigazione' }).click();
  await page.getByRole('link', { name: 'Documenti', exact: true }).click();
  await page.getByRole('button', { name: 'Nuovo documento' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport);
  await page.route('**/api/dashboard', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_UNAVAILABLE', message: 'Service temporarily unavailable' } }) }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Service temporarily unavailable', { timeout: 10_000 });
});

test('self-hosting guides are readable without login and link between languages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/guida.html');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('La guida rapida per la tua azienda');
  expect(await page.locator('html').getAttribute('lang')).toBe('it');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Vai al contenuto' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Complete guide in English' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Self-hosting and your own SdI recipient code');
  expect(await page.locator('html').getAttribute('lang')).toBe('en');
  await expect(page.getByRole('heading', { name: 'Configure OpenFatture for one company or many' })).toBeVisible();
});
