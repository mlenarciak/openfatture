import { lineNetCents, type Company, type Client, type Document } from '@openfatture/domain';
import { HttpError } from './errors.js';
const escape = (value: string) => value.replace(/[<>&'\"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character]!);
const decimal = (value: number) => (value / 100).toFixed(2);
export function draftInvoiceXml(company: Company, client: Client, document: Document): string {
  if (document.kind === 'quote') throw new HttpError(422, 'NOT_A_FISCAL_DOCUMENT', 'Quotes cannot be exported as FatturaPA');
  const address = (value: Company['address']) => `<Sede><Indirizzo>${escape(value.street)}</Indirizzo><CAP>${value.postalCode}</CAP><Comune>${escape(value.city)}</Comune><Provincia>${value.province}</Provincia><Nazione>${value.country}</Nazione></Sede>`;
  const groups = new Map<number, number>();
  for (const line of document.lines) groups.set(line.vatRate, (groups.get(line.vatRate) ?? 0) + lineNetCents(line));
  const summaries = [...groups].map(([rate, net]) => `<DatiRiepilogo><AliquotaIVA>${rate.toFixed(2)}</AliquotaIVA><ImponibileImporto>${decimal(net)}</ImponibileImporto><Imposta>${decimal(Number((BigInt(net) * BigInt(rate) + 50n) / 100n))}</Imposta><EsigibilitaIVA>I</EsigibilitaIVA></DatiRiepilogo>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- DRAFT ONLY: not XSD-validated, signed, transmitted to SdI, or legally conserved. Verify all fiscal data before use. -->
<p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" versione="FPR12">
<FatturaElettronicaHeader><DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>${escape(company.vatNumber)}</IdCodice></IdTrasmittente><ProgressivoInvio>${escape(document.id.replace(/[^a-zA-Z0-9]/g, '').slice(-10))}</ProgressivoInvio><FormatoTrasmissione>FPR12</FormatoTrasmissione><CodiceDestinatario>${escape(client.recipientCode)}</CodiceDestinatario></DatiTrasmissione>
<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${escape(company.vatNumber)}</IdCodice></IdFiscaleIVA><CodiceFiscale>${escape(company.taxCode)}</CodiceFiscale><Anagrafica><Denominazione>${escape(company.name)}</Denominazione></Anagrafica><RegimeFiscale>${escape(company.taxRegime)}</RegimeFiscale></DatiAnagrafici>${address(company.address)}</CedentePrestatore>
<CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${escape(client.vatNumber)}</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>${escape(client.name)}</Denominazione></Anagrafica></DatiAnagrafici>${address(client.address)}</CessionarioCommittente></FatturaElettronicaHeader>
<FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><TipoDocumento>${document.kind === 'credit_note' ? 'TD04' : 'TD01'}</TipoDocumento><Divisa>EUR</Divisa><Data>${document.date}</Data><Numero>${escape(document.number)}</Numero><ImportoTotaleDocumento>${decimal(document.totalCents)}</ImportoTotaleDocumento>${document.notes ? `<Causale>${escape(document.notes.slice(0, 200))}</Causale>` : ''}</DatiGeneraliDocumento></DatiGenerali>
<DatiBeniServizi>${document.lines.map((line, index) => `<DettaglioLinee><NumeroLinea>${index + 1}</NumeroLinea><Descrizione>${escape(line.description)}</Descrizione><Quantita>${line.quantity.toFixed(3)}</Quantita><PrezzoUnitario>${decimal(line.unitPriceCents)}</PrezzoUnitario><PrezzoTotale>${decimal(lineNetCents(line))}</PrezzoTotale><AliquotaIVA>${line.vatRate.toFixed(2)}</AliquotaIVA></DettaglioLinee>`).join('')}${summaries}</DatiBeniServizi>
<DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>MP05</ModalitaPagamento><DataScadenzaPagamento>${document.dueDate}</DataScadenzaPagamento><ImportoPagamento>${decimal(document.totalCents)}</ImportoPagamento></DettaglioPagamento></DatiPagamento></FatturaElettronicaBody></p:FatturaElettronica>`;
}
