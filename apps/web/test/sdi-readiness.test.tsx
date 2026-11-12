import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SdiOperatorReadiness } from '@openfatture/domain';
import { SdiReadiness, peerExpiry } from '../src/sdi-readiness';

function status(): SdiOperatorReadiness {
  return {
    environment: 'test',
    certificate: { status: 'received', keyMatch: 'verified', clientCommonName: 'SYNTHETIC-CLIENT', serverCommonName: 'SYNTHETIC-SERVER', validFrom: '2031-01-01T00:00:00.000Z', validUntil: '2032-01-01T00:00:00.000Z' },
    peerTrust: 'pending',
    endpoint: { status: 'planned', paths: { receiving: '/test/RicezioneFatture', notifications: '/test/TrasmissioneFatture' } },
    interoperability: 'not_performed',
    production: { enabled: false },
  };
}

describe('operator-only SdI readiness presentation', () => {
  it('warns at thirty days and distinguishes an expired TEST peer without changing production state', () => {
    const now = Date.parse('2031-01-01T00:00:00.000Z');
    expect(peerExpiry('2031-01-24T00:00:00.000Z', now)).toEqual({ days: 23, expired: false, warning: true });
    expect(peerExpiry('2031-02-02T00:00:00.000Z', now)?.warning).toBe(false);
    expect(peerExpiry('2031-01-01T00:00:00.000Z', now)).toEqual({ days: 0, expired: true, warning: true });
    expect(peerExpiry('not-a-date', now)).toBeUndefined();
  });
  it('does not present an expired TEST peer as currently verified even if a previous check passed', () => {
    const readiness = status(); readiness.peerTrust = 'verified';
    readiness.peerCertificate = { validUntil: new Date(Date.now() - 86_400_000).toISOString(), sha256Fingerprint: 'ab'.repeat(32) };
    const html = renderToStaticMarkup(<SdiReadiness readiness={readiness} />);
    expect(html).toContain('Certificato scaduto');
    expect(html).not.toContain('>Verificata<');
    expect(html).toContain('Questa indicazione riguarda l’ambiente di test');
    expect(html).toContain('Produzione disabilitata e non attivata.');
  });

  it('keeps received certificates, peer trust, publication and interoperability distinct', () => {
    const html = renderToStaticMarkup(<SdiReadiness readiness={status()} />);
    expect(html).toContain('Ricevuti · Da installare');
    expect(html).toContain('Corrispondenza locale tra certificati e chiavi verificata.');
    expect(html).toContain('Da verificare');
    expect(html).toContain('Da pubblicare');
    expect(html).toContain('Non eseguita');
    expect(html).toContain('Produzione disabilitata e non attivata.');
    expect(html).toContain('SYNTHETIC-CLIENT');
    expect(html).not.toContain('Copia URL');
    expect(html).not.toContain('Esegui test');
  });

  it('exposes copy actions only for published HTTPS test EPRs', () => {
    const readiness = status();
    readiness.endpoint = { ...readiness.endpoint, status: 'deployed', baseUrl: 'https://gateway.example.invalid' };
    const html = renderToStaticMarkup(<SdiReadiness readiness={readiness} />);
    expect(html).toContain('https://gateway.example.invalid/test/RicezioneFatture');
    expect(html).toContain('aria-label="Copia URL RicezioneFatture"');
    expect(html).toContain('aria-label="Copia URL TrasmissioneFatture"');
    expect(html).toContain('Non eseguita');
    expect(html).toContain('Produzione disabilitata e non attivata.');
  });

  it('does not turn unsafe endpoint configuration or markup into actions', () => {
    const readiness = status();
    readiness.endpoint = { ...readiness.endpoint, status: 'deployed', baseUrl: 'javascript:alert(1)' };
    readiness.certificate.clientCommonName = '<script>alert(1)</script>';
    const html = renderToStaticMarkup(<SdiReadiness readiness={readiness} />);
    expect(html).not.toContain('Copia URL');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
