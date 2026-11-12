import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Company, Document } from '@openfatture/domain';
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, clear() { values.clear(); }, getItem: key => values.get(key) ?? null, key: index => [...values.keys()][index] ?? null, removeItem(key) { values.delete(key); }, setItem(key, value) { values.set(key, String(value)); } };
}
const runtime = {
  apiBaseUrl: 'https://api.example.invalid/', features: { publicDemo: true, multiTenant: true },
  auth: { mode: 'cognito', domain: 'https://login.example.invalid', clientId: 'browser-client', redirectUri: 'https://openfatture.example/auth/callback', logoutUri: 'https://openfatture.example/' },
};
let fetchMock: ReturnType<typeof vi.fn>;
let locationMock: { hostname: string; pathname: string; search: string; assign: ReturnType<typeof vi.fn> };
let downloaded: Blob | undefined;
let anchor: { href: string; download: string; click: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-12T12:00:00.000Z'));
  locationMock = { hostname: 'openfatture.example', pathname: '/', search: '', assign: vi.fn() };
  fetchMock = vi.fn(async () => new Response(JSON.stringify(runtime), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('sessionStorage', memoryStorage()); vi.stubGlobal('location', locationMock); vi.stubGlobal('history', { replaceState: vi.fn() });
  downloaded = undefined; anchor = { href: '', download: '', click: vi.fn() };
  vi.stubGlobal('document', { createElement: vi.fn((tag: string) => { if (tag !== 'a') throw new Error('Unexpected element'); return anchor; }) });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { downloaded = value as Blob; return 'blob:isolated-demo'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.runOnlyPendingTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('public demo API routing', () => {
  it('serves requests and XML blobs entirely in the browser with the selected demo company', async () => {
    locationMock.pathname = '/demo';
    sessionStorage.setItem('openfatture.session', JSON.stringify({ token: 'real-token-must-be-cleared', expires: Date.now() + 100_000 }));
    const auth = await import('../src/auth'); await auth.loadConfig();
    const api = await import('../src/api');
    expect(auth.getToken()).toBeUndefined(); expect(sessionStorage.getItem('openfatture.session')).toBeNull();
    fetchMock.mockClear(); fetchMock.mockImplementation(() => { throw new Error('Active public demo must never call the backend'); });
    const companies = await api.request<Company[]>('/api/companies'); const selected = companies[1]!.id;
    api.selectCompany(selected);
    const documents = await api.request<Document[]>('/api/documents'); expect(documents.every(document => document.id.startsWith(selected))).toBe(true);
    await api.downloadXml(documents[0]!.id);
    expect(anchor.click).toHaveBeenCalledOnce(); expect(anchor.download).toContain(documents[0]!.id);
    expect(downloaded).toBeInstanceOf(Blob); expect(await downloaded!.text()).toContain('DEMO SINTETICA'); expect(await downloaded!.text()).toContain('Aurora Studio');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:isolated-demo');
  });

  it('returns browser validation failures without trying the API', async () => {
    locationMock.pathname = '/demo';
    const auth = await import('../src/auth'); await auth.loadConfig(); const api = await import('../src/api');
    fetchMock.mockClear();
    await expect(api.request('/api/documents', { method: 'POST', body: JSON.stringify({ lines: [] }) })).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores a stale demo marker when the public feature is disabled and preserves backend authentication and company selection', async () => {
    sessionStorage.setItem('openfatture.public-demo', 'true');
    sessionStorage.setItem('openfatture.session', JSON.stringify({ token: 'valid-access-token', expires: Date.now() + 100_000 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...runtime, features: { ...runtime.features, publicDemo: false } })));
    const auth = await import('../src/auth'); await auth.loadConfig(); const api = await import('../src/api');
    expect(auth.isPublicDemo()).toBe(false);
    api.selectCompany('company_production');
    fetchMock.mockResolvedValueOnce(new Response('[]', { status: 200 }));
    await api.request('/api/documents', { headers: { 'Idempotency-Key': 'preserved_key_123' } });
    const [url, options] = fetchMock.mock.calls.at(-1)! as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.invalid/api/documents');
    const headers = new Headers(options.headers); expect(headers.get('Authorization')).toBe('Bearer valid-access-token'); expect(headers.get('X-Company-Id')).toBe('company_production'); expect(headers.get('Idempotency-Key')).toBe('preserved_key_123');
    expect(sessionStorage.getItem('openfatture.browser-demo.v1')).toBeNull();
    vi.setSystemTime(new Date('2026-11-12T12:05:00.000Z'));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Sign in required' } }), { status: 401 }));
    await expect(api.request('/api/documents')).rejects.toMatchObject({ status: 401 });
    const [, expiredOptions] = fetchMock.mock.calls.at(-1)! as unknown as [string, RequestInit];
    expect(new Headers(expiredOptions.headers).get('Authorization')).toBeNull();
    expect(auth.isPublicDemo()).toBe(false); expect(sessionStorage.getItem('openfatture.browser-demo.v1')).toBeNull();
  });

  it.each([401, 503])('propagates backend HTTP %s without substituting synthetic demo data', async status => {
    const auth = await import('../src/auth'); await auth.loadConfig(); const api = await import('../src/api');
    expect(auth.isPublicDemo()).toBe(false); api.selectCompany('company_real');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'SERVICE_ERROR', message: 'Backend unavailable', requestId: 'server-request-123' } }), { status }));
    await expect(api.request('/api/documents')).rejects.toMatchObject({ status, requestId: 'server-request-123', message: 'Backend unavailable' });
    const [, options] = fetchMock.mock.calls.at(-1)! as unknown as [string, RequestInit]; expect(new Headers(options.headers).get('Authorization')).toBeNull();
    expect(auth.isPublicDemo()).toBe(false); expect(sessionStorage.getItem('openfatture.public-demo')).toBeNull(); expect(sessionStorage.getItem('openfatture.browser-demo.v1')).toBeNull(); expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never replaces a failed production XML download with a local demo blob', async () => {
    const auth = await import('../src/auth'); await auth.loadConfig(); const api = await import('../src/api'); api.selectCompany('company_real');
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    await expect(api.downloadXml('real-document-id')).rejects.toThrow('Impossibile scaricare');
    expect(downloaded).toBeUndefined(); expect(anchor.click).not.toHaveBeenCalled();
    const [url, options] = fetchMock.mock.calls.at(-1)! as unknown as [string, RequestInit]; expect(url).toBe('https://api.example.invalid/api/documents/real-document-id/xml'); expect(new Headers(options.headers).get('X-Company-Id')).toBe('company_real');
  });
});
