import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, clear: () => data.clear(), getItem: key => data.get(key) ?? null, key: index => [...data.keys()][index] ?? null, removeItem: key => { data.delete(key); }, setItem: (key, value) => { data.set(key, String(value)); } };
}
const runtime = {
  apiBaseUrl: 'https://api.example.invalid', features: { publicDemo: true, multiTenant: true },
  auth: { mode: 'cognito', domain: 'https://login.example.invalid', clientId: 'public-client', redirectUri: 'https://openfatture.example/auth/callback', logoutUri: 'https://openfatture.example/' },
};
let storage: Storage;
let locationMock: { pathname: string; search: string; hostname: string; assign: ReturnType<typeof vi.fn> };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  storage = memoryStorage();
  locationMock = { pathname: '/', search: '', hostname: 'openfatture.example', assign: vi.fn() };
  fetchMock = vi.fn(async () => new Response(JSON.stringify(runtime), { status: 200 }));
  vi.stubGlobal('sessionStorage', storage);
  vi.stubGlobal('location', locationMock);
  vi.stubGlobal('history', { replaceState: vi.fn() });
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('public entry and isolated demo session', () => {
  it('shows public entry without a token and explicitly enters a browser demo on a public host', async () => {
    const auth = await import('../src/auth');
    await auth.loadConfig();
    expect(auth.authenticated()).toBe(false);
    auth.startDemo();
    expect(locationMock.assign).toHaveBeenCalledWith('/demo');
    expect(auth.isPublicDemo()).toBe(true);
    expect(auth.authenticated()).toBe(true);
    expect(auth.getToken()).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    auth.exitDemo();
    expect(auth.authenticated()).toBe(false);
    expect(locationMock.assign).toHaveBeenLastCalledWith('/');
  });

  it('direct demo entry drops any existing real credentials', async () => {
    storage.setItem('openfatture.session', JSON.stringify({ token: 'real-access', expires: Date.now() + 100_000 }));
    locationMock.pathname = '/demo';
    const auth = await import('../src/auth');
    await auth.loadConfig();
    expect(auth.isPublicDemo()).toBe(true);
    expect(auth.getToken()).toBeUndefined();
    expect(storage.getItem('openfatture.session')).toBeNull();
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('cannot enable an anonymous API backend in production or bypass a disabled public demo', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...runtime, auth: { ...runtime.auth, mode: 'demo' } })));
    const auth = await import('../src/auth');
    await expect(auth.loadConfig()).rejects.toThrow('solo su localhost');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...runtime, features: { ...runtime.features, publicDemo: false } })));
    locationMock.pathname = '/demo';
    await expect(auth.loadConfig()).rejects.toThrow('non è attiva');
    expect(() => auth.startDemo()).toThrow('non è attiva');
    expect(auth.isPublicDemo()).toBe(false);
  });

  it('explicit login leaves the demo and expired sessions do not authenticate', async () => {
    storage.setItem('openfatture.public-demo', 'true');
    storage.setItem('openfatture.session', JSON.stringify({ token: 'old-access', expires: Date.now() - 1 }));
    locationMock.pathname = '/login';
    const auth = await import('../src/auth');
    await auth.loadConfig();
    expect(auth.authenticated()).toBe(false);
    expect(auth.isPublicDemo()).toBe(false);
    expect(storage.getItem('openfatture.session')).toBeNull();
  });
});

describe('Cognito PKCE sign-in and sign-out', () => {
  it('generates a matching S256 challenge and redeems a callback once without storing refresh tokens', async () => {
    let auth = await import('../src/auth');
    await auth.loadConfig();
    await auth.signIn();
    const url = new URL(locationMock.assign.mock.calls[0]![0]);
    const pkce = JSON.parse(storage.getItem('openfatture.pkce')!);
    expect(url.origin).toBe(runtime.auth.domain);
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(pkce.verifier).digest('base64url'));
    expect(url.searchParams.get('state')).toBe(pkce.state);
    expect(url.searchParams.get('redirect_uri')).toBe(runtime.auth.redirectUri);

    // A real OAuth round trip loads a fresh JS module while preserving sessionStorage.
    vi.resetModules();
    auth = await import('../src/auth');
    locationMock.pathname = '/auth/callback';
    locationMock.search = `?code=one-time-code&state=${pkce.state}`;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(runtime)));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-token', expires_in: 900, refresh_token: 'must-not-persist' })));
    await auth.loadConfig();
    expect(auth.authenticated()).toBe(true);
    expect(auth.getToken()).toBe('access-token');
    expect(storage.getItem('openfatture.pkce')).toBeNull();
    expect(storage.getItem('openfatture.session')).not.toContain('must-not-persist');
    const [tokenUrl, options] = fetchMock.mock.calls[2]! as unknown as [URL, RequestInit];
    expect(tokenUrl.toString()).toBe(`${runtime.auth.domain}/oauth2/token`);
    expect((options.body as URLSearchParams).get('code_verifier')).toBe(pkce.verifier);
    expect((options.body as URLSearchParams).get('code')).toBe('one-time-code');
    auth.signOut();
    expect(auth.authenticated()).toBe(false);
    const logout = new URL(locationMock.assign.mock.calls.at(-1)![0]);
    expect(logout.pathname).toBe('/logout');
    expect(logout.searchParams.get('logout_uri')).toBe(runtime.auth.logoutUri);
  });

  it.each(['mismatched', 'missing', 'expired', 'malformed', 'future'])('rejects a %s state before contacting the token endpoint', async variant => {
    locationMock.pathname = '/auth/callback';
    locationMock.search = '?code=code&state=expected';
    if (variant !== 'missing') storage.setItem('openfatture.pkce', variant === 'malformed' ? 'invalid-json' : JSON.stringify({ verifier: 'verifier', state: variant === 'mismatched' ? 'wrong' : 'expected', createdAt: Date.now() + (variant === 'expired' ? -700_000 : variant === 'future' ? 60_000 : 0) }));
    const auth = await import('../src/auth');
    await expect(auth.loadConfig()).rejects.toThrow(/Sessione di accesso/);
    expect(auth.authenticated()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(storage.getItem('openfatture.pkce')).toBeNull();
  });
});
