import { useEffect, useState, type ReactNode } from 'react';
import { ArrowUpRight, Check, CheckCircle2, Copy, FileKey2, Globe, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { SdiOperatorReadiness } from '@openfatture/domain';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

function readableDate(value: string | undefined) {
  if (!value) return 'Non disponibile';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Da verificare' : new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function peerExpiry(validUntil: string, now = Date.now()) {
  const remaining = Date.parse(validUntil) - now;
  if (!Number.isFinite(remaining)) return undefined;
  const days = Math.ceil(remaining / 86_400_000);
  return { days, expired: remaining <= 0, warning: remaining <= 30 * 86_400_000 };
}

function safeEndpoint(baseUrl: string | undefined, path: string) {
  if (!baseUrl || !path.startsWith('/test/')) return undefined;
  try {
    const base = new URL(baseUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) return undefined;
    const endpoint = new URL(path, `${base.origin}/`);
    return endpoint.origin === base.origin ? endpoint.href : undefined;
  } catch { return undefined; }
}

function Endpoint({ label, path, baseUrl, deployed }: { label: string; path: string; baseUrl?: string; deployed: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = deployed ? safeEndpoint(baseUrl, path) : undefined;
  useEffect(() => { if (!copied) return; const timeout = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timeout); }, [copied]);
  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); toast.success(`URL ${label} copiata.`); }
    catch { toast.error('Copia non disponibile. Puoi selezionare e copiare l’indirizzo mostrato.'); }
  }
  return <div className="sdi-endpoint"><div><strong>{label}</strong><code>{url ?? path}</code>{!url && <span>{deployed ? 'URL non disponibile nella configurazione operatore.' : 'Percorso pianificato. Non ancora pubblicato.'}</span>}</div>{url && <Button variant="outline" size="sm" onClick={() => void copy()} aria-label={`Copia URL ${label}`}>{copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{copied ? 'Copiata' : 'Copia URL'}</Button>}</div>;
}

function ReadinessStep({ title, status, complete, children }: { title: string; status: string; complete?: boolean; children: ReactNode }) {
  return <div className="sdi-readiness-step"><div><strong>{title}</strong><Badge variant={complete ? 'secondary' : 'outline'}>{complete && <CheckCircle2 />}{status}</Badge></div><p>{children}</p></div>;
}

/** Presence is already scoped by server membership and the configured operator tenant. Never pass demo data here. */
export function SdiReadiness({ readiness }: { readiness: SdiOperatorReadiness }) {
  const cert = readiness.certificate;
  const certificateStatus = cert.status === 'installed' ? 'Server installato' : cert.status === 'received' ? 'Ricevuti · Da installare' : 'Da configurare';
  const peer = readiness.peerCertificate;
  const expiry = peer ? peerExpiry(peer.validUntil) : undefined;
  const peerVerified = readiness.peerTrust === 'verified' && !expiry?.expired;
  const deployed = readiness.endpoint.status === 'deployed';
  const interoperability = readiness.interoperability === 'passed' ? 'Completata' : readiness.interoperability === 'in_progress' ? 'In corso' : 'Non eseguita';
  const productionDisabled = readiness.production.enabled === false;
  return <Card className="sdi-operator-card"><CardHeader><div className="sdi-operator-heading"><div className="sdi-operator-icon"><FileKey2 size={25} /></div><div><CardTitle>Canale SdI · Preparazione dell’ambiente di test</CardTitle><CardDescription>Certificati, fiducia del peer e pubblicazione degli endpoint sono verifiche distinte.</CardDescription></div><Badge variant="outline"><LockKeyhole />Solo amministratore</Badge></div></CardHeader><CardContent><div className="sdi-readiness-grid"><ReadinessStep title="Identità e certificati" status={certificateStatus} complete={cert.status === 'installed'}>{cert.keyMatch === 'verified' ? 'Corrispondenza locale tra certificati e chiavi verificata.' : 'Corrispondenza tra certificati e chiavi ancora da verificare.'} {cert.status === 'installed' ? 'L’identità server è installata sul servizio. Il client in uscita è verificato ma non è ancora utilizzato: il trasmettitore non è attivo.' : 'L’installazione sul servizio è un passaggio separato dalla ricezione dei file.'}</ReadinessStep><ReadinessStep title="Fiducia del peer" status={expiry?.expired ? 'Certificato scaduto' : peerVerified ? 'Verificata' : 'Da verificare'} complete={peerVerified}>{expiry?.expired ? 'La scadenza configurata del peer di test è trascorsa. Aggiorna e verifica il materiale autorizzato prima di qualsiasi prova di collegamento.' : peerVerified ? 'La configurazione operatore registra la verifica del peer autorizzato e della relativa catena di fiducia.' : 'La catena di fiducia e l’identità del peer SdI autorizzato devono ancora essere verificate. Il possesso del proprio certificato non autentica il chiamante.'}</ReadinessStep><ReadinessStep title="Endpoint di test" status={deployed ? 'Pubblicati' : 'Da pubblicare'} complete={deployed}>{deployed ? 'Gli endpoint risultano pubblicati nella configurazione operatore. La raggiungibilità e i casi previsti dall’accreditamento vanno verificati separatamente.' : 'Il gateway di test è in preparazione. I percorsi proposti non rappresentano ancora EPR pubblicati o approvati.'}</ReadinessStep><ReadinessStep title="Interoperabilità" status={interoperability} complete={readiness.interoperability === 'passed'}>{readiness.interoperability === 'passed' ? 'La configurazione operatore registra il completamento dei casi di interoperabilità. L’attivazione in produzione rimane separata.' : 'Nessun esito positivo può essere dedotto da certificati, pubblicazione o risposta del controllo di salute. Servono i casi prescritti e le relative evidenze.'}</ReadinessStep></div>{cert.status !== 'not_configured' && <section className="sdi-certificate-details" aria-labelledby="sdi-certificate-title"><h3 id="sdi-certificate-title"><ShieldCheck size={17} />Metadati del certificato operatore</h3><dl><div><dt>Identità client (CN)</dt><dd>{cert.clientCommonName ?? 'Non disponibile'}</dd></div><div><dt>Identità server (CN)</dt><dd>{cert.serverCommonName ?? 'Non disponibile'}</dd></div><div><dt>Valido dal</dt><dd>{readableDate(cert.validFrom)}</dd></div><div><dt>Valido fino al</dt><dd>{readableDate(cert.validUntil)}</dd></div></dl><p>Vista riservata all’azienda assegnata al canale. Le chiavi private e il materiale dei certificati non vengono mostrati.</p></section>}{peer && <section className="sdi-certificate-details" aria-labelledby="sdi-peer-title"><h3 id="sdi-peer-title"><ShieldCheck size={17}/>Certificato del peer SdI di test</h3><dl><div><dt>Scadenza del peer di test</dt><dd>{readableDate(peer.validUntil)}{expiry && !expiry.expired && <span className="sdi-peer-days"> · {expiry.days === 1 ? 'tra 1 giorno' : `tra ${expiry.days} giorni`}</span>}</dd></div><div><dt>Impronta SHA-256</dt><dd><code className="sdi-peer-fingerprint">{peer.sha256Fingerprint}</code></dd></div></dl>{expiry?.warning && <Alert variant={expiry.expired ? 'destructive' : 'default'} className="sdi-peer-warning"><ShieldCheck/><AlertTitle>{expiry.expired ? 'Il certificato del peer di test risulta scaduto.' : 'Il certificato del peer di test scade a breve.'}</AlertTitle><AlertDescription>La scadenza è letta dalla configurazione operatore. Verifica con l’Agenzia il certificato di test aggiornato; controlla catena, scadenza e impronta prima di aggiornare il peer autorizzato. Questa indicazione riguarda l’ambiente di test, non l’attivazione in produzione.</AlertDescription></Alert>}</section>}<section className="sdi-test-endpoints" aria-labelledby="sdi-test-endpoint-title"><h3 id="sdi-test-endpoint-title"><Globe size={17} />EPR dell’ambiente di test</h3><Endpoint label="RicezioneFatture" path={readiness.endpoint.paths.receiving} baseUrl={readiness.endpoint.baseUrl} deployed={deployed} /><Endpoint label="TrasmissioneFatture" path={readiness.endpoint.paths.notifications} baseUrl={readiness.endpoint.baseUrl} deployed={deployed} /><p>RicezioneFatture riceve le fatture; TrasmissioneFatture riceve le notifiche relative alla trasmissione. Nessun pulsante di questa vista esegue test o invia documenti.</p></section><Alert className="sdi-production-alert" variant={productionDisabled ? 'default' : 'destructive'}><LockKeyhole /><AlertTitle>{productionDisabled ? 'Produzione disabilitata e non attivata.' : 'Configurazione di produzione da verificare.'}</AlertTitle><AlertDescription>{productionDisabled ? <>I percorsi <code>/prod/RicezioneFatture</code> e <code>/prod/TrasmissioneFatture</code> restano riservati e non attivati. La preparazione del test non autorizza traffico fiscale di produzione.</> : 'La configurazione ricevuta non corrisponde al perimetro di test previsto. Verificarla con l’operatore prima di qualsiasi operazione.'}</AlertDescription></Alert></CardContent><CardFooter><span>“Pronta” è uno stato interno del documento, non un esito di emissione o accettazione fiscale.</span><Button variant="ghost" size="sm" asChild><a href="/sdi-integration-testing.html" target="_blank" rel="noreferrer">Checklist di integrazione<ArrowUpRight data-icon="inline-end" /></a></Button></CardFooter></Card>;
}
