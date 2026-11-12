"""Offline checks only: local schemas and the actual TypeScript draft exporter."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('sdi_preflight', ROOT / 'scripts/sdi-preflight.py')
preflight = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preflight)
HAS_LXML = importlib.util.find_spec('lxml') is not None


class SdiPreflightTests(unittest.TestCase):
    def test_green_offline_report_never_claims_connected_readiness(self):
        report = preflight.build_report(ROOT)
        self.assertEqual(report['status'], 'pass')
        self.assertEqual(report['networkCalls'], 0)
        self.assertFalse(report['credentialsRead'])
        self.assertEqual(report['goNoGo']['offlineContracts'], 'go')
        self.assertTrue(all(status == 'no-go' for key, status in report['goNoGo'].items() if key != 'offlineContracts'))
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(preflight.main(['--require-sandbox-ready', '--json']), 2)

    def test_changed_official_source_fails_integrity_gate(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(ROOT / 'docs/references', root / 'docs/references')
            schema = root / 'docs/references/sdicoop/InputMassivo_v1.5.xsd'
            schema.write_bytes(schema.read_bytes() + b'\n<!-- changed -->')
            report = preflight.build_report(root)
            self.assertEqual(report['status'], 'fail')
            self.assertIn({'id': 'checksum:sdicoop/InputMassivo_v1.5.xsd', 'status': 'fail'}, report['checks'])

    def test_missing_validator_is_not_reported_as_validation_success(self):
        with patch.object(preflight.importlib.util, 'find_spec', return_value=None):
            report = preflight.build_report(ROOT)
            self.assertTrue(all(check['status'] == 'not_run' for check in report['checks'] if check['id'].startswith('xsd-compile:')))
            report = preflight.build_report(ROOT, ROOT / 'tests/integration/fixtures/smts-input-valid.xml', 'smts-input')
            self.assertEqual(report['status'], 'fail')

    @unittest.skipUnless(HAS_LXML, 'Install scripts/sdi-requirements.txt for actual XSD validation')
    def test_synthetic_smts_input_and_wrong_namespace(self):
        fixture = ROOT / 'tests/integration/fixtures/smts-input-valid.xml'
        self.assertEqual(preflight.build_report(ROOT, fixture, 'smts-input')['status'], 'pass')
        acceptance_date = ROOT / 'tests/integration/fixtures/smts-acceptance-date-valid.xml'
        self.assertEqual(preflight.build_report(ROOT, acceptance_date, 'smts-input')['status'], 'pass')
        with tempfile.TemporaryDirectory() as directory:
            invalid = Path(directory) / 'invalid.xml'
            invalid.write_text(fixture.read_text().replace('http://www.sogei.it/InputPubblico', 'urn:wrong'))
            self.assertEqual(preflight.build_report(ROOT, invalid, 'smts-input')['status'], 'fail')

    @unittest.skipUnless(HAS_LXML, 'Install scripts/sdi-requirements.txt for actual XSD validation')
    def test_dtd_entities_and_hidden_utf16_declarations_are_rejected(self):
        payload = '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///not-readable">]><x>&secret;</x>'
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'input.xml'
            for encoding in ('utf-8', 'utf-16'):
                file.write_bytes(payload.encode(encoding))
                report = preflight.build_report(ROOT, file, 'smts-input')
                self.assertEqual(report['status'], 'fail')
                self.assertNotIn('not-readable', json.dumps(report))

    @unittest.skipUnless(HAS_LXML, 'Install scripts/sdi-requirements.txt for actual XSD validation')
    def test_schema_resolver_refuses_unpinned_remote_dependency(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(ROOT / 'docs/references', root / 'docs/references')
            schema = root / 'docs/references/fatturapa/Schema_VFPR12_v1.2.3.xsd'
            schema.write_text(schema.read_text(encoding='utf-8-sig').replace('http://www.w3.org/TR/2002/REC-xmldsig-core-20020212/xmldsig-core-schema.xsd', 'https://unapproved.invalid/schema.xsd'))
            # Even with an explicitly passed in-memory pin, unknown imports must fail closed.
            pins, _ = preflight.load_pins(root)
            pins[schema.resolve()] = {'url': 'https://www.fatturapa.gov.it/test-fixture.xsd'}
            with self.assertRaises(Exception):
                preflight.compile_schema(root, 'invoice', pins)

    @unittest.skipUnless(HAS_LXML, 'Install scripts/sdi-requirements.txt for actual XSD validation')
    def test_current_typescript_exporter_against_pinned_official_invoice_schema(self):
        binary = ROOT / 'node_modules/.bin/tsx'
        self.assertTrue(binary.is_file(), 'Run npm ci before exporter integration tests')
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'generated.xml'
            for scenario in ('invoice', 'credit-note', 'mixed-vat'):
                result = subprocess.run([str(binary), str(ROOT / 'scripts/sdi-export-fixture.ts'), scenario], cwd=ROOT, check=True, capture_output=True, timeout=20)
                output.write_bytes(result.stdout)
                self.assertEqual(preflight.build_report(ROOT, output, 'invoice')['status'], 'pass', scenario)
            result = subprocess.run([str(binary), str(ROOT / 'scripts/sdi-export-fixture.ts'), 'long-name'], cwd=ROOT, check=True, capture_output=True, timeout=20)
            output.write_bytes(result.stdout)
            self.assertEqual(preflight.build_report(ROOT, output, 'invoice')['status'], 'fail', 'Current application permits a denomination longer than the fiscal schema')
            quote = subprocess.run([str(binary), str(ROOT / 'scripts/sdi-export-fixture.ts'), 'quote'], cwd=ROOT, capture_output=True, timeout=20)
            self.assertNotEqual(quote.returncode, 0)
            self.assertIn(b'Quotes cannot be exported', quote.stderr)


if __name__ == '__main__':
    unittest.main()
