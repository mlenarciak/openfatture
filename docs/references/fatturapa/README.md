# Offline invoice schema references

Downloaded from the official sources on 12 November 2026. `sources.json` records original-byte SHA256 checksums and lengths. The invoice XSD is the ordinary `FPR12` schema v1.2.3 linked by the current FatturaPA format page. That page separately lists the format specification v1.4; neither version is SMTS v1.5 or the B2B process specification v1.9.1.

`xmldsig-core-schema.xsd` is the unmodified W3C dependency imported by this invoice XSD and the SMTS request-envelope schema. Its copyright/license notice remains in the file and the complete referenced W3C Software Notice is provided in `W3C-SOFTWARE-LICENSE.txt`. No source schema bytes were edited to rewrite imports. The offline validator instead resolves each import against checksum-verified local files and refuses unknown dependencies.

These public technical schemas contain no credentials or taxpayer data. A successful XSD check does not verify signatures, business rules, accreditation, delegation or fiscal delivery. Use [the integration test guide](../../sdi-integration-testing.md) for readiness gates and executable checks.
