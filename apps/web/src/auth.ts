export interface RuntimeConfig {
  apiBaseUrl: string;
  features?: { multiTenant: boolean };
  auth: { mode: 'demo' | 'cognito'; domain: string; clientId: string; redirectUri: string; logoutUri: string };
}

let config: RuntimeConfig;
let accessToken: string | undefined;
let expiresAt = 0;
const sessionKey = 'openfatture.session';
export const getConfig = () => config;
export const authenticated = () => config.auth.mode === 'demo' || (!!accessToken && expiresAt > Date.now());
export const getToken = () => expiresAt > Date.now() ? accessToken : undefined;

export async function loadConfig() {
  const response = await fetch('/config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Configurazione applicazione non disponibile.');
  config = await response.json() as RuntimeConfig;
  if (!['demo', 'cognito'].includes(config.auth?.mode) || typeof config.apiBaseUrl !== 'string') throw new Error('Configurazione applicazione non valida.');
  if (config.auth.mode === 'demo' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    throw new Error('La modalità demo è disponibile solo su localhost. Configurare Cognito per questo ambiente.');
  }
  const raw = sessionStorage.getItem(sessionKey);
  if (raw) {
    try {
      const session = JSON.parse(raw) as { token: string; expires: number };
      if (session.expires > Date.now()) { accessToken = session.token; expiresAt = session.expires; }
      else sessionStorage.removeItem(sessionKey);
    } catch { sessionStorage.removeItem(sessionKey); }
  }
  if (location.pathname === '/auth/callback') await finishSignIn();
  return config;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

export async function signIn() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)));
  sessionStorage.setItem('openfatture.pkce', JSON.stringify({ verifier, state, createdAt: Date.now() }));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const url = new URL('/oauth2/authorize', config.auth.domain);
  url.search = new URLSearchParams({ response_type: 'code', client_id: config.auth.clientId, redirect_uri: config.auth.redirectUri, scope: 'openid email profile', code_challenge_method: 'S256', code_challenge: challenge, state }).toString();
  location.assign(url.toString());
}

async function finishSignIn() {
  const params = new URLSearchParams(location.search);
  const raw = sessionStorage.getItem('openfatture.pkce');
  sessionStorage.removeItem('openfatture.pkce');
  if (params.has('error')) throw new Error('Accesso non completato. Tornare alla pagina principale e riprovare.');
  if (!raw) throw new Error('Sessione di accesso non trovata. Ripetere l’accesso.');
  const stored = JSON.parse(raw) as { verifier: string; state: string; createdAt: number };
  const code = params.get('code');
  if (!code || params.get('state') !== stored.state || Date.now() - stored.createdAt > 600_000) throw new Error('Sessione di accesso scaduta o non valida. Ripetere l’accesso.');
  const response = await fetch(new URL('/oauth2/token', config.auth.domain), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: config.auth.clientId, redirect_uri: config.auth.redirectUri, code_verifier: stored.verifier }),
  });
  if (!response.ok) throw new Error('Impossibile completare l’accesso. Riprovare.');
  const result = await response.json() as { access_token: string; expires_in: number };
  if (!result.access_token || !Number.isFinite(result.expires_in)) throw new Error('Risposta di autenticazione non valida.');
  accessToken = result.access_token;
  expiresAt = Date.now() + result.expires_in * 1000 - 30_000;
  sessionStorage.setItem(sessionKey, JSON.stringify({ token: accessToken, expires: expiresAt }));
  // Refresh tokens are intentionally discarded; a new sign-in uses the Cognito session.
  history.replaceState(null, '', '/');
}

export function signOut() {
  sessionStorage.removeItem(sessionKey);
  accessToken = undefined;
  expiresAt = 0;
  const url = new URL('/logout', config.auth.domain);
  url.search = new URLSearchParams({ client_id: config.auth.clientId, logout_uri: config.auth.logoutUri }).toString();
  location.assign(url.toString());
}
