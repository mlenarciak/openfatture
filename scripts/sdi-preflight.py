#!/usr/bin/env python3
"""Offline protocol provenance and optional XSD checks. Never sends requests or reads credentials."""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import re
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
XSD = '{http://www.w3.org/2001/XMLSchema}'
WSDL = '{http://schemas.xmlsoap.org/wsdl/}'
SCHEMAS = {
    'invoice': 'fatturapa/Schema_VFPR12_v1.2.3.xsd',
    'smts-input': 'sdicoop/InputMassivo_v1.5.xsd',
    'smts-envelope': 'sdicoop/RichiestaServiziMassivi_v1.0.xsd',
}
BLOCKERS = [
    'Direct SdICoop SOAP sender and business-state reconciliation are not implemented; the separate incoming TEST receiver does not complete this workflow.',
    'Channel test activation, endpoint and certificate evidence has not been supplied to this offline tool.',
    'Fiscal business-rule validation, immutable submission snapshots and submission idempotency are missing.',
    'Tenant/provider/taxpayer/delegation mapping and qualified SMTS signing are not implemented.',
    'SMTS submission/polling/archive handling and FIC create/verify/dry-run/send synchronization are missing.',
    'Receipt lifecycle, durable submission outbox and compliant conservation acceptance remain incomplete.',
]


def load_pins(root: Path):
    reference = root / 'docs/references'
    pins, checks = {}, []
    for directory in ('sdicoop', 'fatturapa'):
        manifest = reference / directory / 'sources.json'
        try:
            data = json.loads(manifest.read_text())
        except (OSError, ValueError):
            checks.append({'id': f'provenance:{directory}', 'status': 'fail', 'detail': 'Missing or invalid source manifest'})
            continue
        for source in data['sources']:
            if not source.get('vendored'):
                continue
            filename = source['file']
            file = (manifest.parent / filename).resolve()
            if not file.is_relative_to(reference.resolve()) or Path(filename).name != filename:
                checks.append({'id': f'provenance:{directory}', 'status': 'fail', 'detail': 'Unsafe manifest path'})
                continue
            try:
                raw = file.read_bytes()
                valid = len(raw) == source['bytes'] and hashlib.sha256(raw).hexdigest() == source['sha256']
            except OSError:
                valid = False
            checks.append({'id': f'checksum:{directory}/{filename}', 'status': 'pass' if valid else 'fail'})
            if valid:
                pins[file] = source
    return pins, checks


def compile_schema(root: Path, profile: str, pins):
    from lxml import etree

    class PinnedResolver(etree.Resolver):
        def resolve(self, url, public_id, context):
            # Resolve only exact, checksum-verified local artifacts. No implicit HTTP or file access.
            for file, source in pins.items():
                aliases = {str(file), file.as_uri(), source['url'], source['url'].replace('https://', 'http://', 1)}
                if url in aliases:
                    return self.resolve_filename(str(file), context)
            raise OSError('Schema dependency is not pinned locally')

    schema_path = (root / 'docs/references' / SCHEMAS[profile]).resolve()
    if schema_path not in pins:
        raise ValueError('Schema is missing or failed checksum validation')
    parser = etree.XMLParser(no_network=True, resolve_entities=False, load_dtd=False)
    parser.resolvers.add(PinnedResolver())
    return etree.XMLSchema(etree.parse(str(schema_path), parser))


def build_report(root: Path = ROOT, xml: Path | None = None, profile: str | None = None):
    pins, checks = load_pins(root)
    expected_operations = {
        'ServiziScaricoMassivo_v1.0.wsdl': {'inoltroRichiesta', 'esitoRichiesta', 'scaricoFile'},
        'ServiziTrasmissioneMassiva_v1.0.wsdl': {'trasmissioneElenchi', 'esitoTrasmissione'},
    }
    for name, expected in expected_operations.items():
        file = (root / 'docs/references/sdicoop' / name).resolve()
        try:
            if file not in pins:
                raise ValueError('Unverified protocol')
            document = ET.fromstring(file.read_bytes())
            actual = {operation.attrib['name'] for operation in document.findall(f'{WSDL}portType/{WSDL}operation')}
            valid = actual == expected
        except (OSError, ValueError, ET.ParseError):
            valid = False
        checks.append({'id': f'operations:{name}', 'status': 'pass' if valid else 'fail'})

    has_lxml = importlib.util.find_spec('lxml') is not None
    schemas = {}
    for name in SCHEMAS:
        if has_lxml:
            try:
                schemas[name] = compile_schema(root, name, pins)
                checks.append({'id': f'xsd-compile:{name}', 'status': 'pass'})
            except Exception:
                checks.append({'id': f'xsd-compile:{name}', 'status': 'fail', 'detail': 'Schema or pinned dependency could not be compiled; no network fallback attempted'})
        else:
            checks.append({'id': f'xsd-compile:{name}', 'status': 'not_run', 'detail': 'Optional lxml dependency is not installed'})

    if xml is not None:
        try:
            with xml.open('rb') as source:
                raw = source.read(2_000_001)
            # Reject declarations before parsing. XML payloads never need a DTD for these schemas.
            if len(raw) > 2_000_000 or b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
                raise ValueError('Unsafe or oversized XML')
            # A closed encoding set prevents UTF-16/32 from hiding prohibited declarations.
            raw.decode('utf-8')
            declared = re.search(rb'''<\?xml[^?]*encoding\s*=\s*["']([^"']+)["']''', raw[:512], re.I)
            if declared and declared.group(1).lower() not in (b'utf-8', b'utf8'):
                raise ValueError('Unsupported XML encoding')
            if b'\x00' in raw:
                raise ValueError('Unsupported XML encoding')
            if not profile or profile not in schemas:
                raise ValueError('Explicit schema profile and lxml are required')
            from lxml import etree
            parser = etree.XMLParser(no_network=True, resolve_entities=False, load_dtd=False)
            valid = schemas[profile].validate(etree.fromstring(raw, parser))
            checks.append({'id': f'xml:{profile}', 'status': 'pass' if valid else 'fail', 'detail': 'XSD structure only; no signature, business-rule, delegation or delivery verification'})
        except Exception:
            # Do not echo payload text, identifiers, paths, or validator messages containing customer values.
            checks.append({'id': f'xml:{profile or "unspecified"}', 'status': 'fail', 'detail': 'XML was unsafe, unreadable, unsupported, or the local validator was unavailable'})

    failed = any(check['status'] == 'fail' for check in checks)
    return {
        'reportVersion': 1,
        'scope': 'offline-contracts-only',
        'reviewedAt': '2026-11-12',
        'status': 'fail' if failed else 'pass',
        'networkCalls': 0,
        'credentialsRead': False,
        'checks': checks,
        'goNoGo': {'offlineContracts': 'no-go' if failed else 'go', 'directSdiSandbox': 'no-go', 'smtsSandbox': 'no-go', 'ficSendSimulation': 'no-go', 'liveFiscalUse': 'no-go'},
        'blockers': BLOCKERS,
        'limits': ['An XSD pass establishes XML structure only.', 'This tool does not refresh official sources, inspect deployment state, verify signatures, or certify current fiscal compliance.', 'The incoming-only TEST gateway is assessed separately through its deployment record and authenticated portal tests; directSdiSandbox describes the complete invoice workflow.', 'Application browser demonstration and in-memory API tests are not SdI interoperability tests.'],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', action='store_true', help='Emit machine-readable report')
    parser.add_argument('--xml', type=Path, help='Optional local UTF-8 XML, maximum 2 MB; never uploaded')
    parser.add_argument('--schema', choices=SCHEMAS, help='Explicit XML profile; invoice, inner SMTS input, or outer SMTS envelope')
    parser.add_argument('--require-sandbox-ready', action='store_true', help='Exit 2 while complete connected invoice/SMTS/provider workflows remain incomplete; does not inspect the incoming-only TEST gateway')
    args = parser.parse_args(argv)
    if bool(args.xml) != bool(args.schema):
        parser.error('--xml and --schema must be supplied together')
    report = build_report(xml=args.xml, profile=args.schema)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f'Offline contracts: {report["status"].upper()}')
        for check in report['checks']:
            print(f'{check["status"].upper():7} {check["id"]}')
        print('End-to-end SdI/SMTS workflows, FIC send simulation and live fiscal use: NO-GO')
        print('Incoming-only SdI TEST gateway: not assessed by this offline checker; see the deployment record and portal test evidence.')
        print('No network calls, credentials, signing, or fiscal submissions.')
        for blocker in report['blockers']:
            print(f'- {blocker}')
    return 1 if report['status'] == 'fail' else 2 if args.require_sandbox_ready else 0


if __name__ == '__main__':
    sys.exit(main())
