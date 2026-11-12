import { clientError, MAX_FILE_BYTES, MAX_WIRE_BYTES } from './types.js';
export type MediaType = { mime: string; parameters: Map<string, string> };
export function mediaType(value: string): MediaType {
  if (!value || value.length > 1024 || /[\r\n\x00]/.test(value)) clientError('Unsupported content type');
  const pieces: string[] = []; let piece = ''; let quote = false; let escaped = false;
  for (const character of value) {
    if (escaped) { piece += character; escaped = false; continue; }
    if (quote && character === '\\') { escaped = true; continue; }
    if (character === '"') { quote = !quote; piece += character; continue; }
    if (character === ';' && !quote) { pieces.push(piece.trim()); piece = ''; } else piece += character;
  }
  if (quote || escaped) clientError('Malformed content type'); pieces.push(piece.trim());
  const mime = pieces.shift()!.toLowerCase(); if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime)) clientError('Malformed content type');
  const parameters = new Map<string, string>();
  for (const parameter of pieces) {
    const match = /^([a-zA-Z0-9_-]+)\s*=\s*("[^"\r\n]*"|[^;\s"]+)$/.exec(parameter);
    if (!match || parameters.has(match[1]!.toLowerCase())) clientError('Malformed content type parameter');
    const raw = match[2]!; parameters.set(match[1]!.toLowerCase(), raw.startsWith('"') ? raw.slice(1, -1) : raw);
  }
  return { mime, parameters };
}
export function strictBase64(input: string, maximum = MAX_FILE_BYTES, allowWhitespace = true): Buffer {
  if (input.length > Math.ceil(maximum / 3) * 4 + (allowWhitespace ? 256 * 1024 : 0)) clientError('Encoded attachment exceeds limit');
  const value = allowWhitespace ? input.replace(/[ \t\r\n]/g, '') : input;
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) clientError('Invalid base64 attachment');
  const data = Buffer.from(value, 'base64');
  if (data.length === 0 || data.length > maximum || data.toString('base64') !== value) clientError('Invalid or oversized attachment');
  return data;
}
export function contentId(value: string): string {
  const id = value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1) : value;
  if (!/^[a-zA-Z0-9@._:+-]{1,200}$/.test(id)) clientError('Invalid MIME content ID');
  return id;
}
export type MimePart = { id?: string; type: MediaType; data: Buffer };
export function parseMime(raw: Buffer, type: MediaType): { root: Buffer; attachments: Map<string, Buffer> } {
  const boundary = type.parameters.get('boundary');
  if (!boundary || !/^[0-9A-Za-z'()+_,./:=?-]{1,70}$/.test(boundary) || type.parameters.get('type')?.toLowerCase() !== 'application/xop+xml') clientError('Invalid MTOM boundary or media type');
  const delimiter = Buffer.from(`--${boundary}`); const subsequent = Buffer.from(`\r\n--${boundary}`); const parts: MimePart[] = [];
  if (!raw.subarray(0, delimiter.length).equals(delimiter)) clientError('Invalid MIME preamble');
  let cursor = delimiter.length;
  while (true) {
    if (raw.subarray(cursor, cursor + 2).toString('latin1') === '--') {
      if (!/^(?:\r\n)?$/.test(raw.subarray(cursor + 2).toString('latin1'))) clientError('Invalid MIME epilogue'); break;
    }
    if (raw.subarray(cursor, cursor + 2).toString('latin1') !== '\r\n') clientError('Invalid MIME framing');
    cursor += 2;
    const endHeaders = raw.indexOf('\r\n\r\n', cursor);
    if (endHeaders === -1 || endHeaders - cursor > 8192) clientError('Invalid MIME headers');
    const headerBytes = raw.subarray(cursor, endHeaders); if (headerBytes.some(byte => byte > 127)) clientError('Non-ASCII MIME header');
    const headerText = headerBytes.toString('latin1');
    if (/[^\x09\x20-\x7e\r\n]/.test(headerText)) clientError('Invalid MIME header bytes');
    const headers = new Map<string, string>();
    for (const line of headerText.replace(/\r\n[ \t]+/g, ' ').split('\r\n')) {
      const match = /^([a-zA-Z0-9-]+):[ \t]*([^\r\n]*)$/.exec(line); if (!match) clientError('Invalid MIME header');
      const name = match[1]!.toLowerCase(); if (headers.has(name)) clientError('Duplicate MIME header'); headers.set(name, match[2]!.trim());
    }
    cursor = endHeaders + 4; let next = raw.indexOf(subsequent, cursor);
    while (next !== -1) {
      const suffix = raw.subarray(next + subsequent.length, next + subsequent.length + 2).toString('latin1');
      if (suffix === '--' || suffix === '\r\n') break; next = raw.indexOf(subsequent, next + 1);
    }
    if (next === -1) clientError('Unterminated MIME body');
    let data = raw.subarray(cursor, next);
    const encoding = headers.get('content-transfer-encoding')?.toLowerCase() ?? 'binary';
    if (encoding === 'base64') {
      if (data.some(byte => byte > 127)) clientError('Non-ASCII MIME base64 bytes');
      data = strictBase64(data.toString('latin1'), MAX_WIRE_BYTES);
    }
    else if (!['binary', '8bit', '7bit'].includes(encoding)) clientError('Unsupported MIME transfer encoding');
    parts.push({ id: headers.has('content-id') ? contentId(headers.get('content-id')!) : undefined, type: mediaType(headers.get('content-type') ?? 'application/octet-stream'), data });
    if (parts.length > 3) clientError('Too many MIME parts'); cursor = next + subsequent.length;
  }
  const ids = parts.flatMap(part => part.id ? [part.id] : []); if (new Set(ids).size !== ids.length) clientError('Duplicate MIME content ID');
  const start = type.parameters.get('start'); const rootPart = start ? parts.find(part => part.id === contentId(start)) : parts[0];
  if (!rootPart || rootPart.type.mime !== 'application/xop+xml' || rootPart.type.parameters.get('type')?.toLowerCase() !== 'text/xml') clientError('Missing SOAP 1.1 MTOM root');
  const charset = rootPart.type.parameters.get('charset')?.toLowerCase(); if (charset && charset !== 'utf-8') clientError('SOAP must use UTF-8');
  const attachments = new Map<string, Buffer>();
  for (const part of parts) if (part !== rootPart) { if (!part.id) clientError('Missing attachment content ID'); attachments.set(part.id, part.data); }
  return { root: rootPart.data, attachments };
}
