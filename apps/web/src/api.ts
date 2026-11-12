import { getConfig, getToken } from './auth';

let companyId: string | undefined;
export const selectCompany = (id: string) => { companyId = id; };
export class ApiError extends Error {
  constructor(message: string, public status: number, public requestId?: string) { super(message); }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (companyId) headers.set('X-Company-Id', companyId);
  const response = await fetch(`${getConfig().apiBaseUrl.replace(/\/$/, '')}${path}`, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { message?: string; code?: string; requestId?: string }; message?: string; requestId?: string };
    const message = body.error?.code === 'VALIDATION_ERROR' ? 'Controlla i dati inseriti: campi obbligatori, date e importi devono essere validi.' : body.error?.message || body.message || `Richiesta non riuscita (${response.status})`;
    throw new ApiError(message, response.status, body.error?.requestId ?? body.requestId);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function downloadXml(id: string) {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (companyId) headers.set('X-Company-Id', companyId);
  const response = await fetch(`${getConfig().apiBaseUrl.replace(/\/$/, '')}/api/documents/${id}/xml`, { headers });
  if (!response.ok) throw new Error('Impossibile scaricare il file XML.');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url; link.download = `bozza-fattura-${id}.xml`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
