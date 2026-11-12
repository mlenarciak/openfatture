import { lineNetCents, type Client, type Company, type Document } from '@openfatture/domain';
const escape = (value: string) => value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[<>&'\"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character]!);
const decimal = (value: number) => (value / 100).toFixed(2);

export function createDemoXml(company: Company, client: Client, document: Document): string {
  const address = (value: Company['address']) => `<Sede><Indirizzo>${escape(value.street)}</Indirizzo><CAP>${value.postalCode}</CAP><Comune>${escape(value.city)}</Comune><Provincia>${value.province}</Provincia><Nazione>${value.country}</Nazione></Sede>`;
  const groups = new Map<number, number>();
  for (const line of document.lines) groups.set(line.vatRate, (groups.get(line.vatRate) ?? 0) + lineNetCents(line));
  const summaries = [...groups].map(([rate, net]) => `<DatiRiepilogo><AliquotaIVA>${rate.toFixed(2)}</AliquotaIVA><ImponibileImporto>${decimal(net)}</ImponibileImporto><Imposta>${decimal(Number((BigInt(net) * BigInt(rate) + 50n) / 100n))}</Imposta><EsigibilitaIVA>I</EsigibilitaIVA></DatiRiepilogo>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- DRAFT ONLY / DEMO SINTETICA: XML non validato XSD, non firmato, non trasmesso a SdI e non conservato a norma. Nessun valore fiscale. -->
<p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" versione="FPR12">
<FatturaElettronicaHeader><DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>${escape(company.vatNumber)}</IdCodice></IdTrasmittente><ProgressivoInvio>DEMO</ProgressivoInvio><FormatoTrasmissione>FPR12</FormatoTrasmissione><CodiceDestinatario>${escape(client.recipientCode)}</CodiceDestinatario></DatiTrasmissione>
<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${escape(company.vatNumber)}</IdCodice></IdFiscaleIVA><CodiceFiscale>${escape(company.taxCode)}</CodiceFiscale><Anagrafica><Denominazione>${escape(company.name)}</Denominazione></Anagrafica><RegimeFiscale>${escape(company.taxRegime)}</RegimeFiscale></DatiAnagrafici>${address(company.address)}</CedentePrestatore>
<CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${escape(client.vatNumber)}</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>${escape(client.name)}</Denominazione></Anagrafica></DatiAnagrafici>${address(client.address)}</CessionarioCommittente></FatturaElettronicaHeader>
<FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><TipoDocumento>${document.kind === 'credit_note' ? 'TD04' : 'TD01'}</TipoDocumento><Divisa>EUR</Divisa><Data>${document.date}</Data><Numero>${escape(document.number)}</Numero><ImportoTotaleDocumento>${decimal(document.totalCents)}</ImportoTotaleDocumento>${document.notes ? `<Causale>${escape(document.notes.slice(0, 200))}</Causale>` : ''}</DatiGeneraliDocumento></DatiGenerali>
<DatiBeniServizi>${document.lines.map((line, index) => `<DettaglioLinee><NumeroLinea>${index + 1}</NumeroLinea><Descrizione>${escape(line.description)}</Descrizione><Quantita>${line.quantity.toFixed(3)}</Quantita><PrezzoUnitario>${decimal(line.unitPriceCents)}</PrezzoUnitario><PrezzoTotale>${decimal(lineNetCents(line))}</PrezzoTotale><AliquotaIVA>${line.vatRate.toFixed(2)}</AliquotaIVA></DettaglioLinee>`).join('')}${summaries}</DatiBeniServizi>
<DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>MP05</ModalitaPagamento><DataScadenzaPagamento>${document.dueDate}</DataScadenzaPagamento><ImportoPagamento>${decimal(document.totalCents)}</ImportoPagamento></DettaglioPagamento></DatiPagamento></FatturaElettronicaBody></p:FatturaElettronica>`;
}
