export interface RuntimeConfig {
  apiBaseUrl: string;
  features?: { multiTenant: boolean; publicDemo?: boolean };
  auth: { mode: 'demo' | 'cognito'; domain: string; clientId: string; redirectUri: string; logoutUri: string };
}

let config: RuntimeConfig;
let accessToken: string | undefined;
let expiresAt = 0;
const sessionKey = 'openfatture.session';
const demoKey = 'openfatture.public-demo';
export const getConfig = () => config;
export const isPublicDemo = () => config?.features?.publicDemo === true && sessionStorage.getItem(demoKey) === 'true';
export const authenticated = () => isPublicDemo() || config.auth.mode === 'demo' || (!!accessToken && expiresAt > Date.now());
export const getToken = () => !isPublicDemo() && expiresAt > Date.now() ? accessToken : undefined;

function clearSession() {
  sessionStorage.removeItem(sessionKey);
  sessionStorage.removeItem('openfatture.pkce');
  accessToken = undefined;
  expiresAt = 0;
}

export function startDemo() {
  if (!config?.features?.publicDemo) throw new Error('La demo pubblica non è attiva in questo ambiente.');
  clearSession();
  sessionStorage.setItem(demoKey, 'true');
  location.assign('/demo');
}

export function exitDemo() {
  sessionStorage.removeItem(demoKey);
  clearSession();
  location.assign('/');
}

export async function loadConfig() {
  const response = await fetch('/config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Configurazione applicazione non disponibile.');
  config = await response.json() as RuntimeConfig;
  if (!['demo', 'cognito'].includes(config.auth?.mode) || typeof config.apiBaseUrl !== 'string') throw new Error('Configurazione applicazione non valida.');
  if (config.auth.mode === 'demo' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    throw new Error('La modalità demo è disponibile solo su localhost. Configurare Cognito per questo ambiente.');
  }
  // The public browser sandbox never changes the API's Cognito authentication mode.
  // Entering it explicitly drops the real session, and its requests never leave the browser.
  if (location.pathname === '/demo') {
    if (!config.features?.publicDemo) throw new Error('La demo pubblica non è attiva in questo ambiente.');
    clearSession();
    sessionStorage.setItem(demoKey, 'true');
    history.replaceState(null, '', '/');
  }
  if (location.pathname === '/login') {
    sessionStorage.removeItem(demoKey);
    clearSession();
  }
  if (location.pathname === '/auth/callback') {
    sessionStorage.removeItem(demoKey);
    sessionStorage.removeItem(sessionKey);
    accessToken = undefined;
    expiresAt = 0;
  }
  const raw = sessionStorage.getItem(sessionKey);
  if (raw) {
    try {
      const session = JSON.parse(raw) as { token: string; expires: number };
      if (typeof session.token === 'string' && session.token && Number.isFinite(session.expires) && session.expires > Date.now()) { accessToken = session.token; expiresAt = session.expires; }
      else sessionStorage.removeItem(sessionKey);
    } catch { sessionStorage.removeItem(sessionKey); }
  }
  if (location.pathname === '/auth/callback') await finishSignIn();
  return config;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

export async function signIn() {
  if (config.auth.mode !== 'cognito') throw new Error('L’accesso aziendale richiede un ambiente Cognito configurato.');
  sessionStorage.removeItem(demoKey);
  clearSession();
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
  let stored: { verifier: string; state: string; createdAt: number };
  try { stored = JSON.parse(raw) as typeof stored; }
  catch { throw new Error('Sessione di accesso non valida. Ripetere l’accesso.'); }
  const code = params.get('code');
  if (!code || typeof stored.verifier !== 'string' || !stored.verifier || !stored.state || params.get('state') !== stored.state || !Number.isFinite(stored.createdAt) || stored.createdAt > Date.now() || Date.now() - stored.createdAt > 600_000) throw new Error('Sessione di accesso scaduta o non valida. Ripetere l’accesso.');
  const response = await fetch(new URL('/oauth2/token', config.auth.domain), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: config.auth.clientId, redirect_uri: config.auth.redirectUri, code_verifier: stored.verifier }),
  });
  if (!response.ok) throw new Error('Impossibile completare l’accesso. Riprovare.');
  const result = await response.json() as { access_token: string; expires_in: number };
  if (typeof result.access_token !== 'string' || !result.access_token || !Number.isFinite(result.expires_in) || result.expires_in <= 30) throw new Error('Risposta di autenticazione non valida.');
  accessToken = result.access_token;
  expiresAt = Date.now() + result.expires_in * 1000 - 30_000;
  sessionStorage.setItem(sessionKey, JSON.stringify({ token: accessToken, expires: expiresAt }));
  // Refresh tokens are intentionally discarded; a new sign-in uses the Cognito session.
  history.replaceState(null, '', '/');
}

export function signOut() {
  if (isPublicDemo() || config.auth.mode === 'demo') { exitDemo(); return; }
  clearSession();
  const url = new URL('/logout', config.auth.domain);
  url.search = new URLSearchParams({ client_id: config.auth.clientId, logout_uri: config.auth.logoutUri }).toString();
  location.assign(url.toString());
}
