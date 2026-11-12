import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { contentId, mediaType, parseMime, strictBase64 } from './mime.js';
import { clientError, MAX_FILE_BYTES, MAX_METADATA_BYTES, RECEIVE_NS, SOAP_NS, TRANSMIT_NS, type Receipt, type Service } from './types.js';

type Operation = { name: string; action: string; element: string; namespace: string; metadata: boolean };
export const OPERATIONS: Record<Service, readonly Operation[]> = {
  RicezioneFatture: [
    { name: 'RiceviFatture', action: 'http://www.fatturapa.it/RicezioneFatture/RiceviFattureSdI', element: 'fileSdIConMetadati', namespace: RECEIVE_NS, metadata: true },
    { name: 'NotificaDecorrenzaTermini', action: 'http://www.fatturapa.it/RicezioneFatture/NotificaDecorrenzaTermini', element: 'fileSdI', namespace: RECEIVE_NS, metadata: false },
  ],
  TrasmissioneFatture: [
    ['RicevutaConsegna', 'ricevutaConsegna'], ['NotificaMancataConsegna', 'notificaMancataConsegna'], ['NotificaScarto', 'notificaScarto'], ['NotificaEsito', 'notificaEsito'], ['NotificaDecorrenzaTermini', 'notificaDecorrenzaTermini'], ['AttestazioneTrasmissioneFattura', 'attestazioneTrasmissioneFattura'],
  ].map(([name, element]) => ({ name: name!, element: element!, action: `http://www.fatturapa.it/TrasmissioneFatture/${name}`, namespace: TRANSMIT_NS, metadata: false })),
};
type Element = { local: string; namespace: string; attributes: Map<string, string>; children: Element[]; text: string };
function decodeEntities(value: string): string {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(value)) clientError('Undeclared XML entity');
  return value.replace(/&([^;]+);/g, (_, entity: string) => {
    const predefined: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(predefined, entity)) return predefined[entity]!;
    const code = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    if (!(code === 9 || code === 10 || code === 13 || code >= 0x20 && code <= 0xd7ff || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff)) clientError('Invalid XML character reference');
    return String.fromCodePoint(code);
  });
}
function parseEnvelope(data: Buffer): Element {
  let xml: string;
  try { xml = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { clientError('SOAP must be valid UTF-8'); }
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml)) clientError('DTD, entities and control characters are forbidden');
  if ((xml.match(/</g) ?? []).length > 2000 || /<\?(?!xml\s)/i.test(xml)) clientError('Unsupported or oversized XML structure');
  const declaration = xml.match(/^\uFEFF?\s*<\?xml\s+([^?]+)\?>/); if (declaration && /encoding\s*=\s*["'](?!UTF-8["'])/i.test(declaration[1]!)) clientError('SOAP must declare UTF-8');
  if (XMLValidator.validate(xml, { allowBooleanAttributes: false }) !== true) clientError('Malformed XML');
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, parseTagValue: false, parseAttributeValue: false, processEntities: false, trimValues: false, ignoreDeclaration: true, cdataPropName: '#cdata', maxNestedTags: 24 });
  let ordered: Record<string, unknown>[];
  try { ordered = parser.parse(xml) as Record<string, unknown>[]; } catch { clientError('Malformed XML'); }
  let count = 0;
  const build = (raw: Record<string, unknown>, parent: Map<string, string>, depth: number): Element => {
    if (++count > 300 || depth > 16) clientError('SOAP structure exceeds limit');
    const keys = Object.keys(raw).filter(key => key !== ':@'); if (keys.length !== 1) clientError('Malformed XML element');
    const qualified = keys[0]!; const match = /^(?:([A-Za-z_][A-Za-z0-9_.-]*):)?([A-Za-z_][A-Za-z0-9_.-]*)$/.exec(qualified); if (!match) clientError('Unsupported XML element');
    const namespaces = new Map(parent); const attributes = new Map<string, string>();
    for (const [key, value] of Object.entries((raw[':@'] ?? {}) as Record<string, unknown>)) {
      if (typeof value !== 'string' || !key.startsWith('@_')) clientError('Invalid XML attribute');
      const name = key.slice(2); const text = decodeEntities(value);
      if (name === 'xmlns') namespaces.set('', text);
      else if (name.startsWith('xmlns:')) { const prefix = name.slice(6); if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(prefix) || prefix === 'xmlns' || prefix === 'xml' && text !== 'http://www.w3.org/XML/1998/namespace') clientError('Invalid XML namespace'); namespaces.set(prefix, text); }
      else attributes.set(name, text);
    }
    const prefix = match[1] ?? ''; if (prefix && !namespaces.has(prefix)) clientError('Undeclared namespace');
    const namespace = namespaces.get(prefix) ?? ''; const content = raw[qualified]; if (!Array.isArray(content)) clientError('Invalid XML content');
    const node: Element = { local: match[2]!, namespace, attributes, children: [], text: '' };
    for (const child of content as Record<string, unknown>[]) {
      if (Object.hasOwn(child, '#text')) { if (typeof child['#text'] !== 'string') clientError('Invalid XML text'); node.text += decodeEntities(child['#text']); }
      else if (Object.hasOwn(child, '#cdata')) { const value = child['#cdata']; if (!Array.isArray(value) || value.some(part => typeof part['#text'] !== 'string')) clientError('Invalid CDATA'); node.text += value.map(part => part['#text']).join(''); }
      else node.children.push(build(child, namespaces, depth + 1));
    }
    return node;
  };
  if (!Array.isArray(ordered) || ordered.length !== 1) clientError('Expected a single SOAP Envelope');
  return build(ordered[0]!, new Map([['xml', 'http://www.w3.org/XML/1998/namespace']]), 0);
}
function noAttributes(node: Element) { if (node.attributes.size) clientError('Unexpected SOAP attribute'); }
function scalar(node: Element, trim = true): string { noAttributes(node); if (node.children.length) clientError('Expected scalar SOAP field'); return trim ? node.text.trim() : node.text; }
function binary(node: Element, attachments: Map<string, Buffer>, used: Set<string>, maximum: number): Buffer {
  noAttributes(node);
  if (node.children.length === 0) return strictBase64(node.text, maximum);
  if (node.children.length !== 1 || node.text.trim()) clientError('Invalid MTOM field');
  const include = node.children[0]!;
  if (include.namespace !== 'http://www.w3.org/2004/08/xop/include' || include.local !== 'Include' || include.children.length || include.text.trim() || include.attributes.size !== 1) clientError('Invalid XOP Include');
  const href = include.attributes.get('href'); if (!href?.startsWith('cid:')) clientError('Only local MIME content IDs are permitted');
  let decoded: string; try { decoded = decodeURIComponent(href.slice(4)); } catch { clientError('Invalid content ID URI'); }
  const id = contentId(decoded); const data = attachments.get(id);
  if (!data || used.has(id) || data.length === 0 || data.length > maximum) clientError('Missing, reused or oversized MTOM attachment');
  used.add(id); return data;
}
export function decodeSoap(service: Service, raw: Buffer, headers: Record<string, string | undefined>): Receipt {
  const actionHeader = headers.soapaction?.trim();
  const action = actionHeader?.startsWith('"') && actionHeader.endsWith('"') ? actionHeader.slice(1, -1) : actionHeader;
  const operation = OPERATIONS[service].find(operation => operation.action === action); if (!operation) clientError('Unsupported SOAPAction');
  const type = mediaType(headers['content-type'] ?? '');
  let xml: Buffer; let attachments = new Map<string, Buffer>();
  if (type.mime === 'text/xml') { const charset = type.parameters.get('charset')?.toLowerCase(); if (charset && charset !== 'utf-8') clientError('SOAP must use UTF-8'); xml = raw; }
  else if (type.mime === 'multipart/related') { const mime = parseMime(raw, type); xml = mime.root; attachments = mime.attachments; }
  else clientError('SOAP 1.1 text/xml or MTOM is required');
  const envelope = parseEnvelope(xml); noAttributes(envelope);
  if (envelope.namespace !== SOAP_NS || envelope.local !== 'Envelope' || envelope.text.trim()) clientError('SOAP 1.1 Envelope required');
  const children = envelope.children;
  if (children.length === 2 && children[0]!.local === 'Header' && children[0]!.namespace === SOAP_NS) { const header = children.shift()!; noAttributes(header); if (header.children.length || header.text.trim()) clientError('SOAP headers are unsupported'); }
  if (children.length !== 1 || children[0]!.local !== 'Body' || children[0]!.namespace !== SOAP_NS) clientError('Expected one SOAP Body');
  const body = children[0]!; noAttributes(body); if (body.text.trim() || body.children.length !== 1) clientError('Expected one SOAP operation');
  const request = body.children[0]!; noAttributes(request);
  if (request.namespace !== operation.namespace || request.local !== operation.element || request.text.trim()) clientError('SOAP operation namespace or element does not match the WSDL');
  const fields = operation.metadata ? ['IdentificativoSdI', 'NomeFile', 'File', 'NomeFileMetadati', 'Metadati'] : ['IdentificativoSdI', 'NomeFile', 'File'];
  if (request.children.length !== fields.length || request.children.some((field, index) => field.local !== fields[index] || field.namespace !== '')) clientError('SOAP fields do not match the XSD sequence');
  const identificativoSdI = scalar(request.children[0]!); if (!/^[0-9]{1,12}$/.test(identificativoSdI)) clientError('Invalid IdentificativoSdI');
  const filename = scalar(request.children[1]!, false); if (!/^[a-zA-Z0-9_.]{9,50}$/.test(filename) || filename.includes('..')) clientError('Invalid NomeFile');
  const used = new Set<string>(); const file = binary(request.children[2]!, attachments, used, MAX_FILE_BYTES);
  const result: Receipt = { service, operation: operation.name, identificativoSdI, attachments: [{ role: 'file', name: filename, data: file }] };
  if (operation.metadata) {
    const metadataName = scalar(request.children[3]!, false); if (!/^[a-zA-Z0-9_.]{9,50}$/.test(metadataName) || metadataName.includes('..')) clientError('Invalid NomeFileMetadati');
    result.attachments.push({ role: 'metadata', name: metadataName, data: binary(request.children[4]!, attachments, used, MAX_METADATA_BYTES) });
  }
  if (used.size !== attachments.size) clientError('Unreferenced MIME attachment');
  return result;
}
export function acknowledgement(receipt: Receipt): { statusCode: number; body: string } {
  if (receipt.operation !== 'RiceviFatture') return { statusCode: 202, body: '' };
  return { statusCode: 200, body: `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="${SOAP_NS}"><soap:Body><r:rispostaRiceviFatture xmlns:r="${RECEIVE_NS}"><Esito>ER01</Esito></r:rispostaRiceviFatture></soap:Body></soap:Envelope>` };
}
