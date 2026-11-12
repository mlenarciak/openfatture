#!/usr/bin/env python3
"""Regenerate the public readiness guide from Markdown using locally installed pandoc."""
from pathlib import Path
import re
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
if not shutil.which('pandoc'):
    raise SystemExit('Install pandoc through your approved tooling to regenerate this documentation page.')
markdown = (root / 'docs/sdi-integration-testing.md').read_text()
# The published checklist is a document, so render checklist markers as text rather than disabled controls.
markdown = re.sub(r'^- \[ \] ', '- **Not complete:** ', markdown, flags=re.M)
body = subprocess.run(['pandoc', '--from=gfm', '--to=html5'], input=markdown, text=True, capture_output=True, check=True).stdout
# Horizontal tables/code must remain reachable by keyboard on small screens.
body = re.sub(r'<(table|pre)(?=[\s>])', r'<\1 tabindex="0"', body)
existing = (root / 'apps/web/public/self-hosting-and-sdi.html').read_text()
style = re.search(r'<style>(.*?)</style>', existing, flags=re.S).group(1)
html = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenFatture: SdI integration test readiness</title>
<meta name="description" content="Company prerequisites, implementation gaps and safe offline checks before SdI, SMTS or provider integration tests.">
<style>{style}</style></head><body>
<a class="skip" href="#content">Skip to content</a>
<header><strong>openfatture / Integration readiness</strong><nav aria-label="Guide navigation"><a href="/">Back to app</a><a href="/guida.html" lang="it">Guida in italiano</a><a href="/self-hosting-and-sdi.html">Company setup guide</a><a href="/sdi-integration-testing.html" aria-current="page">Before SdI testing</a></nav></header>
<main id="content" tabindex="-1">{body}</main>
<footer>Reviewed 12 November 2026. Offline validation does not establish fiscal correctness, channel accreditation, or permission to send. <a href="https://github.com/mlenarciak/openfatture/blob/main/docs/sdi-integration-testing.md">Source document</a>.</footer>
</body></html>
'''
(root / 'apps/web/public/sdi-integration-testing.html').write_text(html)
print('Generated apps/web/public/sdi-integration-testing.html from docs/sdi-integration-testing.md')
