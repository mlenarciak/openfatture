import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const config = {
  apiBaseUrl: 'https://api.openfatture.invalid', features: { publicDemo: true, multiTenant: true },
  auth: { mode: 'cognito', domain: 'https://identity.openfatture.invalid', clientId: 'browser-test-client', redirectUri: 'http://localhost:5173/auth/callback', logoutUri: 'http://localhost:5173/' },
};
async function publicConfig(page: Page, publicDemo = true) {
  await page.route('**/config.json', route => route.fulfill({ json: { ...config, features: { ...config.features, publicDemo } } }));
}
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => ({ target: node.target, reason: node.failureSummary })) }))).toEqual([]);
}

test('public landing, mobile login and both themes are accessible', async ({ page }) => {
  await publicConfig(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Prova la demo' }).first()).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Vai al contenuto' })).toBeFocused();
  await accessible(page);
  await page.screenshot({ path: 'test-results/public-landing-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Attiva tema scuro' }).click();
  await expect(page.locator('html')).toHaveClass('dark');
  await accessible(page);
  await page.screenshot({ path: 'test-results/public-landing-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Attiva tema chiaro' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/public-landing-mobile.png', fullPage: true });
  await page.getByRole('link', { name: 'Accedi', exact: true }).click();
  await expect(page.getByText('Non hai ancora un invito?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continua con il tuo account' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await accessible(page);
  await page.screenshot({ path: 'test-results/public-login-mobile.png', fullPage: true });
});

test('anonymous demo works without API traffic, survives reload, isolates visitors and resets', async ({ page, browser }) => {
  await publicConfig(page);
  const apiRequests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/')) apiRequests.push(request.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Prova la demo' }).first().click();
  await expect(page.getByRole('button', { name: 'Ripristina demo' })).toBeVisible();
  await accessible(page);
  await page.screenshot({ path: 'test-results/public-demo-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Attiva tema scuro' }).click();
  await accessible(page);
  await page.screenshot({ path: 'test-results/public-demo-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Attiva tema chiaro' }).click();
  await page.getByRole('link', { name: 'Clienti', exact: true }).click();
  await page.getByRole('button', { name: 'Nuovo cliente' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Ragione sociale').fill('Visitore Demo Test');
  await dialog.getByLabel('Email', { exact: true }).fill('demo@example.invalid');
  await dialog.getByLabel('Partita IVA').fill('01234567890');
  await dialog.getByLabel('Indirizzo', { exact: true }).fill('Via Esempio 1');
  await dialog.getByLabel('Città').fill('Milano');
  await dialog.getByLabel('CAP').fill('20121');
  await dialog.getByLabel('Provincia').fill('MI');
  await accessible(page);
  await dialog.getByRole('button', { name: 'Aggiungi cliente' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Visitore Demo Test' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Visitore Demo Test' })).toBeVisible();

  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await publicConfig(otherPage);
    await otherPage.goto('http://localhost:5173/demo');
    await otherPage.getByRole('link', { name: 'Clienti', exact: true }).click();
    await expect(otherPage.getByRole('heading', { name: 'Visitore Demo Test' })).toHaveCount(0);
  } finally { await other.close(); }

  await page.getByRole('link', { name: 'Documenti', exact: true }).click();
  await page.getByRole('button', { name: 'Nuovo documento' }).click();
  await dialog.getByRole('combobox', { name: 'Cliente', exact: true }).selectOption({ label: 'Visitore Demo Test' });
  await dialog.getByLabel('Descrizione riga 1').fill('Consulenza dimostrativa');
  await dialog.getByLabel('Quantità riga 1').fill('2');
  await dialog.getByLabel('Prezzo riga 1').fill('100');
  await dialog.getByRole('button', { name: 'Salva bozza' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByLabel('Cerca documenti').fill('Visitore Demo Test');
  await expect(page.getByRole('cell', { name: '244,00 €' })).toBeVisible();
  await page.getByRole('button', { name: /Apri documento/ }).click();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Scarica XML di bozza' }).click();
  expect((await download).suggestedFilename()).toContain('.xml');
  await dialog.getByRole('button', { name: 'Segna come pronta' }).click();
  await expect(dialog.getByText('Pronta', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Chiudi finestra' }).click();
  await page.getByRole('link', { name: 'Incassi e scadenze', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'Visitore Demo Test' }).getByRole('button', { name: 'Registra incasso' }).click();
  await dialog.getByRole('button', { name: 'Registra incasso' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('cell', { name: 'Visitore Demo Test', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ripristina demo' }).click();
  // Reset may require a confirmation dialog; it only removes this tab's sample edits.
  if (await page.getByRole('dialog').isVisible()) await page.getByRole('dialog').getByRole('button', { name: 'Ripristina demo' }).click();
  await page.getByRole('link', { name: 'Clienti', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Visitore Demo Test' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Esci dalla demo' }).click();
  await expect(page.getByRole('button', { name: 'Prova la demo' }).first()).toBeVisible();
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('Cognito entry uses PKCE, callback shows unassigned access, and bad callbacks recover', async ({ page }) => {
  await publicConfig(page);
  let authorize: URL | undefined;
  await page.route('https://identity.openfatture.invalid/oauth2/authorize?**', async route => {
    authorize = new URL(route.request().url());
    await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><title>Identity test</title><h1>Identity test</h1></html>' });
  });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Continua con il tuo account' }).click();
  await expect(page.getByRole('heading', { name: 'Identity test' })).toBeVisible();
  expect(authorize?.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorize?.searchParams.get('redirect_uri')).toBe(config.auth.redirectUri);
  const state = authorize!.searchParams.get('state');
  await page.route('https://identity.openfatture.invalid/oauth2/token', route => route.fulfill({ json: { access_token: 'test-browser-only-token', expires_in: 900 }, headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.route('https://api.openfatture.invalid/api/companies', route => route.fulfill({ json: [], headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } }));
  await page.goto(`/auth/callback?code=test-code&state=${state}`);
  await expect(page.getByText('Il tuo account è pronto. Manca il tuo spazio.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Prova la demo' })).toBeVisible();
  await page.goto('/auth/callback?code=bad-code&state=bad-state');
  await expect(page.getByRole('link', { name: 'Torna all’accesso' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Sessione di accesso non trovata');
});

test('disabled public demo has no entry and rejects direct navigation', async ({ page }) => {
  await publicConfig(page, false);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Prova la demo' })).toHaveCount(0);
  await page.goto('/demo');
  await expect(page.getByRole('alert')).toContainText('demo pubblica non è attiva');
});

test('SdI testing checklist is public and accessible on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/sdi-integration-testing.html');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Before testing the SdI integration');
  await expect(page.getByText(/GO for offline checks; NO-GO/)).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: /Skip to content/ })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await accessible(page);
});
