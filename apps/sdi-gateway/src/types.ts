export const MAX_WIRE_BYTES = 12 * 1024 * 1024;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_METADATA_BYTES = 1024 * 1024;
export const SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
export const RECEIVE_NS = 'http://www.fatturapa.gov.it/sdi/ws/ricezione/v1.0/types';
export const TRANSMIT_NS = 'http://www.fatturapa.gov.it/sdi/ws/trasmissione/v1.0/types';
export type Service = 'RicezioneFatture' | 'TrasmissioneFatture';
export type Attachment = { role: 'file' | 'metadata'; name: string; data: Buffer };
export type Receipt = { service: Service; operation: string; identificativoSdI: string; attachments: Attachment[] };
export type TrustedPeer = { certificatePem: string; verifiedByIngress: boolean };
export type GatewayRequest = { method: string; path: string; headers: Record<string, string | undefined>; body: Buffer; peer?: TrustedPeer };
export type GatewayResponse = { statusCode: number; headers: Record<string, string>; body: string };
export type ImmutableObject = { key: string; data: Buffer; contentType: string };
export interface InboxStore { putImmutable(object: ImmutableObject): Promise<void>; }
export type GatewayConfig = { providerContext: string; trustedPeerSha256: string[] };
export class GatewayError extends Error {
  constructor(public readonly status: number, public readonly fault: 'Client' | 'Server', public readonly reason: string) { super(reason); }
}
export function clientError(reason = 'Invalid SOAP request'): never { throw new GatewayError(400, 'Client', reason); }
