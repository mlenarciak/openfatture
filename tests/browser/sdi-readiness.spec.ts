import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Company, Integration, SdiOperatorReadiness } from '@openfatture/domain';

// Deliberately invented metadata and a tab-local mock token; no provider/account credentials are used.
const origin = 'http://localhost:5173';
const gateway = 'https://sdi-gateway.synthetic.invalid';
const token = 'synthetic-operator-browser-token';
const company: Company = {
  id: 'synthetic_operator', name: 'Operatore sintetico · Test', vatNumber: '00000000000', taxCode: '00000000000', taxRegime: 'RF01', currency: 'EUR', email: 'operator@example.invalid', recipientCode: '0000000',
  address: { street: 'Via Esempio 1', city: 'Milano', postalCode: '20100', province: 'MI', country: 'IT' },
};
function operatorReadiness(days = 23): SdiOperatorReadiness {
  return {
    environment: 'test',
    certificate: { status: 'installed', keyMatch: 'verified', clientCommonName: 'SYNTHETIC-CLIENT-IDENTITY', serverCommonName: 'SDI.SYNTHETIC.INVALID', validFrom: '2020-01-01T00:00:00.000Z', validUntil: '2040-01-01T00:00:00.000Z' },
    peerTrust: 'verified', peerCertificate: { validUntil: new Date(Date.now() + days * 86_400_000).toISOString(), sha256Fingerprint: 'ab'.repeat(32) },
    endpoint: { status: 'deployed', baseUrl: gateway, paths: { receiving: '/test/RicezioneFatture', notifications: '/test/TrasmissioneFatture' } },
    interoperability: 'not_performed', production: { enabled: false },
  };
}
async function mockOperator(page: Page, initialReadiness: SdiOperatorReadiness | undefined) {
  let readiness = initialReadiness;
  const requests: { path: string; authorization?: string; company?: string }[] = [];
  await page.addInitScript(({ authToken }) => {
    sessionStorage.removeItem('openfatture.public-demo');
    sessionStorage.setItem('openfatture.session', JSON.stringify({ token: authToken, expires: Date.now() + 600_000 }));
    localStorage.setItem('openfatture.theme', 'light');
  }, { authToken: token });
  await page.route('**/config.json', route => route.fulfill({ json: {
    apiBaseUrl: origin, features: { multiTenant: true, publicDemo: true },
    auth: { mode: 'cognito', domain: 'https://identity.synthetic.invalid', clientId: 'synthetic-browser-client', redirectUri: `${origin}/auth/callback`, logoutUri: `${origin}/` },
  } }));
  await page.route(`${origin}/api/**`, async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const headers = request.headers(); requests.push({ path, authorization: headers.authorization, company: headers['x-company-id'] });
    if (path === '/api/companies') return route.fulfill({ json: [company] });
    if (path === '/api/bulk-jobs') return route.fulfill({ json: [] });
    if (path === '/api/integrations') {
      const integrations: Integration[] = [
        { id: 'sdi-channel', name: 'Canale SdI · Ambiente di test', status: 'configured', description: 'Configurazione sintetica per verificare la vista operatore.', capabilities: ['Ricezione di test', 'Notifiche di test'], ...(readiness ? { operatorReadiness: readiness } : {}) },
        { id: 'sdicoop', name: 'Servizi massivi · SMTS', status: 'not_configured', description: 'Richieste interne; nessun invio massivo.', capabilities: ['Scarichi massivi'] },
      ];
      return route.fulfill({ json: integrations });
    }
    return route.fulfill({ status: 404, json: { error: { code: 'SYNTHETIC_NOT_FOUND', message: 'No mock is defined for this path' } } });
  });
  return { requests, setReadiness: (next: SdiOperatorReadiness | undefined) => { readiness = next; } };
}
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => ({ target: node.target, reason: node.failureSummary })) }))).toEqual([]);
}

test('operator readiness stays accessible on mobile in both themes and copies only TEST EPRs', async ({ page, context }) => {
  const fixture = await mockOperator(page, operatorReadiness());
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await page.goto('/connections');
  const card = page.locator('.sdi-operator-card');
  await expect(card).toBeVisible();
  await expect(card.getByText('Server installato', { exact: true })).toBeVisible();
  await expect(card.getByText(/client.*non.*utilizzato/i)).toBeVisible();
  await expect(card.getByText('Non eseguita', { exact: true })).toBeVisible();
  await expect(card.getByText('Produzione disabilitata e non attivata.', { exact: true })).toBeVisible();
  await expect(card.getByText('Il certificato del peer di test scade a breve.', { exact: true })).toBeVisible();
  await expect(card.getByText(/tra 23 giorni/)).toBeVisible();
  await expect(card.getByText(/Verifica con l’Agenzia il certificato di test aggiornato/)).toBeVisible();
  await expect(card.getByText('SYNTHETIC-CLIENT-IDENTITY', { exact: true })).toBeVisible();
  await expect(card.getByText('ab'.repeat(32), { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: /Esegui|Invia|Attiva/ })).toHaveCount(0);
  for (const endpoint of ['RicezioneFatture', 'TrasmissioneFatture']) {
    await card.getByRole('button', { name: `Copia URL ${endpoint}`, exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(`${gateway}/test/${endpoint}`);
  }
  await accessible(page);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await accessible(page);
  await page.screenshot({ path: 'test-results/sdi-readiness-mobile-light.png', fullPage: true });
  await page.getByRole('button', { name: 'Attiva tema scuro', exact: true }).click();
  await expect(page.locator('html')).toHaveClass('dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await accessible(page);
  await page.screenshot({ path: 'test-results/sdi-readiness-mobile-dark.png', fullPage: true });
  expect(fixture.requests.every(request => request.authorization === `Bearer ${token}`)).toBe(true);
  expect(fixture.requests.filter(request => request.path !== '/api/companies').every(request => request.company === company.id)).toBe(true);
  expect(errors).toEqual([]);
});

test('an expired TEST peer overrides a previous verified state without enabling production', async ({ page }) => {
  await mockOperator(page, operatorReadiness(-1));
  await page.goto('/connections');
  const card = page.locator('.sdi-operator-card');
  await expect(card.getByText('Certificato scaduto', { exact: true })).toBeVisible();
  await expect(card.getByText('Verificata', { exact: true })).toHaveCount(0);
  await expect(card.getByText('Il certificato del peer di test risulta scaduto.', { exact: true })).toBeVisible();
  await expect(card.getByText('Produzione disabilitata e non attivata.', { exact: true })).toBeVisible();
  await expect(card.getByText('Non eseguita', { exact: true })).toBeVisible();
  await accessible(page);
});

test('absent operator scope and browser demo do not show certificate identities or privileged EPRs', async ({ page }) => {
  const fixture = await mockOperator(page, undefined);
  await page.goto('/connections');
  await expect(page.getByRole('heading', { name: 'Le connessioni giuste. Al tuo ritmo.' })).toBeVisible();
  await expect(page.locator('.sdi-operator-card')).toHaveCount(0);
  await expect(page.getByText('SYNTHETIC-CLIENT-IDENTITY', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Copia URL/ })).toHaveCount(0);
  fixture.setReadiness(operatorReadiness());
  const beforeDemo = fixture.requests.length;
  await page.goto('/demo');
  await expect(page.getByRole('button', { name: 'Ripristina demo' })).toBeVisible();
  await page.getByRole('link', { name: /^Canali e integrazioni/ }).click();
  await expect(page.getByText('Canali fiscali simulati nella demo.', { exact: true })).toBeVisible();
  await expect(page.locator('.sdi-operator-card')).toHaveCount(0);
  await expect(page.getByText('SYNTHETIC-CLIENT-IDENTITY', { exact: true })).toHaveCount(0);
  await expect(page.getByText('ab'.repeat(32), { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Copia URL/ })).toHaveCount(0);
  expect(fixture.requests.length).toBe(beforeDemo);
});
